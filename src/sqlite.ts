import { DatabaseSync } from "node:sqlite";
import type { Sql } from "./sql.ts";

/** The Sql port over a `node:sqlite` database file (or ":memory:"). */
export function openSqlite(path: string): Sql {
  const db = new DatabaseSync(path);
  // secure_delete overwrites deleted content instead of leaving it in free pages.
  db.exec("pragma journal_mode = wal; pragma busy_timeout = 5000; pragma secure_delete = on;");
  return {
    run: (sql, ...params) => Number(db.prepare(sql).run(...params).changes),
    all: <T>(sql: string, ...params: Parameters<Sql["run"]>[1][]) =>
      db.prepare(sql).all(...params) as T[],
    checkpoint: () => db.exec("pragma wal_checkpoint(truncate)"),
    transaction(fn) {
      db.exec("begin immediate");
      try {
        const result = fn();
        db.exec("commit");
        return result;
      } catch (e) {
        db.exec("rollback");
        throw e;
      }
    },
  };
}
