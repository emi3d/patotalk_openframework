import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Situ, MemoryProgressStore } from 'situ';
import { createApp } from '../src/server.js';
import type { AddressInfo } from 'node:net';

async function withServer(fn: (base: string) => Promise<void>): Promise<void> {
  const situ = new Situ({ progress: { store: new MemoryProgressStore() } });
  const app = createApp(situ);
  const server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', r));
  const port = (server.address() as AddressInfo).port;
  try { await fn(`http://127.0.0.1:${port}`); } finally { server.close(); }
}

test('GET /situations returns the 3 modules; full session flow works', async () => {
  await withServer(async (base) => {
    const list = await (await fetch(`${base}/situations`)).json() as { situations: { id: string }[] };
    assert.equal(list.situations.length, 3);

    const one = await (await fetch(`${base}/situations/en-ordering-coffee`)).json() as { situation: { title: string } };
    assert.equal(one.situation.title, 'Ordering Coffee');
    assert.equal((await fetch(`${base}/situations/nope`)).status, 404);

    const created = await (await fetch(`${base}/sessions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ situationId: 'en-ordering-coffee', userId: 'test-user' }),
    })).json() as { session: { id: string } };
    const sessionId = created.session.id;

    const turn = await (await fetch(`${base}/sessions/${sessionId}/turn`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: "Hi, I'd like a medium latte please. Thank you!" }),
    })).json() as { spokenResponse: string; audioBase64: string | null };
    assert.ok(turn.spokenResponse.length > 0);
    assert.ok(turn.audioBase64, 'stub voice returns audio');

    const evaluated = await (await fetch(`${base}/sessions/${sessionId}/evaluate`, { method: 'POST' })).json() as {
      evaluation: { completed: boolean; weightedScore: number };
      progress: { streak: number };
    };
    assert.equal(typeof evaluated.evaluation.completed, 'boolean');
    assert.equal(evaluated.progress.streak, 1);

    const progress = await (await fetch(`${base}/progress/test-user`)).json() as { progress: { situations: Record<string, { attempts: number }> } };
    assert.equal(progress.progress.situations['en-ordering-coffee'].attempts, 1);
  });
});
