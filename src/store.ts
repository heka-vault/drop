import { createHash } from "node:crypto";
import { base64url, MAX_BLOB_BYTES, MIN_BLOB_BYTES } from "./envelope.js";
import type { Sql } from "./sql.ts";

/** Who is calling the API: resolved from a bearer token. */
export interface Principal {
  tokenId: number;
  name: string;
}

export interface NewDrop {
  blob: Uint8Array;
  /** Hex SHA-256 of the reveal token (see envelope.js revealHash). */
  revealHash: string;
  /** How many times it can be revealed. Default 1. */
  maxOpens?: number;
  /** Seconds until it expires. Default 24 hours. */
  ttlSeconds?: number;
  /** Non-secret note for the sender and, later, Discord. The server can read it. */
  label?: string;
}

/** A pending drop as its creator sees it. Never includes the blob. */
export interface DropSummary {
  id: string;
  label: string | null;
  opensLeft: number;
  expiresAt: string;
}

/** One audited event: who, what, which drop, when. Never a blob, label, hash or token. */
export interface AuditEntry {
  at: string;
  actor: string;
  action: "create" | "reveal" | "revoke";
  dropId: string;
}

/** A request Drop refuses. The status is what the HTTP layer returns. */
export class DropError extends Error {
  constructor(readonly status: 400 | 404, message: string) {
    super(message);
  }
}

const TOKEN_PREFIX = "hdt_";
const MAX_OPENS = 10;
const MAX_TTL_SECONDS = 7 * 24 * 3600;
const DEFAULT_TTL_SECONDS = 24 * 3600;

const SCHEMA = [
  `create table if not exists tokens (
    id integer primary key,
    name text not null,
    token_hash text not null unique,
    revoked_at integer
  )`,
  `create table if not exists drops (
    id text primary key,
    blob blob not null,
    reveal_hash text not null,
    label text,
    opens_left integer not null,
    expires_at integer not null,
    token_id integer not null references tokens(id)
  )`,
  `create table if not exists audit (
    id integer primary key,
    at integer not null,
    actor text not null,
    action text not null,
    drop_id text not null
  )`,
];

const isIntIn = (n: number, min: number, max: number) =>
  Number.isInteger(n) && n >= min && n <= max;
const random = (n: number) => base64url(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** All of Drop's rules: tokens, drops, opens, expiry, ownership and audit. Routes stay thin. */
export class DropStore {
  readonly #sql: Sql;
  readonly #now: () => number;

  constructor(sql: Sql, now: () => number = Date.now) {
    this.#sql = sql;
    this.#now = now;
    for (const statement of SCHEMA) sql.run(statement);
  }

  /** Create an API token; returns it once. Only its hash is stored. */
  createToken(name: string): string {
    const token = TOKEN_PREFIX + random(32);
    this.#sql.run("insert into tokens (name, token_hash) values (?, ?)", name, sha256(token));
    return token;
  }

  authenticate(token: string): Principal | null {
    const [row] = this.#sql.all<{ id: number; name: string }>(
      "select id, name from tokens where token_hash = ? and revoked_at is null",
      sha256(token),
    );
    return row ? { tokenId: row.id, name: row.name } : null;
  }

  /** Revoke every live token with this name; returns how many. Their existing drops stay. */
  revokeToken(name: string): number {
    return this.#sql.run(
      "update tokens set revoked_at = ? where name = ? and revoked_at is null",
      this.#now(),
      name,
    );
  }

  create(by: Principal, drop: NewDrop): { id: string; expiresAt: string } {
    const { blob, revealHash, maxOpens = 1, ttlSeconds = DEFAULT_TTL_SECONDS, label = null } = drop;
    if (!isIntIn(maxOpens, 1, MAX_OPENS)) throw new DropError(400, "maxOpens must be 1-10");
    if (!isIntIn(ttlSeconds, 1, MAX_TTL_SECONDS)) {
      throw new DropError(400, "ttl must be at most 7 days");
    }
    if (!isIntIn(blob.length, MIN_BLOB_BYTES, MAX_BLOB_BYTES)) {
      throw new DropError(400, "blob size out of range");
    }
    if (!/^[0-9a-f]{64}$/.test(revealHash)) {
      throw new DropError(400, "revealHash must be 64 hex chars");
    }
    if (label !== null && !(label.length <= 200 && !/[\p{Cc}\p{Cf}]/u.test(label))) {
      throw new DropError(400, "label must be at most 200 characters on one line");
    }
    const id = random(16);
    const expiresAt = this.#now() + ttlSeconds * 1000;
    this.#sql.transaction(() => {
      this.#sql.run(
        `insert into drops (id, blob, reveal_hash, label, opens_left, expires_at, token_id)
         values (?, ?, ?, ?, ?, ?, ?)`,
        id,
        blob,
        revealHash,
        label,
        maxOpens,
        expiresAt,
        by.tokenId,
      );
      this.#record(by.name, "create", id);
    });
    return { id, expiresAt: new Date(expiresAt).toISOString() };
  }

  list(by: Principal): DropSummary[] {
    return this.#sql.all<
      { id: string; label: string | null; opens_left: number; expires_at: number }
    >(
      `select id, label, opens_left, expires_at from drops
       where token_id = ? and expires_at > ? order by expires_at`,
      by.tokenId,
      this.#now(),
    ).map((r) => ({
      id: r.id,
      label: r.label,
      opensLeft: r.opens_left,
      expiresAt: new Date(r.expires_at).toISOString(),
    }));
  }

  /** Delete one of the caller's pending drops before it is opened. */
  revoke(by: Principal, id: string): void {
    this.#sql.transaction(() => {
      const n = this.#sql.run("delete from drops where id = ? and token_id = ?", id, by.tokenId);
      if (n === 0) throw new DropError(404, "no such drop");
      this.#record(by.name, "revoke", id);
    });
  }

  /** Spend one open and return the blob, or null if the drop is not available to this hash. */
  reveal(id: string, revealHash: string): Uint8Array<ArrayBuffer> | null {
    return this.#sql.transaction(() => {
      const [row] = this.#sql.all<{ blob: Uint8Array<ArrayBuffer>; opens_left: number }>(
        "select blob, opens_left from drops where id = ? and reveal_hash = ? and expires_at > ?",
        id,
        revealHash,
        this.#now(),
      );
      if (!row) return null;
      if (row.opens_left > 1) {
        this.#sql.run("update drops set opens_left = opens_left - 1 where id = ?", id);
      } else {
        this.#sql.run("delete from drops where id = ?", id);
      }
      this.#record("anonymous", "reveal", id);
      return row.blob;
    });
  }

  /**
   * Delete expired drops' ciphertext and flush deleted data to disk. Run on a timer; reads already
   * ignore expired drops, and revealed or revoked ones are deleted at once.
   */
  purgeExpired(): void {
    this.#sql.run("delete from drops where expires_at <= ?", this.#now());
    this.#sql.checkpoint();
  }

  audit(): AuditEntry[] {
    return this.#sql.all<
      { at: number; actor: string; action: AuditEntry["action"]; drop_id: string }
    >(
      "select at, actor, action, drop_id from audit order by id",
    ).map((r) => ({
      at: new Date(r.at).toISOString(),
      actor: r.actor,
      action: r.action,
      dropId: r.drop_id,
    }));
  }

  #record(actor: string, action: AuditEntry["action"], dropId: string): void {
    this.#sql.run(
      "insert into audit (at, actor, action, drop_id) values (?, ?, ?, ?)",
      this.#now(),
      actor,
      action,
      dropId,
    );
  }
}
