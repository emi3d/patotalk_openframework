import type { SqlDriver } from "../stats.js";

export interface PgQueryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export function postgresDriver(pg: PgQueryable): SqlDriver {
  const tr = (sql: string) => {
    let i = 0;
    let s = sql.replace(/\?/g, () => `$${++i}`);
    if (/INSERT OR REPLACE INTO pt_attempts/i.test(s))
      s =
        s.replace(/INSERT OR REPLACE/i, "INSERT") +
        " ON CONFLICT (id) DO UPDATE SET ended_at=EXCLUDED.ended_at, turns=EXCLUDED.turns, user_words=EXCLUDED.user_words, score=EXCLUDED.score, passed=EXCLUDED.passed, criteria_json=EXCLUDED.criteria_json, speaking_seconds=EXCLUDED.speaking_seconds";
    return s;
  };
  return {
    async run(sql, params = []) {
      await pg.query(tr(sql), params);
    },
    async all(sql, params = []) {
      return (await pg.query(tr(sql), params)).rows;
    },
  };
}
