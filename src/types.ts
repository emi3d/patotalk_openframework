export interface Objective {
  id: string;
  description: string;
  weight: number;
  required?: boolean;
  keywords?: string[];
}

export interface RubricCriterion {
  id: string;
  description: string;
  weight: number;
}

export interface Rubric {
  criteria: RubricCriterion[];
  passThreshold: number;
  scale?: number;
}

export interface Situation {
  id: string;
  version: string;
  title: string;
  domain: string;
  language: string;
  level: string;
  description: string;
  roles: { user: { name: string; description: string }; ai: { name: string; description: string } };
  systemPrompt: string;
  objectives: Objective[];
  rubric: Rubric;
  vocab?: { term: string; definition: string; example?: string }[];
  hints?: string[];
  maxTurns: number;
  successCriteria: string;
}

export interface Turn {
  role: 'user' | 'ai';
  text: string;
  at: string;
}

export interface Session {
  id: string;
  situationId: string;
  userId: string;
  turns: Turn[];
  createdAt: string;
  evaluated?: EvaluationResult;
}

export interface CriterionScore {
  criterionId: string;
  score: number;
  feedback: string;
}

export interface EvaluationResult {
  scores: CriterionScore[];
  weightedScore: number;
  objectivesMet: string[];
  completed: boolean;
  feedback: string;
  evaluatedAt: string;
}

export interface GenerateInput {
  systemPrompt: string;
  history: Turn[];
  audioBase64?: string;
  audioMimeType?: string;
  text?: string;
  responseJsonSchema?: Record<string, unknown>;
}

export interface GenerateOutput {
  text: string;
  transcription?: string;
  raw?: unknown;
}

export interface AIProvider {
  name: string;
  generate(input: GenerateInput): Promise<GenerateOutput>;
  streamText?(input: GenerateInput): AsyncGenerator<string>;
}

export interface VoiceProvider {
  name: string;
  transcribe(audio: Buffer, mimeType: string, language: string): Promise<string>;
  synthesize(text: string, language: string): Promise<Buffer>;
}

export type AIProviderKind = 'gemini' | 'openai' | 'local' | 'ollama' | 'stub';
export type VoiceProviderKind = 'kokoro' | 'google' | 'google-tts' | 'elevenlabs' | 'local' | 'stub';

export interface AIConfig {
  provider?: AIProviderKind;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  url?: string;
}

export interface VoiceConfig {
  provider?: VoiceProviderKind;
  apiKey?: string;
  url?: string;
  voice?: string;
  voiceId?: string;
  whisperUrl?: string;
  kokoroUrl?: string;
}

export interface ProgressConfig {
  databaseUrl?: string;
  file?: string;
  store?: ProgressStore;
}

export interface SituConfig {
  ai?: AIConfig;
  voice?: VoiceConfig;
  progress?: ProgressConfig;
  situations?: Situation[];
  situationsDir?: string;
}

export interface SituationProgress {
  attempts: number;
  bestScore: number;
  completed: boolean;
  objectivesMet: string[];
  history: { date: string; score: number; completed: boolean }[];
}

export interface UserProgress {
  streak: number;
  lastActiveDate: string;
  situations: Record<string, SituationProgress>;
}

export interface ProgressData {
  users: Record<string, UserProgress>;
}

export interface ProgressStore {
  getUser(userId: string): Promise<UserProgress | null>;
  recordAttempt(userId: string, situationId: string, score: number, completed: boolean, objectivesMet: string[]): Promise<UserProgress>;
  getAll(): Promise<ProgressData>;
}

export interface TalkReply {
  sessionId: string;
  transcription: string;
  spokenResponse: string;
  suggestions: string[];
  audio: Buffer | null;
  audioBase64: string | null;
  audioMimeType: string;
  turnCount: number;
  maxTurns: number;
}

export type TalkInput =
  | Buffer
  | { text?: string; audio?: Buffer; mimeType?: string };

export type TalkChunk =
  | { type: 'transcript'; transcription: string }
  | { type: 'text'; text: string; done?: boolean }
  | { type: 'audio'; data: string; mimeType: string; done?: boolean }
  | { type: 'reply'; reply: TalkReply };
