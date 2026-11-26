// Node-only helpers. Kept out of the main entry so web and React Native bundles never see node: imports.
import type { SqlDriver } from "./stats.js";

/** SQLite through Node's built-in node:sqlite (Node 22.13+). Pass ":memory:" or a file path. */
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
