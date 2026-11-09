import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Situ } from '../src/situ.js';
import { MemoryProgressStore } from '../src/progress.js';

test('Situ API: newSession -> talk (text) -> evaluate -> progress', async () => {
  const situ = new Situ({ progress: { store: new MemoryProgressStore() } });
  assert.equal(situ.listSituations().length, 3);
  assert.equal(situ.getSituation('en-ordering-coffee').title, 'Ordering Coffee');

  const session = await situ.newSession({ situationId: 'en-ordering-coffee', userId: 'emi' });
  const reply = await situ.talk(session, { text: "Hi, I'd like a medium latte please. Thank you!" });
  assert.ok(reply.spokenResponse.length > 0);
  assert.ok(reply.transcription.includes('latte'));
  assert.ok(reply.audioBase64, 'stub voice returns audio');
  assert.equal(reply.turnCount, 1);

  const { evaluation, progress } = await situ.evaluate(session);
  assert.equal(evaluation.completed, true);
  assert.ok(evaluation.objectivesMet.includes('order-drink'));
  assert.equal(progress.streak, 1);
  assert.equal(progress.situations['en-ordering-coffee'].attempts, 1);

  const again = await situ.progress('emi');
  assert.equal(again?.situations['en-ordering-coffee'].bestScore, evaluation.weightedScore);
  assert.equal(await situ.progress('nobody'), null);
});

test('talk accepts a raw audio Buffer', async () => {
  const situ = new Situ({ progress: { store: new MemoryProgressStore() } });
  const session = await situ.newSession({ situationId: 'en-ordering-coffee', userId: 'emi' });
  const reply = await situ.talk(session, Buffer.from([0, 1, 2, 3]));
  assert.ok(reply.spokenResponse.length > 0);
});

test('talkStream yields transcript, text and audio chunks, then a reply', async () => {
  const situ = new Situ({ progress: { store: new MemoryProgressStore() } });
  const session = await situ.newSession({ situationId: 'en-ordering-coffee', userId: 'emi' });
  const kinds: string[] = [];
  let finalReply = false;
  for await (const chunk of situ.talkStream(session, { text: "Hi, I'd like a medium latte please. Thank you!" })) {
    kinds.push(chunk.type);
    if (chunk.type === 'reply') finalReply = true;
  }
  assert.ok(kinds.includes('transcript'));
  assert.ok(kinds.includes('text'));
  assert.ok(kinds.includes('audio'));
  assert.ok(finalReply);
  assert.equal(session.turns.length, 2);
});
