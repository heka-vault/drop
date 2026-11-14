import { assertEquals } from "@std/assert";
import { MAX_BLOB_BYTES } from "../src/envelope.js";
import { DropError, DropStore, type NewDrop } from "../src/store.ts";
import { openSqlite } from "../src/sqlite.ts";

const HASH = "a".repeat(64);
const blob = (n = 64) => new Uint8Array(n).fill(7);

function setup() {
  let now = Date.parse("2026-11-14T12:00:00Z");
  const sql = openSqlite(":memory:");
  const store = new DropStore(sql, () => now);
  const alice = store.authenticate(store.createToken("alice"))!;
  return { sql, store, alice, advance: (ms: number) => (now += ms) };
}

Deno.test("a drop reveals once with its reveal hash, then is gone", () => {
  const { store, alice } = setup();
  const { id } = store.create(alice, { blob: blob(), revealHash: HASH });
  assertEquals(store.reveal(id, HASH), blob());
  assertEquals(store.reveal(id, HASH), null);
});

Deno.test("a drop with maxOpens reveals exactly that many times", () => {
  const { store, alice } = setup();
  const { id } = store.create(alice, { blob: blob(), revealHash: HASH, maxOpens: 3 });
  for (let i = 0; i < 3; i++) assertEquals(store.reveal(id, HASH), blob());
  assertEquals(store.reveal(id, HASH), null);
});

Deno.test("a drop expires after its TTL, 24 hours by default", () => {
  const { store, alice, advance } = setup();
  const day = store.create(alice, { blob: blob(), revealHash: HASH, maxOpens: 2 });
  const hour = store.create(alice, { blob: blob(), revealHash: HASH, ttlSeconds: 3600 });
  assertEquals(day.expiresAt, "2026-11-15T12:00:00.000Z");
  assertEquals(hour.expiresAt, "2026-11-14T13:00:00.000Z");

  advance(3600_000);
  assertEquals(store.reveal(hour.id, HASH), null);
  advance(23 * 3600_000 - 1);
  assertEquals(store.reveal(day.id, HASH), blob());
  advance(1);
  assertEquals(store.reveal(day.id, HASH), null);
});

function status(fn: () => unknown): number {
  try {
    fn();
  } catch (e) {
    if (e instanceof DropError) return e.status;
    throw e;
  }
  return 0;
}

Deno.test("create rejects out-of-range options and malformed input", () => {
  const { store, alice } = setup();
  const ok: NewDrop = { blob: blob(), revealHash: HASH };
  // 1 MiB content + 1 KiB meta + length prefix + version + nonce + tag
  assertEquals(MAX_BLOB_BYTES, 1024 * 1024 + 1024 + 4 + 1 + 12 + 16);
  for (
    const good of [
      { maxOpens: 10 },
      { ttlSeconds: 7 * 24 * 3600 },
      { blob: blob(MAX_BLOB_BYTES) },
      { label: "é".repeat(200) },
    ]
  ) assertEquals(status(() => store.create(alice, { ...ok, ...good })), 0, JSON.stringify(good));
  for (
    const bad of [
      { maxOpens: 0 },
      { maxOpens: 11 },
      { maxOpens: 1.5 },
      { ttlSeconds: 0 },
      { ttlSeconds: 7 * 24 * 3600 + 1 },
      { blob: blob(MAX_BLOB_BYTES + 1) },
      { blob: blob(28) },
      { revealHash: "A".repeat(64) },
      { revealHash: "a".repeat(63) },
      { label: "x".repeat(201) },
      { label: "two\nlines" },
      { label: "invoice\u202Egnp.exe" },
    ]
  ) assertEquals(status(() => store.create(alice, { ...ok, ...bad })), 400, JSON.stringify(bad));
});

Deno.test("a wrong reveal hash returns nothing and spends nothing", () => {
  const { store, alice } = setup();
  const { id } = store.create(alice, { blob: blob(), revealHash: HASH });
  assertEquals(store.reveal(id, "b".repeat(64)), null);
  assertEquals(store.reveal(id, HASH), blob());
});

Deno.test("list shows only the caller's pending drops, without blobs", () => {
  const { store, alice, advance } = setup();
  const bob = store.authenticate(store.createToken("bob"))!;
  const kept = store.create(alice, { blob: blob(), revealHash: HASH, label: "db password" });
  const spent = store.create(alice, { blob: blob(), revealHash: HASH });
  store.create(alice, { blob: blob(), revealHash: HASH, ttlSeconds: 60 });
  store.create(bob, { blob: blob(), revealHash: HASH });
  store.reveal(spent.id, HASH);
  advance(60_000);

  assertEquals(store.list(alice), [
    { id: kept.id, label: "db password", opensLeft: 1, expiresAt: kept.expiresAt },
  ]);
});

