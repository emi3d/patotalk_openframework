// REST + WebSocket client for the Situ server. On a real phone, localhost is the phone itself — use your computer's LAN IP.
import type { Evaluation, Situation, TurnResult } from './types';

export const BASE_URL = process.env.EXPO_PUBLIC_SITU_URL ?? 'http://localhost:3000';

const WS_URL = BASE_URL.replace(/^http/, 'ws');

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return (await res.json()) as T;
}

export const api = {
  listSituations: () => get<{ situations: Situation[] }>('/situations').then((r) => r.situations),
  getSituation: (id: string) => get<{ situation: Situation }>(`/situations/${id}`).then((r) => r.situation),
  createSession: async (situationId: string, userId: string) => {
    const res = await fetch(`${BASE_URL}/sessions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ situationId, userId }),
    });
    if (!res.ok) throw new Error(`create session -> ${res.status}`);
    return (await res.json()) as { session: { id: string } };
  },
  sendTurn: async (sessionId: string, opts: { audioUri?: string; text?: string }): Promise<TurnResult> => {
    const form = new FormData();
    if (opts.audioUri) {
      form.append('audio', { uri: opts.audioUri, name: 'audio.m4a', type: 'audio/m4a' } as unknown as Blob);
    }
    if (opts.text) form.append('text', opts.text);
    const res = await fetch(`${BASE_URL}/sessions/${sessionId}/turn`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`turn -> ${res.status}: ${await res.text()}`);
    return (await res.json()) as TurnResult;
  },
  evaluate: async (sessionId: string) => {
    const res = await fetch(`${BASE_URL}/sessions/${sessionId}/evaluate`, { method: 'POST' });
    if (!res.ok) throw new Error(`evaluate -> ${res.status}`);
    return (await res.json()) as { evaluation: Evaluation; progress: unknown };
  },
  getProgress: (userId: string) =>
    get<{ progress: { streak: number; situations: Record<string, { attempts: number; bestScore: number; completed: boolean; objectivesMet: string[] }> } }>(`/progress/${userId}`),
};

export type LiveEvent =
  | { type: 'started'; sessionId: string }
  | { type: 'transcript'; transcription: string; spokenResponse: string; suggestions: string[] }
  | { type: 'audio'; data: string; chunkIndex: number; totalChunks: number; mimeType: string }
  | { type: 'done'; turnCount: number; maxTurns: number }
  | { type: 'cancelled' }
  | { type: 'error'; error: string };

export class LiveClient {
  private ws: WebSocket | null = null;
  onEvent: (e: LiveEvent) => void = () => {};
  connect(situationId: string, userId: string): void {
    this.ws = new WebSocket(`${WS_URL}/live`);
    this.ws.onopen = () => this.ws?.send(JSON.stringify({ type: 'start', situationId, userId }));
    this.ws.onmessage = (m) => { try { this.onEvent(JSON.parse(m.data as string) as LiveEvent); } catch { /* ignore */ } };
    this.ws.onerror = () => this.onEvent({ type: 'error', error: 'WebSocket error' });
  }
  sendAudio(base64: string, mimeType: string): void {
    this.ws?.send(JSON.stringify({ type: 'audio', data: base64, mimeType }));
  }
  endTurn(text?: string): void {
    this.ws?.send(JSON.stringify({ type: 'end-turn', ...(text ? { text } : {}) }));
  }
  bargeIn(): void {
    this.ws?.send(JSON.stringify({ type: 'barge-in' }));
  }
  close(): void { this.ws?.close(); this.ws = null; }
}
