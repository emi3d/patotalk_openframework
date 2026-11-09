import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryProgressStore, applyAttempt } from '../src/progress.js';

test('recordAttempt: attempts increment, best score keeps max, completed latches', async () => {
  const store = new MemoryProgressStore();
  let p = await store.recordAttempt('u1', 'en-ordering-coffee', 0.4, false, []);
  assert.equal(p.situations['en-ordering-coffee'].attempts, 1);
  assert.equal(p.situations['en-ordering-coffee'].bestScore, 0.4);
  assert.equal(p.situations['en-ordering-coffee'].completed, false);
  assert.equal(p.streak, 1);

  p = await store.recordAttempt('u1', 'en-ordering-coffee', 0.8, true, ['order-drink']);
  assert.equal(p.situations['en-ordering-coffee'].attempts, 2);
  assert.equal(p.situations['en-ordering-coffee'].bestScore, 0.8);
  assert.equal(p.situations['en-ordering-coffee'].completed, true);
  assert.deepEqual(p.situations['en-ordering-coffee'].objectivesMet, ['order-drink']);

  // A later worse attempt must not un-complete it or lower the best score.
  p = await store.recordAttempt('u1', 'en-ordering-coffee', 0.2, false, []);
  assert.equal(p.situations['en-ordering-coffee'].bestScore, 0.8);
  assert.equal(p.situations['en-ordering-coffee'].completed, true);
});

test('streak: consecutive days increment, a gap resets to 1', () => {
  const day1 = applyAttempt(null, 'en-ordering-coffee', 0.8, true, [], '2026-11-05');
  assert.equal(day1.streak, 1);
  const day2 = applyAttempt(day1, 'en-ordering-coffee', 0.8, true, [], '2026-11-06');
  assert.equal(day2.streak, 2);
  const afterGap = applyAttempt(day2, 'en-ordering-coffee', 0.8, true, [], '2026-11-09');
  assert.equal(afterGap.streak, 1);
  const sameDay = applyAttempt(day2, 'en-ordering-coffee', 0.8, true, [], '2026-11-06');
  assert.equal(sameDay.streak, 2, 'same day does not inflate the streak');
});
