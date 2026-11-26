/**
 * User stats in any SQL database. Only numbers are stored, never conversation text.
 * A driver is two functions; adapters exist for node:sqlite, sql.js (browser) and expo-sqlite.
 * Placeholders are `?` (SQLite style); a Postgres adapter can rewrite them to $1, $2...
 */
export type Row = Record<string, unknown>;

export interface SqlDriver {
  run(sql: string, params?: unknown[]): Promise<void>;
  all(sql: string, params?: unknown[]): Promise<Row[]>;
}

export const STATS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS pt_attempts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    experience_id TEXT NOT NULL,
    language TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    turns INTEGER NOT NULL DEFAULT 0,
    user_words INTEGER NOT NULL DEFAULT 0,
    score REAL,
    passed INTEGER,
    criteria_json TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS pt_attempts_user ON pt_attempts(user_id, started_at)`,
];

export interface AttemptStats {
  id: string;
  userId: string;
  experienceId: string;
  language: string;
  startedAt: string;
  endedAt?: string;
  turns: number;
  userWords: number;
  score?: number;
  passed?: boolean;
  criteria?: Record<string, number>;
}

export interface UserSummary {
  userId: string;
  attempts: number;
  completed: number;
  passed: number;
  averageScore: number | null;
  totalTurns: number;
  totalWords: number;
  streakDays: number;
  byLanguage: Record<string, { attempts: number; averageScore: number | null }>;
  byExperience: Record<string, { attempts: number; bestScore: number | null; passed: boolean }>;
}

export class StatsStore {
  private ready: Promise<void> | null = null;
  constructor(private db: SqlDriver) {}

  migrate(): Promise<void> {
    this.ready ??= (async () => {
      for (const s of STATS_SCHEMA) await this.db.run(s);
    })();
    return this.ready;
  }

  async save(a: AttemptStats): Promise<void> {
    await this.migrate();
    await this.db.run(
      `INSERT OR REPLACE INTO pt_attempts (id,user_id,experience_id,language,started_at,ended_at,turns,user_words,score,passed,criteria_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        a.id,
        a.userId,
        a.experienceId,
        a.language,
        a.startedAt,
        a.endedAt ?? null,
        a.turns,
        a.userWords,
        a.score ?? null,
        a.passed === undefined ? null : a.passed ? 1 : 0,
        a.criteria ? JSON.stringify(a.criteria) : null,
      ],
    );
  }

  async attempts(userId: string): Promise<AttemptStats[]> {
    await this.migrate();
    const rows = await this.db.all(`SELECT * FROM pt_attempts WHERE user_id = ? ORDER BY started_at DESC`, [userId]);
    return rows.map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      experienceId: String(r.experience_id),
      language: String(r.language),
      startedAt: String(r.started_at),
      endedAt: r.ended_at == null ? undefined : String(r.ended_at),
      turns: Number(r.turns),
      userWords: Number(r.user_words),
      score: r.score == null ? undefined : Number(r.score),
      passed: r.passed == null ? undefined : Number(r.passed) === 1,
      criteria: r.criteria_json ? JSON.parse(String(r.criteria_json)) : undefined,
    }));
  }

  async summary(userId: string, today = new Date()): Promise<UserSummary> {
    const list = await this.attempts(userId);
    const done = list.filter((a) => a.score !== undefined);
    const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
    const byLanguage: UserSummary["byLanguage"] = {};
    const byExperience: UserSummary["byExperience"] = {};
    for (const a of list) {
      const l = (byLanguage[a.language] ??= { attempts: 0, averageScore: null });
      l.attempts++;
      const e = (byExperience[a.experienceId] ??= { attempts: 0, bestScore: null, passed: false });
      e.attempts++;
      if (a.score !== undefined) e.bestScore = Math.max(e.bestScore ?? 0, a.score);
      if (a.passed) e.passed = true;
    }
    for (const lang of Object.keys(byLanguage))
      byLanguage[lang].averageScore = avg(done.filter((a) => a.language === lang).map((a) => a.score!));
    return {
      userId,
      attempts: list.length,
      completed: done.length,
      passed: list.filter((a) => a.passed).length,
      averageScore: avg(done.map((a) => a.score!)),
      totalTurns: list.reduce((s, a) => s + a.turns, 0),
      totalWords: list.reduce((s, a) => s + a.userWords, 0),
      streakDays: streak(list.map((a) => a.startedAt), today),
      byLanguage,
      byExperience,
    };
  }
}

/** Consecutive days (ending today or yesterday) with at least one attempt. */
export function streak(isoDates: string[], today = new Date()): number {
  const days = new Set(isoDates.map((d) => d.slice(0, 10)));
  const day = (offset: number) => new Date(today.getTime() - offset * 86400000).toISOString().slice(0, 10);
  let start = days.has(day(0)) ? 0 : days.has(day(1)) ? 1 : -1;
  if (start < 0) return 0;
  let n = 0;
  while (days.has(day(start + n))) n++;
  return n;
}

/** In-memory driver for tests and demos (supports only what StatsStore uses). */
export function memoryDriver(): SqlDriver {
  const rows = new Map<string, Row>();
  const cols = ["id", "user_id", "experience_id", "language", "started_at", "ended_at", "turns", "user_words", "score", "passed", "criteria_json"];
  return {
    async run(sql, params = []) {
      if (/^\s*INSERT/i.test(sql)) rows.set(String(params[0]), Object.fromEntries(cols.map((c, i) => [c, params[i]])));
    },
    async all(_sql, params = []) {
      return [...rows.values()].filter((r) => r.user_id === params[0]).sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));
    },
  };
}
