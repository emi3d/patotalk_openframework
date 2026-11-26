import type { SqlDriver } from "../stats.js";

export interface ExpoSQLiteDatabase {
  runAsync(sql: string, params: any[]): Promise<unknown>;
  getAllAsync(sql: string, params: any[]): Promise<unknown[]>;
  execAsync(sql: string): Promise<void>;
}

export function expoSqliteDriver(db: ExpoSQLiteDatabase): SqlDriver {
  return {
    async run(sql, params = []) {
      if (params.length) await db.runAsync(sql, params);
      else await db.execAsync(sql);
    },
    all: async (sql, params = []) => (await db.getAllAsync(sql, params)) as Record<string, unknown>[],
  };
}
