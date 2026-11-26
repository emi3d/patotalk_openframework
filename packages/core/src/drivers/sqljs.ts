import type { SqlDriver } from "../stats.js";

/** Minimal shape of a sql.js Database, so core does not depend on sql.js. */
export interface SqlJsDatabase {
  run(sql: string, params?: any[]): unknown;
  exec(sql: string, params?: any[]): { columns: string[]; values: unknown[][] }[];
  export(): Uint8Array;
}

/** SQLite in the browser (sql.js / WebAssembly). `persist` is called after every write. */
export function sqlJsDriver(db: SqlJsDatabase, persist?: (bytes: Uint8Array) => void): SqlDriver {
  return {
    async run(sql, params = []) {
      db.run(sql, params);
      persist?.(db.export());
    },
    async all(sql, params = []) {
      const [res] = db.exec(sql, params);
      if (!res) return [];
      return res.values.map((v) => Object.fromEntries(res.columns.map((c, i) => [c, v[i]])));
    },
  };
}