Deno.test("only the creating token can revoke a drop", () => {
  const { store, alice } = setup();
  const bob = store.authenticate(store.createToken("bob"))!;
  const mine = store.create(alice, { blob: blob(), revealHash: HASH });
  const other = store.create(alice, { blob: blob(), revealHash: HASH });

  assertEquals(status(() => store.revoke(bob, other.id)), 404);
  assertEquals(status(() => store.revoke(alice, "no-such-drop")), 404);
  store.revoke(alice, mine.id);

  assertEquals(store.reveal(mine.id, HASH), null);
  assertEquals(store.reveal(other.id, HASH), blob());
});

Deno.test("audit records who did what to which drop, and nothing secret", () => {
  const { store, alice, advance } = setup();
  const a = store.create(alice, { blob: blob(), revealHash: HASH, label: "db password" });
  const b = store.create(alice, { blob: blob(), revealHash: HASH });
  advance(1000);
  store.reveal(a.id, "b".repeat(64));
  store.reveal(a.id, HASH);
  store.revoke(alice, b.id);

  assertEquals(store.audit(), [
    { at: "2026-11-14T12:00:00.000Z", actor: "alice", action: "create", dropId: a.id },
    { at: "2026-11-14T12:00:00.000Z", actor: "alice", action: "create", dropId: b.id },
    { at: "2026-11-14T12:00:01.000Z", actor: "anonymous", action: "reveal", dropId: a.id },
    { at: "2026-11-14T12:00:01.000Z", actor: "alice", action: "revoke", dropId: b.id },
  ]);
});

Deno.test("ciphertext is deleted from storage at the last open and by the expiry purge", () => {
  // The README promises deletion, which only storage can show, so this test reads it directly.
  const { sql, store, alice, advance } = setup();
  const blobs = () => sql.all<{ n: number }>("select count(*) as n from drops")[0].n;
  const opened = store.create(alice, { blob: blob(), revealHash: HASH });
  store.create(alice, { blob: blob(), revealHash: HASH, ttlSeconds: 60 });
  store.create(alice, { blob: blob(), revealHash: HASH, ttlSeconds: 120 });

  store.reveal(opened.id, HASH);
  assertEquals(blobs(), 2);
  advance(60_000);
  store.purgeExpired();
  assertEquals(blobs(), 1);
});

Deno.test("deleted ciphertext and raw tokens are not left anywhere in the database files", () => {
  // Reads the files on purpose: the promise is about what an attacker who copies them can recover.
  const dir = Deno.makeTempDirSync();
  let now = Date.parse("2026-11-14T12:00:00Z");
  const store = new DropStore(openSqlite(`${dir}/drop.db`), () => now);
  const token = store.createToken("alice");
  const alice = store.authenticate(token)!;
  const marked = (tag: string) => new TextEncoder().encode(tag.repeat(16));
  const revealed = store.create(alice, { blob: marked("REVEALED"), revealHash: HASH });
  const revoked = store.create(alice, { blob: marked("REVOKED!"), revealHash: HASH });
  store.create(alice, { blob: marked("EXPIRED!"), revealHash: HASH, ttlSeconds: 60 });
  store.create(alice, { blob: marked("PENDING!"), revealHash: HASH });
  store.reveal(revealed.id, HASH);
  store.revoke(alice, revoked.id);
  now += 60_000;
  store.purgeExpired();

  const files = [...Deno.readDirSync(dir)].map((f) => Deno.readFileSync(`${dir}/${f.name}`));
  const found = (s: string) => files.some((f) => new TextDecoder("latin1").decode(f).includes(s));
  assertEquals(found("PENDING!PENDING!"), true);
  for (const gone of ["REVEALED", "REVOKED!", "EXPIRED!", token.slice(4)]) {
    assertEquals(found(gone), false, gone);
  }
});

Deno.test("a revoked API token stops working; links it already made still reveal", () => {
  const { store } = setup();
  const token = store.createToken("leaky");
  const leaky = store.authenticate(token)!;
  const { id } = store.create(leaky, { blob: blob(), revealHash: HASH });

  assertEquals(store.revokeToken("leaky"), 1);
  assertEquals(store.authenticate(token), null);
  assertEquals(store.revokeToken("leaky"), 0);
  assertEquals(store.revokeToken("nobody"), 0);
  assertEquals(store.reveal(id, HASH), blob());
});
