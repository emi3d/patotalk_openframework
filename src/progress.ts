import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import type { ProgressData, ProgressStore, SituationProgress, UserProgress } from './types.js';

export function emptyUserProgress(): UserProgress {
  return { streak: 0, lastActiveDate: '', situations: {} };
}

export function applyAttempt(
  current: UserProgress | null,
  situationId: string,
  score: number,
  completed: boolean,
  objectivesMet: string[],
  today = new Date().toISOString().slice(0, 10),
): UserProgress {
  const user: UserProgress = current ?? emptyUserProgress();
  const prev = user.situations[situationId] ?? {
    attempts: 0, bestScore: 0, completed: false, objectivesMet: [], history: [],
  };
  const entry: SituationProgress = {
    attempts: prev.attempts + 1,
    bestScore: Math.max(prev.bestScore, score),
    completed: prev.completed || completed,
    objectivesMet: [...new Set([...prev.objectivesMet, ...objectivesMet])],
    history: [...prev.history, { date: today, score, completed }].slice(-50),
  };
  let streak = user.streak;
  if (user.lastActiveDate === today) streak = Math.max(streak, 1);
  else if (user.lastActiveDate) {
    const last = new Date(user.lastActiveDate);
    const diffDays = Math.round((new Date(today).getTime() - last.getTime()) / 86400000);
    streak = diffDays === 1 ? user.streak + 1 : 1;
  } else streak = 1;
  return { streak, lastActiveDate: today, situations: { ...user.situations, [situationId]: entry } };
}

export class MemoryProgressStore implements ProgressStore {
  private data: ProgressData = { users: {} };
  async getUser(userId: string): Promise<UserProgress | null> {
    return this.data.users[userId] ?? null;
  }
  async recordAttempt(userId: string, situationId: string, score: number, completed: boolean, objectivesMet: string[]): Promise<UserProgress> {
    const next = applyAttempt(this.data.users[userId] ?? null, situationId, score, completed, objectivesMet);
    this.data.users[userId] = next;
    return next;
  }
  async getAll(): Promise<ProgressData> { return this.data; }
}

export class JsonFileProgressStore implements ProgressStore {
  private file: string;
  constructor(file?: string) {
    this.file = file ?? join(process.cwd(), 'data', 'progress.json');
  }
  private read(): ProgressData {
    if (!existsSync(this.file)) return { users: {} };
    try {
      return JSON.parse(readFileSync(this.file, 'utf-8')) as ProgressData;
    } catch { return { users: {} }; }
  }
  private write(data: ProgressData): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(data, null, 2));
  }
  async getUser(userId: string): Promise<UserProgress | null> {
    return this.read().users[userId] ?? null;
  }
  async recordAttempt(userId: string, situationId: string, score: number, completed: boolean, objectivesMet: string[]): Promise<UserProgress> {
    const data = this.read();
    const next = applyAttempt(data.users[userId] ?? null, situationId, score, completed, objectivesMet);
    data.users[userId] = next;
    this.write(data);
    return next;
  }
  async getAll(): Promise<ProgressData> { return this.read(); }
}

export interface PgClientLike {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end?(): Promise<void>;
}

export function findSchemaSql(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(process.cwd(), 'migrations', 'schema.sql'),
    join(here, 'migrations', 'schema.sql'),
    join(here, '..', 'migrations', 'schema.sql'),
  ];
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error(`migrations/schema.sql not found (tried: ${candidates.join(', ')})`);
  return readFileSync(found, 'utf-8');
}

export async function migratePostgres(client: PgClientLike, schemaSql?: string): Promise<void> {
  await client.query(schemaSql ?? findSchemaSql());
}

export class PostgresProgressStore implements ProgressStore {
  private client: PgClientLike;
  private migrated = false;
  private schemaSql?: string;

  constructor(opts: { databaseUrl?: string; pool?: PgClientLike; schemaSql?: string }) {
    this.schemaSql = opts.schemaSql;
    if (opts.pool) {
      this.client = opts.pool;
    } else {
      if (!opts.databaseUrl) throw new Error('PostgresProgressStore needs databaseUrl or a pool');
      this.client = new Pool({ connectionString: opts.databaseUrl }) as unknown as PgClientLike;
    }
  }

  async migrate(): Promise<void> {
    await migratePostgres(this.client, this.schemaSql);
    this.migrated = true;
  }

  private async ensureMigrated(): Promise<void> {
    if (!this.migrated) await this.migrate();
  }

  private async readUser(userId: string): Promise<UserProgress | null> {
    await this.ensureMigrated();
    const userRes = await this.client.query(
      'SELECT streak, last_active_date FROM situ_users WHERE user_id = $1',
      [userId],
    );
    if (userRes.rows.length === 0) return null;
    const attemptsRes = await this.client.query(
      'SELECT situation_id, score, completed, objectives_met, created_at FROM situ_attempts WHERE user_id = $1 ORDER BY created_at ASC',
      [userId],
    );
    const user: UserProgress = {
      streak: Number(userRes.rows[0].streak),
      lastActiveDate: userRes.rows[0].last_active_date
        ? String(userRes.rows[0].last_active_date).slice(0, 10)
        : '',
      situations: {},
    };
    for (const row of attemptsRes.rows) {
      const situationId = String(row.situation_id);
      const prev = user.situations[situationId] ?? {
        attempts: 0, bestScore: 0, completed: false, objectivesMet: [], history: [],
      };
      const score = Number(row.score);
      const objectives = Array.isArray(row.objectives_met) ? row.objectives_met as string[] : [];
      user.situations[situationId] = {
        attempts: prev.attempts + 1,
        bestScore: Math.max(prev.bestScore, score),
        completed: prev.completed || row.completed === true,
        objectivesMet: [...new Set([...prev.objectivesMet, ...objectives])],
        history: [...prev.history, {
          date: String(row.created_at).slice(0, 10),
          score,
          completed: row.completed === true,
        }].slice(-50),
      };
    }
    return user;
  }

  async getUser(userId: string): Promise<UserProgress | null> {
    return this.readUser(userId);
  }

  async recordAttempt(userId: string, situationId: string, score: number, completed: boolean, objectivesMet: string[]): Promise<UserProgress> {
    const current = await this.readUser(userId);
    const next = applyAttempt(current, situationId, score, completed, objectivesMet);
    await this.client.query(
      'INSERT INTO situ_users (user_id, streak, last_active_date) VALUES ($1, $2, $3) ' +
      'ON CONFLICT (user_id) DO UPDATE SET streak = EXCLUDED.streak, last_active_date = EXCLUDED.last_active_date',
      [userId, next.streak, next.lastActiveDate],
    );
    await this.client.query(
      'INSERT INTO situ_attempts (user_id, situation_id, score, completed, objectives_met) VALUES ($1, $2, $3, $4, $5)',
      [userId, situationId, score, completed, objectivesMet],
    );
    return next;
  }

  async getAll(): Promise<ProgressData> {
    await this.ensureMigrated();
    const res = await this.client.query('SELECT user_id FROM situ_users');
    const users: ProgressData['users'] = {};
    for (const row of res.rows) {
      const user = await this.readUser(String(row.user_id));
      if (user) users[String(row.user_id)] = user;
    }
    return { users };
  }

  async close(): Promise<void> {
    if (this.client.end) await this.client.end();
  }
}
