import { Hono } from "@hono/hono";
import { bodyLimit } from "@hono/hono/body-limit";
import { revealHash } from "./envelope.js";
import type { DropStore } from "./store.ts";

const SECURITY_HEADERS: Record<string, string> = {
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

/**
 * Only the redeem page's own script may spend an open. Browsers always send Sec-Fetch-Site, and a
 * cross-origin fetch with a custom header needs a CORS preflight we never answer, so link
 * previews, forms and other sites are refused. A non-browser client (no fetch metadata and no
 * Origin) is allowed: it is not a CSRF vector, and it still needs the reveal token.
 */
function isSameOriginReveal(headers: (name: string) => string | undefined): boolean {
  if (headers("x-drop-reveal") !== "1") return false;
  const site = headers("sec-fetch-site");
  if (site !== undefined) return site === "same-origin";
  return headers("origin") === undefined;
}

export const DEFAULT_SOURCE_URL = "https://github.com/heka-vault/drop";

/**
 * Where the code behind this page lives, so a recipient can read it: the repository, pinned to the
 * deployed commit when one is known. Only https URLs and hex commit ids are accepted, so nothing
 * from configuration can break out of the attribute it is placed in.
 */
function sourceLink(sourceUrl: string, revision?: string): string {
  const url = URL.parse(sourceUrl);
  if (url?.protocol !== "https:" || url.search || url.hash) {
    throw new Error("source URL must be a plain https:// URL");
  }
  if (revision !== undefined && !/^[0-9a-f]{7,40}$/.test(revision)) {
    throw new Error("revision must be a git commit id");
  }
  const base = url.href.replace(/\/+$/, "");
  return revision ? `${base}/tree/${revision}` : base;
}

/** The same page for every drop id: it never touches the store, so it reveals nothing. */
function redeemPage(source: string, revision?: string): string {
  const version = revision ? ` (version ${revision.slice(0, 7)})` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Heka Drop</title>
<link rel="stylesheet" href="/assets/style.css">
<script type="module" src="/assets/redeem.js"></script>
</head>
<body>
<main>
<h1>Someone sent you a secret</h1>
<p id="status">It can be revealed a limited number of times, then it is deleted.</p>
<button id="reveal" type="button" disabled>Reveal</button>
<pre id="secret" hidden></pre>
<p><a id="download" hidden>Download file</a></p>
</main>
<footer>
<p>Decrypted only in your browser. This page is open source:
<a id="source" href="${source}" target="_blank" rel="noopener noreferrer">read the code</a>${version}.</p>
</footer>
</body>
</html>
`;
}

export type Assets = Record<string, { type: string; body: string }>;

/** The redeem page's static files, read once at startup. envelope.js is the same file the CLI uses. */
export function readAssets(): Assets {
  const read = (file: string) => Deno.readTextFileSync(new URL(file, import.meta.url));
  const js = "text/javascript; charset=utf-8";
  return {
    "envelope.js": { type: js, body: read("./envelope.js") },
    "redeem.js": { type: js, body: read("./redeem.js") },
    "style.css": { type: "text/css; charset=utf-8", body: read("./redeem.css") },
  };
}

/**
 * The internet-facing app: the redeem page, its assets, and the reveal endpoint. Routes only
 * translate HTTP; every rule lives in DropStore.
 */
export function publicApp(
  store: DropStore,
  { assets = readAssets(), sourceUrl = DEFAULT_SOURCE_URL, revision }: {
    assets?: Assets;
    /** Repository the page links to, for recipients who want to read the code. */
    sourceUrl?: string;
    /** Deployed commit id; pins the link to the exact code that is running. */
    revision?: string;
  } = {},
): Hono {
  const page = redeemPage(sourceLink(sourceUrl, revision), revision);
  const app = new Hono();
  /** Every failure looks the same: unknown, expired, used up, revoked, wrong token, malformed. */
  const notFound = () => new Response("not found", { status: 404 });

  app.use("*", async (c, next) => {
    await next();
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) c.header(name, value);
  });

  app.get("/d/:id", (c) => c.html(page));

  app.get("/assets/:name", (c) => {
    const asset = Object.hasOwn(assets, c.req.param("name")) ? assets[c.req.param("name")] : null;
    return asset ? c.body(asset.body, 200, { "content-type": asset.type }) : notFound();
  });

  app.post("/d/:id/reveal", bodyLimit({ maxSize: 64, onError: notFound }), async (c) => {
    if (!isSameOriginReveal((name) => c.req.header(name))) return c.text("forbidden", 403);
    let hash;
    try {
      hash = await revealHash(await c.req.text());
    } catch {
      return notFound();
    }
    const blob = store.reveal(c.req.param("id"), hash);
    if (!blob) return notFound();
    return c.body(blob, 200, { "content-type": "application/octet-stream" });
  });

  return app;
}
