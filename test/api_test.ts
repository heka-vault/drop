import { assertEquals } from "@std/assert";
import { apiApp } from "../src/api.ts";
import { MAX_BLOB_BYTES, seal } from "../src/envelope.js";
import { openSqlite } from "../src/sqlite.ts";
import { DropStore } from "../src/store.ts";

async function setup() {
  const store = new DropStore(openSqlite(":memory:"));
  const token = store.createToken("alice");
  const app = apiApp(store);
  const sealed = await seal(new TextEncoder().encode("hunter2"), { kind: "text" });
  const call = (
    method: string,
    path: string,
    init: { token?: string; headers?: HeadersInit; body?: BodyInit } = {},
  ) =>
    app.request(path, {
      method,
      body: init.body,
      headers: {
        ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
        ...init.headers,
      },
    });
  const create = (headers: Record<string, string> = {}, t = token) =>
    call("POST", "/api/v1/drops", {
      token: t,
      body: sealed.blob,
      headers: {
        "content-type": "application/octet-stream",
        "x-drop-reveal-hash": sealed.revealHash,
        ...headers,
      },
    });
  return { store, token, call, create, sealed };
}

Deno.test("API: creating a drop needs a valid token and returns its id and expiry", async () => {
  const { create } = await setup();
  assertEquals((await create({}, "")).status, 401);
  assertEquals((await create({}, "hdt_nope")).status, 401);

  const res = await create({ "x-drop-label": "db password", "x-drop-max-opens": "2" });
  assertEquals(res.status, 201);
  const body = await res.json();
  assertEquals(Object.keys(body).sort(), ["expiresAt", "id"]);
  assertEquals(body.id.length, 22);
});

Deno.test("API: bad options are a 400 and an oversized body a 413", async () => {
  const { call, create, token } = await setup();
  const bad = await create({ "x-drop-max-opens": "11" });
  assertEquals(bad.status, 400);
  assertEquals(await bad.json(), { error: "maxOpens must be 1-10" });
  assertEquals((await create({ "x-drop-ttl": "soon" })).status, 400);
  for (const loose of ["0x5", "1e0", "3.0", "+3"]) {
    assertEquals((await create({ "x-drop-max-opens": loose })).status, 400, loose);
  }
  assertEquals((await create({ "x-drop-reveal-hash": "nope" })).status, 400);

  const huge = await call("POST", "/api/v1/drops", {
    token,
    body: new Uint8Array(MAX_BLOB_BYTES + 1),
    headers: { "x-drop-reveal-hash": "a".repeat(64) },
  });
  assertEquals(huge.status, 413);
});

Deno.test("API: list shows the caller's drops; delete revokes only the caller's own", async () => {
  const { store, call, create, token } = await setup();
  const bob = store.createToken("bob");
  const { id, expiresAt } = await (await create({ "x-drop-label": "db password" })).json();

  assertEquals(await (await call("GET", "/api/v1/drops", { token })).json(), [
    { id, label: "db password", opensLeft: 1, expiresAt },
  ]);
  assertEquals(await (await call("GET", "/api/v1/drops", { token: bob })).json(), []);
  assertEquals((await call("DELETE", `/api/v1/drops/${id}`, { token: bob })).status, 404);
  assertEquals((await call("DELETE", `/api/v1/drops/${id}`, { token })).status, 204);
  assertEquals(await (await call("GET", "/api/v1/drops", { token })).json(), []);
});

Deno.test("API: health needs no token", async () => {
  const { call } = await setup();
  assertEquals((await call("GET", "/api/v1/health")).status, 200);
});

Deno.test("API: every drops route needs a well-formed Bearer token", async () => {
  const { call, token } = await setup();
  for (const auth of [undefined, `bearer ${token}`, `Bearer ${token} x`, "Bearer", token]) {
    for (
      const [method, path] of [["POST", "/api/v1/drops"], ["GET", "/api/v1/drops"], [
        "DELETE",
        "/api/v1/drops/x",
      ]]
    ) {
      const res = await call(method, path, { headers: auth ? { authorization: auth } : {} });
      assertEquals(res.status, 401, `${method} ${path} with ${auth?.slice(0, 7)}`);
    }
  }
});
