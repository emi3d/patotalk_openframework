import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PostgresProgressStore, type PgClientLike } from '../src/progress.js';

interface FakeRow { [k: string]: unknown }

class FakePool implements PgClientLike {
  users = new Map<string, { streak: number; last_active_date: string }>();
  attempts: { user_id: string; situation_id: string; score: number; completed: boolean; objectives_met: string[]; created_at: string }[] = [];
  migrated = false;

  async query(text: string, params: unknown[] = []): Promise<{ rows: FakeRow[] }> {
    const sql = text.toLowerCase();
    if (sql.includes('create table') || sql.includes('create or replace view') || sql.includes('create index')) {
      this.migrated = true;
      return { rows: [] };
    }
    if (text.startsWith('SELECT streak')) {
      const u = this.users.get(String(params[0]));
      return { rows: u ? [{ streak: u.streak, last_active_date: u.last_active_date }] : [] };
    }
    if (text.startsWith('SELECT situation_id')) {
      return {
        rows: this.attempts
          .filter((a) => a.user_id === String(params[0]))
          .map((a) => ({ ...a, created_at: a.created_at })),
      };
    }
    if (text.startsWith('INSERT INTO situ_users')) {
      this.users.set(String(params[0]), { streak: Number(params[1]), last_active_date: String(params[2]) });
      return { rows: [] };
    }
    if (text.startsWith('INSERT INTO situ_attempts')) {
      this.attempts.push({
        user_id: String(params[0]),
        situation_id: String(params[1]),
        score: Number(params[2]),
        completed: params[3] === true,
        objectives_met: params[4] as string[],
        created_at: new Date().toISOString(),
      });
      return { rows: [] };
    }
    if (text.startsWith('SELECT user_id FROM situ_users')) {
      return { rows: [...this.users.keys()].map((user_id) => ({ user_id })) };
    }
    throw new Error(`FakePool: unhandled query: ${text.slice(0, 80)}`);
  }
}

test('PostgresProgressStore (mocked pg): migrate + recordAttempt round-trips', async () => {
  const pool = new FakePool();
  const store = new PostgresProgressStore({ pool });
  await store.migrate();
  assert.equal(pool.migrated, true);

  let p = await store.recordAttempt('u1', 'en-ordering-coffee', 0.4, false, []);
  assert.equal(p.situations['en-ordering-coffee'].attempts, 1);
  assert.equal(p.streak, 1);

  p = await store.recordAttempt('u1', 'en-ordering-coffee', 0.8, true, ['order-drink']);
  assert.equal(p.situations['en-ordering-coffee'].attempts, 2);
  assert.equal(p.situations['en-ordering-coffee'].bestScore, 0.8);
  assert.equal(p.situations['en-ordering-coffee'].completed, true);

  const back = await store.getUser('u1');
  assert.equal(back?.situations['en-ordering-coffee'].attempts, 2);
  assert.deepEqual(back?.situations['en-ordering-coffee'].objectivesMet, ['order-drink']);
  assert.equal(await store.getUser('nobody'), null);

  const all = await store.getAll();
  assert.equal(Object.keys(all.users).length, 1);
});
