import { assertEquals } from "@std/assert";
import { open, revealToken, seal } from "../src/envelope.js";
import { publicApp } from "../src/public.ts";
import { openSqlite } from "../src/sqlite.ts";
import { DropStore } from "../src/store.ts";

async function setup() {
  let now = Date.parse("2026-11-14T12:00:00Z");
  const store = new DropStore(openSqlite(":memory:"), () => now);
  const alice = store.authenticate(store.createToken("alice"))!;
  const sealed = await seal(new TextEncoder().encode("hunter2"), { kind: "text" });
  const create = (ttlSeconds?: number) =>
    store.create(alice, { blob: sealed.blob, revealHash: sealed.revealHash, ttlSeconds }).id;
  const id = create();
  return {
    app: publicApp(store),
    store,
    alice,
    id,
    sealed,
    create,
    advance: (ms: number) => (now += ms),
  };
}

const SECURITY_HEADERS = {
  "content-security-policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; " +
    "base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store, no-transform",
  "x-content-type-options": "nosniff",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "strict-transport-security": "max-age=31536000",
  "x-robots-tag": "noindex",
};

const SAME_ORIGIN = { "x-drop-reveal": "1", "sec-fetch-site": "same-origin" };

const reveal = (
  app: ReturnType<typeof publicApp>,
  id: string,
  body: string,
  headers: Record<string, string> = SAME_ORIGIN,
) => app.request(`/d/${id}/reveal`, { method: "POST", body, headers });

const pick = (headers: Headers, names: string[]) =>
  Object.fromEntries(names.map((n) => [n, headers.get(n)]));

Deno.test("public: the redeem page is identical for every id and carries the security headers", async () => {
  const { app, id } = await setup();
  const real = await app.request(`/d/${id}`);
  const fake = await app.request("/d/AAAAAAAAAAAAAAAAAAAAAA");

  assertEquals(real.status, 200);
  assertEquals(pick(real.headers, Object.keys(SECURITY_HEADERS)), SECURITY_HEADERS);
  assertEquals([...real.headers], [...fake.headers]);
  assertEquals(await real.text(), await fake.text());
});

Deno.test("public: reveal returns the blob once for the reveal token, then 404", async () => {
  const { app, id, sealed } = await setup();
  const res = await reveal(app, id, await revealToken(sealed.secret));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "application/octet-stream");
  const opened = await open(new Uint8Array(await res.arrayBuffer()), sealed.secret);
  assertEquals(new TextDecoder().decode(opened.content), "hunter2");

  assertEquals((await reveal(app, id, await revealToken(sealed.secret))).status, 404);
});

Deno.test("public: cross-site or header-less reveals are refused without spending an open", async () => {
  const { app, id, sealed } = await setup();
  const token = await revealToken(sealed.secret);
  const refused: Record<string, string>[] = [
    { "sec-fetch-site": "same-origin" },
    { "x-drop-reveal": "true", "sec-fetch-site": "same-origin" },
    { "x-drop-reveal": "1", "sec-fetch-site": "cross-site" },
    { "x-drop-reveal": "1", "sec-fetch-site": "same-site" },
    { "x-drop-reveal": "1", "sec-fetch-site": "none" },
    { "x-drop-reveal": "1", origin: "https://evil.example" },
  ];
  for (const headers of refused) {
    const res = await reveal(app, id, token, headers);
    assertEquals(res.status, 403, JSON.stringify(headers));
    assertEquals(res.headers.get("access-control-allow-origin"), null);
  }
  assertEquals((await reveal(app, id, token)).status, 200);
});

Deno.test("public: a non-browser client (no fetch metadata, no Origin) can reveal", async () => {
  const { app, id, sealed } = await setup();
  const res = await reveal(app, id, await revealToken(sealed.secret), { "x-drop-reveal": "1" });
  assertEquals(res.status, 200);
});

