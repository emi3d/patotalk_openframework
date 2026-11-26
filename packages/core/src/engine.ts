import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { parseExperience, type Experience, type ExperienceInput } from "./experience.js";
import { buildConversationGraph, isAudio, type EvaluationResult, type UserInput } from "./graph.js";
import { createLLM, messageText, type LLMConfig } from "./llm.js";
import { StatsStore, type AttemptStats, type SqlDriver, type UserSummary } from "./stats.js";
import type { SpeechAudio, TTSProvider } from "./tts.js";

export interface PatoTalkOptions {
  /** Language provider: a config, or any LangChain chat model. */
  llm: LLMConfig | BaseChatModel;
  /** Optional separate model for evaluation. */
  evaluator?: LLMConfig | BaseChatModel;
  /** Voice provider. Omit for text only. */
  tts?: TTSProvider;
  /** SQL stats. Omit to keep no stats. */
  stats?: SqlDriver | StatsStore;
}

export interface Turn {
  text: string;
  audio?: SpeechAudio;
  turn: number;
  maxTurns: number;
  finished: boolean;
  evaluation?: EvaluationResult;
}

export interface Session {
  id: string;
  userId: string;
  experience: Experience;
  startedAt: string;
  turns: number;
  userWords: number;
  speakingSeconds: number;
  finished: boolean;
  evaluation?: EvaluationResult;
  /** @internal true while a turn is running */
  busy?: boolean;
  /** @internal */
  graph: ReturnType<typeof buildConversationGraph>;
}

const isModel = (x: unknown): x is BaseChatModel => !!x && typeof (x as BaseChatModel).invoke === "function";
const uid = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
/** Words, counting each CJK character as one (Japanese/Chinese have no spaces). */
export const countWords = (t: string) =>
  (t.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu)?.length ?? 0) +
  (t.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu, " ").match(/[\p{L}\p{N}']+/gu)?.length ?? 0);

export class PatoTalk {
  private llm: Promise<BaseChatModel>;
  private evaluator: Promise<BaseChatModel>;
  readonly stats?: StatsStore;
  tts?: TTSProvider;

  constructor(opts: PatoTalkOptions) {
    this.llm = isModel(opts.llm) ? Promise.resolve(opts.llm) : createLLM(opts.llm);
    this.evaluator = opts.evaluator ? (isModel(opts.evaluator) ? Promise.resolve(opts.evaluator) : createLLM(opts.evaluator)) : this.llm;
    this.tts = opts.tts;
    if (opts.stats) this.stats = opts.stats instanceof StatsStore ? opts.stats : new StatsStore(opts.stats);
  }

  /** Start an experience. Returns the session and character B's opening line. */
  async start(input: Experience | ExperienceInput | string, opts: { userId: string; speak?: boolean }): Promise<{ session: Session; opening: Turn }> {
    const experience = parseExperience(input);
    const graph = buildConversationGraph({ experience, llm: await this.llm, evaluator: await this.evaluator });
    const session: Session = { id: uid(), userId: opts.userId, experience, startedAt: new Date().toISOString(), turns: 0, userWords: 0, speakingSeconds: 0, finished: false, graph };
    const state = await graph.invoke({ action: "start" }, this.cfg(session));
    await this.save(session);
    return { session, opening: await this.turn(session, state, opts.speak) };
  }

  /**
   * One learner turn. Pass recorded audio ({ audio: base64, mimeType, seconds }) and the
   * multimodal model listens to it directly, no transcription. Text works too (typing fallback).
   * Returns character B's reply (and its TTS audio). Ends + evaluates at maxTurns.
   */
  async say(session: Session, input: UserInput, opts: { speak?: boolean } = {}): Promise<Turn> {
    if (session.finished) throw new Error("Session already finished");
    const audio = isAudio(input);
    if (audio ? !input.audio : !String(input ?? "").trim()) throw new Error("Say something first");
    if (session.busy) throw new Error("Still answering the previous message");
    session.busy = true;
    try {
      const state = await session.graph.invoke({ action: "talk", input: audio ? input : input.trim() }, this.cfg(session));
      // only counted once the turn succeeded
      if (audio) session.speakingSeconds += input.seconds ?? 0;
      else session.userWords += countWords(input);
      return await this.turn(session, state, opts.speak);
    } finally {
      session.busy = false;
    }
  }

  /** End the scene now and evaluate it. */
  async end(session: Session): Promise<EvaluationResult> {
    if (session.evaluation) return session.evaluation;
    if (session.busy) throw new Error("Still answering the previous message");
    const state = await session.graph.invoke({ action: "evaluate" }, this.cfg(session));
    await this.finish(session, state.evaluation!);
    return state.evaluation!;
  }

  /** Full message history of a session (kept in memory only). */
  async history(session: Session) {
    const snap = await session.graph.getState(this.cfg(session));
    return (snap.values.messages ?? []).map((m: any) => {
      const voice = Array.isArray(m.content) && m.content.some((p: any) => p?.type === "audio");
      return { role: m.getType() === "human" ? "user" : "character", text: voice ? "(voice)" : messageText(m), voice };
    });
  }

  async summary(userId: string): Promise<UserSummary | null> {
    return this.stats ? this.stats.summary(userId) : null;
  }

  async speak(text: string, session: Session): Promise<SpeechAudio | undefined> {
    if (!this.tts || !text) return undefined;
    const v = session.experience.characterB.voice;
    return this.tts.synthesize(text, { lang: session.experience.meta.language, voice: v?.id, gender: v?.gender });
  }

  private cfg(s: Session) {
    return { configurable: { thread_id: s.id } };
  }

  private async turn(session: Session, state: any, speak = true): Promise<Turn> {
    session.turns = state.turns;
    const last = state.messages[state.messages.length - 1];
    const text = messageText(last);
    if (state.evaluation) await this.finish(session, state.evaluation);
    else await this.save(session);
    return {
      text,
      audio: speak ? await this.speak(text, session) : undefined,
      turn: session.turns,
      maxTurns: session.experience.maxTurns,
      finished: session.finished,
      evaluation: session.evaluation,
    };
  }

  private async finish(session: Session, ev: EvaluationResult) {
    session.finished = true;
    session.evaluation = ev;
    await this.save(session, new Date().toISOString());
  }

  private async save(s: Session, endedAt?: string) {
    if (!this.stats) return;
    const a: AttemptStats = {
      id: s.id,
      userId: s.userId,
      experienceId: s.experience.id,
      language: s.experience.meta.language,
      startedAt: s.startedAt,
      endedAt,
      turns: s.turns,
      userWords: s.userWords,
      speakingSeconds: s.speakingSeconds,
      score: s.evaluation?.score,
      passed: s.evaluation?.passed,
      criteria: s.evaluation ? Object.fromEntries(s.evaluation.criteria.map((c) => [c.id, c.score])) : undefined,
    };
    await this.stats.save(a);
  }
}
