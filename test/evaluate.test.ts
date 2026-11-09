import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSession, scoreRubric } from '../src/evaluate.js';
import { stubAI } from '../src/ai.js';
import { loadSituations } from '../src/situations.js';
import type { Rubric } from '../src/types.js';

const rubric: Rubric = {
  criteria: [
    { id: 'a', description: 'A', weight: 0.5 },
    { id: 'b', description: 'B', weight: 0.5 },
  ],
  passThreshold: 0.6,
  scale: 5,
};

test('scoreRubric: weighted score is weight * score/scale', () => {
  // a=5/5 * 0.5 = 0.5, b=3/5 * 0.5 = 0.3 -> 0.8
  assert.equal(scoreRubric(rubric, { a: 5, b: 3 }).weightedScore, 0.8);
  assert.equal(scoreRubric(rubric, { a: 0, b: 0 }).weightedScore, 0);
  // Scores are clamped to the scale.
  assert.equal(scoreRubric(rubric, { a: 99, b: -1 }).weightedScore, 0.5);
  // Missing criteria score 0.
  assert.equal(scoreRubric(rubric, {}).weightedScore, 0);
});

test('evaluateSession: completed only when score passes AND required objectives met', async () => {
  const situation = loadSituations().find((s) => s.id === 'en-ordering-coffee')!;
  // Learner orders a latte and says thanks — hits order-drink + close-politely keywords.
  const good = await evaluateSession(situation, [
    { role: 'user', text: "Hi, I'd like a medium latte please", at: new Date().toISOString() },
    { role: 'ai', text: 'Sure, for here or to go?', at: new Date().toISOString() },
    { role: 'user', text: 'To go, please. Thank you!', at: new Date().toISOString() },
  ], stubAI);
  assert.ok(good.weightedScore >= situation.rubric.passThreshold, `score ${good.weightedScore}`);
  assert.ok(good.objectivesMet.includes('order-drink'));
  assert.ok(good.completed, 'should complete when required objectives are met');

  // Learner says nothing relevant — required objectives unmet, must not complete.
  const bad = await evaluateSession(situation, [
    { role: 'user', text: 'hello', at: new Date().toISOString() },
  ], stubAI);
  assert.equal(bad.completed, false);
  assert.ok(!bad.objectivesMet.includes('order-drink'));
});
