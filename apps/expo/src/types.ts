export interface Objective { id: string; description: string; weight: number; required?: boolean; keywords?: string[] }
export interface Situation {
  id: string; version: string; title: string; domain: string; language: string; level: string;
  description: string;
  roles: { user: { name: string; description: string }; ai: { name: string; description: string } };
  systemPrompt: string; objectives: Objective[];
  rubric: { criteria: { id: string; description: string; weight: number }[]; passThreshold: number; scale?: number };
  vocab?: { term: string; definition: string; example?: string }[];
  hints?: string[]; maxTurns: number; successCriteria: string;
}
export interface TurnResult {
  sessionId: string; transcription: string; spokenResponse: string;
  suggestions: string[]; audioBase64: string | null; audioMimeType: string;
  turnCount: number; maxTurns: number;
}
export interface Evaluation {
  weightedScore: number; objectivesMet: string[]; completed: boolean; feedback: string;
  scores: { criterionId: string; score: number; feedback: string }[];
}
