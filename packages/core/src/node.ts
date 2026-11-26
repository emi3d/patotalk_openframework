import type { SqlDriver } from "./stats.js";

export async function nodeSqliteDriver(path = "patotalk.sqlite"): Promise<SqlDriver & { close(): void }> {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path);
  return {
    async run(sql, params = []) {
      if (params.length) db.prepare(sql).run(...(params as any[]));
      else db.exec(sql);
    },
    async all(sql, params = []) {
      return db.prepare(sql).all(...(params as any[])) as Record<string, unknown>[];
    },
    close: () => db.close(),
  };
}
