# 0001: First slice — plain drops, end to end

Status: accepted and implemented (revised after review by Fable and Astra)

The first vertical slice is a **plain drop** (no sign-in) going all the way through: the `drop` CLI
encrypts a value, the API stores ciphertext, the recipient opens the link, clicks Reveal, and the
browser decrypts. Sign-in-required drops, people, Discord, Vault reads, and reverse drops come later
and must fit on top without reworking this.

## What this protects, and what it does not

- The server and its database never hold plaintext or a key. A copy of the database is useless.
- **The link is the secret until it is opened.** It passes through agent stdout, transcripts, chat,
  and Discord. The guarantee is single use plus an open notification, so a stolen link is noticed.
  `maxOpens > 1` weakens this.
- **The decryptor is served by the server.** Whoever controls the origin or the TLS-terminating edge
  (Cloudflare) can serve JavaScript that steals the key. CSP does not prevent this. We accept that
  trust for v1, and require Cloudflare features that inject or rewrite scripts (Rocket Loader, Web
  Analytics, Zaraz, email obfuscation) to be off. A `drop open <url>` CLI path can later serve
  recipients who will not trust served JavaScript.
- An open is spent when ciphertext is **delivered**, not when it decrypts. If the response is lost,
  the sender sends again.
- Ciphertext length reveals plaintext length (roughly). Accepted for v1; padding can come later in a
  new version.

## Envelope (one module, used by CLI and browser)

`src/envelope.js` is plain JavaScript with JSDoc types and uses only WebCrypto, so Deno imports it
and the redeem page loads the same file unbuilt. There is exactly one implementation of the format.

- **Link secret:** 32 random bytes from `crypto.getRandomValues`, one per drop. The fragment is
  `base64url(secret)` without padding: exactly 43 canonical characters, decoded to exactly 32 bytes,
  anything else rejected.
- **Derived keys** (HKDF-SHA-256, empty salt):
  - `encKey` with info `heka-drop/v1/enc`: AES-256-GCM key, imported non-extractable, one usage.
  - `revealToken` with info `heka-drop/v1/reveal`: 32 bytes. The CLI uploads `SHA-256(revealToken)`;
    the browser presents `revealToken` to reveal. Someone holding only the drop id (from logs or
    history) cannot spend an open or fetch the ciphertext.
- **Cipher:** AES-256-GCM, 12-byte random nonce, 128-bit tag, AAD = UTF-8 `heka-drop/v1`.
- **Blob:** `0x01 || nonce(12) || ciphertext+tag`. The version byte selects the format; unknown
  versions are rejected. Decryption authenticates before any parsing.
