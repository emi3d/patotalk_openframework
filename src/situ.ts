import { makeAIProvider } from './ai.js';
import { makeVoiceProvider } from './voice.js';
import { evaluateSession } from './evaluate.js';
import { JsonFileProgressStore, PostgresProgressStore } from './progress.js';
import { loadSituations } from './situations.js';
import type {
  AIProvider,
  EvaluationResult,
  ProgressStore,
  Session,
  SituConfig,
  Situation,
  TalkChunk,
  TalkInput,
  TalkReply,
  UserProgress,
  VoiceProvider,
} from './types.js';

export const CHAT_SCHEMA = {
  type: 'object',
  properties: {
    userTranscription: { type: 'string' },
    spokenResponse: { type: 'string' },
    suggestedUserResponses: { type: 'array', items: { type: 'string' } },
  },
  required: ['spokenResponse'],
} as const;

export function parseChatOutput(text: string): { transcription: string; spokenResponse: string; suggestions: string[] } {
  try {
    const p = JSON.parse(text) as { userTranscription?: string; spokenResponse?: string; suggestedUserResponses?: string[] };
    return {
      transcription: p.userTranscription ?? '',
      spokenResponse: p.spokenResponse ?? text,
      suggestions: p.suggestedUserResponses ?? [],
    };
  } catch {
    return { transcription: '', spokenResponse: text, suggestions: [] };
  }
}

