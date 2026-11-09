import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSituations } from '../src/situations.js';

test('all bundled modules validate against the schema', () => {
  const situations = loadSituations();
  assert.equal(situations.length, 3);
  const ids = situations.map((s) => s.id).sort();
  assert.deepEqual(ids, ['en-customer-complaint', 'en-ordering-coffee', 'es-hotel-checkin']);
  for (const s of situations) {
    assert.ok(s.rubric.passThreshold > 0 && s.rubric.passThreshold <= 1, `${s.id}: passThreshold`);
    const w = s.rubric.criteria.reduce((a, c) => a + c.weight, 0);
    assert.ok(Math.abs(w - 1) < 0.01, `${s.id}: rubric weights sum to ${w}`);
    const ow = s.objectives.reduce((a, o) => a + o.weight, 0);
    assert.ok(Math.abs(ow - 1) < 0.01, `${s.id}: objective weights sum to ${ow}`);
    assert.ok(s.maxTurns >= 1, `${s.id}: maxTurns`);
    assert.ok(s.systemPrompt.length > 20, `${s.id}: systemPrompt`);
  }
});

test('modules cover more than one domain', () => {
  const domains = new Set(loadSituations().map((s) => s.domain));
  assert.ok(domains.size >= 3, `expected >=3 domains, got ${[...domains]}`);
});