- **Plaintext framing:** `u32be(len(meta)) || meta || content`. `meta` is UTF-8 JSON, either
  `{ "kind": "text" }` or `{ "kind": "file", "name": string }` with no other keys, at most 1 KiB,
  decoded with fatal UTF-8. `name` must be one plain path segment: non-empty, not `.` or `..`,
  well-formed Unicode, with no control, format (bidi, zero-width), `/` or `\` characters. `seal` and
  `open` both enforce this, and `open` also enforces the content and blob size limits.
- **Size:** content at most 1 MiB, so the largest blob is `1 MiB + 1 KiB + 4 + 1 + 12 + 16` bytes.
  The server enforces that limit while streaming the upload.

## Server

Two Hono apps from one process, on two ports, sharing one `DropStore`:

- **API app** (bound to loopback or a private interface, and firewalled; never routed through the
  tunnel; HTTPS for any non-loopback use). Bearer-token auth.
  - `POST /api/v1/drops`: body is the blob (`application/octet-stream`). Headers:
    `x-drop-reveal-hash` (hex SHA-256 of the reveal token), `x-drop-label` (optional, non-secret,
    visible to the server and later to Discord), `x-drop-max-opens` (1–10, default 1), `x-drop-ttl`
    (seconds, at most 7 days, default 24 h). Returns `{ id, expiresAt }`.
  - `GET /api/v1/drops`: this token's pending drops (metadata only).
  - `DELETE /api/v1/drops/:id`: revoke one of this token's drops.
- **Public app** (behind the tunnel):
  - `GET /d/:id` serves the same static page for every id. It does not touch the database and shows
    no label or state, so it is not an existence oracle for scanners or preview bots.
  - `POST /d/:id/reveal` with the reveal token as the body. It requires `x-drop-reveal: 1`; if
    `Sec-Fetch-Site` is present it must be `same-origin`, and if it is absent there must be no
    `Origin` either (a non-browser client, which is not a CSRF vector and still needs the reveal
    token). Guard failures are a 403 that spends nothing. No CORS headers are ever sent. In one
    transaction it checks expiry, opens left, and the token hash; returns the blob; decrements; and
    deletes the blob on the last open. A wrong token spends nothing. Unknown, expired, revoked,
    used-up, and wrong-token cases return the identical 404 (status, headers, body). No artificial
    delays.
  - Paths under `/s/` are reserved for sign-in-required drops.

`DropStore` holds all the rules (opens, expiry, ownership, token check, audit) and takes the
caller's `Principal` and an injected clock. Routes stay thin, as in Heka Vault.

- Drop ids: 16 random bytes, base64url. Stored per drop: id, blob, reveal hash, label, opens left,
  expiry, and creating token id. The `requires_signin` column is added with that slice, not before.
- `DropStore` reaches storage only through the small synchronous `Sql` port (`src/sql.ts`), with a
  `node:sqlite` adapter. Cloudflare Durable Object SQLite fits the same port, which keeps a Workers
  deployment open without changing the rules or their tests.
- API tokens: `hdt_` + 32 random bytes base64url, stored as SHA-256, created with
  `main.ts create-token`.
- Queries filter on `expires_at > now`; a timer deletes expired rows.
- Audit rows: action, drop id, token name or "anonymous", time. Never the blob, key, token, or
  label.

**Public-page headers:**
`Content-Security-Policy: default-src 'none'; script-src 'self';
style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
`Referrer-Policy: no-referrer`, `Cache-Control: no-store, no-transform`,
`X-Content-Type-Options: nosniff`, `Cross-Origin-Opener-Policy: same-origin`,
`Cross-Origin-Resource-Policy: same-origin`, `Strict-Transport-Security`, `X-Robots-Tag: noindex`.
No third-party scripts, analytics, or service workers.

**Redeem page behaviour:** on load it reads `location.hash`, validates it, keeps the secret in
memory and clears the hash with `history.replaceState`. A missing or malformed fragment shows an
error without calling the server. Reveal is disabled after one click and never retried
automatically. Text is shown with `textContent`. Files are offered as an `application/octet-stream`
download with a sanitized base name, never rendered.

## CLI

`drop send [--file PATH] [--label L] [--opens N] [--ttl 24h]` reads stdin (or the file), seals it,
posts the blob, and prints only the link. It builds the link itself from the configured public
origin and a validated id (`<DROP_PUBLIC_URL>/d/<id>#<secret>`), never from a URL the server
returns. `DROP_API_URL`, `DROP_PUBLIC_URL` and `DROP_TOKEN` come from the environment; both URLs
must be HTTPS unless the host is loopback. Reading from Heka Vault is a later slice.

## Room for later features

- **Sign-in-required drops.** `/d/:id` stays public for every drop. For a sign-in drop, the page
  stores the secret in the tab's `sessionStorage`, clears the hash, and navigates to the
  Access-protected `/s/:id`, which returns to a page that takes the secret back out and deletes it.
  Reveal goes to an Access-protected endpoint that verifies `Cf-Access-Jwt-Assertion` (signature and
  audience). Keys never go into OAuth state, query strings, or cookies. The envelope does not
  change.
- **Reverse drops.** Version `0x02`, HPKE (RFC 9180) base mode: DHKEM(X25519, HKDF-SHA-256),
  HKDF-SHA-256, AES-256-GCM, with `info = "heka-drop/v2" || requestId`, same plaintext framing. The
  CLI makes a keypair per request and keeps the private key on the host. The request link's fragment
  carries the public key (or its hash), so the browser can check that the server did not substitute
  its own. Links under `/r/` rather than `/d/` say what the fragment means.

## Not in this slice

Cloudflare Access / sign-in-required drops, addressed drops, people, Discord, reverse drops, Vault
integration, and length padding.