let counter = 0;
function newId(): string {
  return `${Date.now().toString(36)}-${(++counter).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export class Situ {
  readonly ai: AIProvider;
  readonly voice: VoiceProvider;
  readonly progressStore: ProgressStore;
  private situations: Situation[];
  private byId: Map<string, Situation>;
  private sessions = new Map<string, Session>();

  constructor(config: SituConfig = {}) {
    this.ai = makeAIProvider(config.ai ?? {});
    this.voice = makeVoiceProvider(config.voice ?? {});
    this.progressStore = config.progress?.store
      ?? (config.progress?.databaseUrl
        ? new PostgresProgressStore({ databaseUrl: config.progress.databaseUrl })
        : new JsonFileProgressStore(config.progress?.file));
    this.situations = config.situations ?? loadSituations(config.situationsDir);
    this.byId = new Map(this.situations.map((s) => [s.id, s]));
  }

  listSituations(): Situation[] {
    return this.situations;
  }

  getSituation(id: string): Situation {
    const s = this.byId.get(id);
    if (!s) throw new Error(`unknown situation: ${id}`);
    return s;
  }

  async newSession(opts: { situationId: string; userId: string }): Promise<Session> {
    this.getSituation(opts.situationId);
    const session: Session = {
      id: newId(),
      situationId: opts.situationId,
      userId: opts.userId,
      turns: [],
      createdAt: new Date().toISOString(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  getSession(id: string): Session {
    const s = this.sessions.get(id);
    if (!s) throw new Error(`unknown session: ${id}`);
    return s;
  }

  private resolveSession(session: Session | string): Session {
    return typeof session === 'string' ? this.getSession(session) : session;
  }

  private async runTurn(session: Session, input: TalkInput): Promise<TalkReply> {
    const situation = this.getSituation(session.situationId);
    if (session.turns.length / 2 >= situation.maxTurns) {
      throw new Error(`maxTurns reached (${situation.maxTurns}) — evaluate the session`);
    }
    const text = Buffer.isBuffer(input) ? undefined : input.text;
    const audio = Buffer.isBuffer(input) ? input : input.audio;
    const mimeType = Buffer.isBuffer(input) ? 'audio/webm' : (input.mimeType ?? 'audio/webm');
    let userText = text ?? '';
    let audioBase64: string | undefined;
    if (audio) {
      if (this.ai.name === 'gemini') {
        audioBase64 = audio.toString('base64');
      } else {
        try { userText = await this.voice.transcribe(audio, mimeType, situation.language); }
        catch { userText = ''; }
      }
    }
    const out = await this.ai.generate({
      systemPrompt: situation.systemPrompt,
      history: session.turns,
      audioBase64,
      audioMimeType: mimeType,
      text: userText || undefined,
      responseJsonSchema: CHAT_SCHEMA as unknown as Record<string, unknown>,
    });
    const chat = parseChatOutput(out.text);
    const transcription = out.transcription ?? chat.transcription ?? userText;
    if (transcription) session.turns.push({ role: 'user', text: transcription, at: new Date().toISOString() });
    session.turns.push({ role: 'ai', text: chat.spokenResponse, at: new Date().toISOString() });
    let audioOut: Buffer | null = null;
    try { audioOut = await this.voice.synthesize(chat.spokenResponse, situation.language); }
    catch { audioOut = null; }
    return {
      sessionId: session.id,
      transcription,
      spokenResponse: chat.spokenResponse,
      suggestions: chat.suggestions,
      audio: audioOut,
      audioBase64: audioOut ? audioOut.toString('base64') : null,
      audioMimeType: this.voice.name === 'stub' ? 'audio/wav' : 'audio/mpeg',
      turnCount: session.turns.length / 2,
      maxTurns: situation.maxTurns,
    };
  }

  async talk(session: Session | string, input: TalkInput): Promise<TalkReply> {
    return this.runTurn(this.resolveSession(session), input);
  }

  async talkText(session: Session | string, text: string): Promise<TalkReply> {
    return this.runTurn(this.resolveSession(session), { text });
  }

  async *talkStream(session: Session | string, input: TalkInput): AsyncGenerator<TalkChunk> {
    const resolved = this.resolveSession(session);
    const situation = this.getSituation(resolved.situationId);
    const isText = !Buffer.isBuffer(input) && input.text !== undefined && !input.audio;
    if (isText && this.ai.streamText && this.ai.name !== 'stub') {
      const text = (input as { text: string }).text;
      const chunks: string[] = [];
      for await (const piece of this.ai.streamText({
        systemPrompt: situation.systemPrompt,
        history: resolved.turns,
        text,
        responseJsonSchema: CHAT_SCHEMA as unknown as Record<string, unknown>,
      })) {
        chunks.push(piece);
        yield { type: 'text', text: piece };
      }
      const chat = parseChatOutput(chunks.join(''));
      const transcription = chat.transcription || text;
      yield { type: 'transcript', transcription };
      if (transcription) resolved.turns.push({ role: 'user', text: transcription, at: new Date().toISOString() });
      resolved.turns.push({ role: 'ai', text: chat.spokenResponse, at: new Date().toISOString() });
      let audioOut: Buffer | null = null;
      try { audioOut = await this.voice.synthesize(chat.spokenResponse, situation.language); }
      catch { audioOut = null; }
      if (audioOut) {
        const CHUNK = 32 * 1024;
        for (let i = 0; i < audioOut.length; i += CHUNK) {
          yield { type: 'audio', data: audioOut.subarray(i, i + CHUNK).toString('base64'), mimeType: this.voice.name === 'stub' ? 'audio/wav' : 'audio/mpeg' };
        }
      }
      yield {
        type: 'reply',
        reply: {
          sessionId: resolved.id,
          transcription,
          spokenResponse: chat.spokenResponse,
          suggestions: chat.suggestions,
          audio: audioOut,
          audioBase64: audioOut ? audioOut.toString('base64') : null,
          audioMimeType: this.voice.name === 'stub' ? 'audio/wav' : 'audio/mpeg',
          turnCount: resolved.turns.length / 2,
          maxTurns: situation.maxTurns,
        },
      };
      return;
    }
    const reply = await this.runTurn(resolved, input);
    yield { type: 'transcript', transcription: reply.transcription };
    yield { type: 'text', text: reply.spokenResponse, done: true };
    if (reply.audio) {
      const CHUNK = 32 * 1024;
      for (let i = 0; i < reply.audio.length; i += CHUNK) {
        yield { type: 'audio', data: reply.audio.subarray(i, i + CHUNK).toString('base64'), mimeType: reply.audioMimeType };
      }
    }
    yield { type: 'reply', reply };
  }

  async evaluate(session: Session | string): Promise<{ evaluation: EvaluationResult; progress: UserProgress }> {
    const resolved = this.resolveSession(session);
    const situation = this.getSituation(resolved.situationId);
    const evaluation = await evaluateSession(situation, resolved.turns, this.ai);
    resolved.evaluated = evaluation;
    const progress = await this.progressStore.recordAttempt(
      resolved.userId, resolved.situationId, evaluation.weightedScore, evaluation.completed, evaluation.objectivesMet,
    );
    return { evaluation, progress };
  }

  async progress(userId: string): Promise<UserProgress | null> {
    return this.progressStore.getUser(userId);
  }

  async migrate(): Promise<void> {
    if (this.progressStore instanceof PostgresProgressStore) await this.progressStore.migrate();
  }

  async close(): Promise<void> {
    if (this.progressStore instanceof PostgresProgressStore) await this.progressStore.close();
  }
}
