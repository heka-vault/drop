import { Hono } from "@hono/hono";
import { bodyLimit } from "@hono/hono/body-limit";
import { MAX_BLOB_BYTES } from "./envelope.js";
import { DropError, type DropStore, type Principal } from "./store.ts";

type Env = { Variables: { principal: Principal } };

/** Optional integer header: absent → undefined; plain digits → number; anything else → NaN. */
const intHeader = (value: string | undefined) =>
  value === undefined ? undefined : /^\d{1,9}$/.test(value) ? Number(value) : NaN;

/**
 * The private API that creates, lists and revokes drops. Never exposed through the tunnel.
 * Routes only translate HTTP; every rule lives in DropStore.
 */
export function apiApp(store: DropStore): Hono<Env> {
  const app = new Hono<Env>().basePath("/api/v1");

  app.onError((err, c) => {
    if (err instanceof DropError) return c.json({ error: err.message }, err.status);
    throw err;
  });

  app.get("/health", (c) => c.json({ ok: true }));

  app.use("/drops/*", async (c, next) => {
    const token = c.req.header("authorization")?.match(/^Bearer (\S+)$/)?.[1];
    const principal = token ? store.authenticate(token) : null;
    if (!principal) return c.json({ error: "unauthorized" }, 401);
    c.set("principal", principal);
    await next();
  });

  app.post(
    "/drops",
    bodyLimit({ maxSize: MAX_BLOB_BYTES, onError: (c) => c.json({ error: "too large" }, 413) }),
    async (c) => {
      const drop = store.create(c.get("principal"), {
        blob: new Uint8Array(await c.req.arrayBuffer()),
        revealHash: c.req.header("x-drop-reveal-hash") ?? "",
        label: c.req.header("x-drop-label"),
        maxOpens: intHeader(c.req.header("x-drop-max-opens")),
        ttlSeconds: intHeader(c.req.header("x-drop-ttl")),
      });
      return c.json(drop, 201);
    },
  );

  app.get("/drops", (c) => c.json(store.list(c.get("principal"))));

  app.delete("/drops/:id", (c) => {
    store.revoke(c.get("principal"), c.req.param("id"));
    return c.body(null, 204);
  });

  return app;
}
