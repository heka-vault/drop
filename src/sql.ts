/**
 * The storage port DropStore depends on. Synchronous on purpose: both `node:sqlite` (container)
 * and Durable Object SQLite storage (a possible Cloudflare target) fit it, so the rules in
 * DropStore and their tests are the same on either.
 */
export type SqlValue = string | number | null | Uint8Array;

export interface Sql {
  /** Run a statement; returns the number of rows it changed. */
  run(sql: string, ...params: SqlValue[]): number;
  all<T>(sql: string, ...params: SqlValue[]): T[];
  /** Run fn atomically: all of its writes commit together or none do. */
  transaction<T>(fn: () => T): T;
  /** Push deleted data out of any write-ahead log so it is gone from disk. No-op if there is none. */
  checkpoint(): void;
}
