import type { SqlDriver } from "../stats.js";

/** Minimal shape of an expo-sqlite (SDK 50+) database: `await SQLite.openDatabaseAsync("patotalk.db")`. */
export interface ExpoSQLiteDatabase {
  runAsync(sql: string, params: any[]): Promise<unknown>;
  getAllAsync(sql: string, params: any[]): Promise<unknown[]>;
  execAsync(sql: string): Promise<void>;
}

/** SQLite on device for the Expo React Native app. */
export function expoSqliteDriver(db: ExpoSQLiteDatabase): SqlDriver {
  return {
    async run(sql, params = []) {
      if (params.length) await db.runAsync(sql, params);
      else await db.execAsync(sql);
    },
    all: async (sql, params = []) => (await db.getAllAsync(sql, params)) as Record<string, unknown>[],
  };
}