Deno.test("public: every failed reveal is the same 404", async () => {
  const { app, store, alice, sealed, create, advance } = await setup();
  const token = await revealToken(sealed.secret);
  const other = await revealToken((await seal(new Uint8Array(1), { kind: "text" })).secret);
  const usedUp = create();
  await reveal(app, usedUp, token);
  const revoked = create();
  store.revoke(alice, revoked);
  const expired = create(60);
  const wrong = create();
  advance(60_000);

  const failures = [
    await reveal(app, "no-such-drop", token),
    await reveal(app, wrong, other),
    await reveal(app, wrong, "not a token"),
    await reveal(app, expired, token),
    await reveal(app, revoked, token),
    await reveal(app, usedUp, token),
  ];
  const seen = await Promise.all(
    failures.map(async (r) => JSON.stringify([r.status, [...r.headers], await r.text()])),
  );
  assertEquals(failures[0].status, 404);
  assertEquals(new Set(seen).size, 1, seen.join("\n"));
});

Deno.test("public: the browser loads the same envelope.js the tests exercise", async () => {
  const { app } = await setup();
  const envelope = await app.request("/assets/envelope.js");
  assertEquals(envelope.headers.get("content-type"), "text/javascript; charset=utf-8");
  assertEquals(
    await envelope.text(),
    Deno.readTextFileSync(new URL("../src/envelope.js", import.meta.url)),
  );
  assertEquals((await app.request("/assets/redeem.js")).status, 200);
  assertEquals(
    (await app.request("/assets/style.css")).headers.get("content-type"),
    "text/css; charset=utf-8",
  );
  assertEquals((await app.request("/assets/../store.ts")).status, 404);
  assertEquals((await app.request("/assets/nope.js")).status, 404);
});

Deno.test("public: security headers are on every response, and only known paths exist", async () => {
  const { app, id } = await setup();
  const responses = [
    await app.request("/nope"),
    await app.request("/api/v1/drops", { method: "POST" }),
    await app.request("/assets/__proto__"),
    await app.request("/assets/constructor"),
    await app.request("/assets/redeem.js"),
    await reveal(app, id, "x", { "sec-fetch-site": "cross-site" }),
    await reveal(app, "no-such-drop", "x"),
  ];
  assertEquals(responses.map((r) => r.status), [404, 404, 404, 404, 200, 403, 404]);
  for (const r of responses) {
    assertEquals(pick(r.headers, Object.keys(SECURITY_HEADERS)), SECURITY_HEADERS, r.url);
  }
});

Deno.test("public: a refused reveal leaves a multi-open drop's opens untouched", async () => {
  const { app, store, alice, sealed } = await setup();
  const { id } = store.create(alice, {
    blob: sealed.blob,
    revealHash: sealed.revealHash,
    maxOpens: 2,
  });
  const token = await revealToken(sealed.secret);
  await reveal(app, id, token, { "x-drop-reveal": "1", "sec-fetch-site": "cross-site" });
  await reveal(app, id, token, { "sec-fetch-site": "same-origin" });
  assertEquals(store.list(alice).find((d) => d.id === id)?.opensLeft, 2);
});

Deno.test("public: oversized and chunked reveal bodies get the same 404", async () => {
  const { app, id, sealed } = await setup();
  const baseline = await reveal(app, "no-such-drop", await revealToken(sealed.secret));
  const chunked = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array(40).fill(65));
      c.enqueue(new Uint8Array(40).fill(65));
      c.close();
    },
  });
  for (
    const res of [
      await reveal(app, id, "A".repeat(65)),
      await app.request(`/d/${id}/reveal`, { method: "POST", body: chunked, headers: SAME_ORIGIN }),
    ]
  ) {
    assertEquals(res.status, 404);
    assertEquals(await res.text(), await baseline.clone().text());
  }
  assertEquals((await reveal(app, id, await revealToken(sealed.secret))).status, 200);
});
