import { assertEquals, assertRejects } from "@std/assert";
import vectors from "./vectors.json" with { type: "json" };
import {
  EnvelopeError,
  MAX_BLOB_BYTES,
  MAX_CONTENT_BYTES,
  open,
  revealHash,
  revealToken,
  seal,
} from "../src/envelope.js";

const utf8 = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array) => new TextDecoder().decode(b);

Deno.test("text sealed with a fresh secret opens with that secret", async () => {
  const { blob, secret } = await seal(utf8("hunter2"), { kind: "text" });
  const opened = await open(blob, secret);
  assertEquals(opened.meta, { kind: "text" });
  assertEquals(text(opened.content), "hunter2");
});

Deno.test("a blob does not open with another drop's secret", async () => {
  const { blob } = await seal(utf8("hunter2"), { kind: "text" });
  const other = await seal(utf8("x"), { kind: "text" });
  await assertRejects(() => open(blob, other.secret), EnvelopeError);
});

Deno.test("a blob with an unknown version is rejected", async () => {
  const { blob, secret } = await seal(utf8("hunter2"), { kind: "text" });
  blob[0] = 2;
  await assertRejects(() => open(blob, secret), EnvelopeError);
});

Deno.test("a malformed secret is rejected before any decryption", async () => {
  const { blob, secret } = await seal(utf8("hunter2"), { kind: "text" });
  // 43 base64url chars carry 258 bits; the last char of a 32-byte value uses only 4 of its 6 bits.
  const unusedBitsSet = secret.slice(0, 42) +
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"[
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".indexOf(secret[42]) ^ 1
    ];
  for (
    const bad of [
      "",
      secret.slice(0, 42),
      secret + "A",
      secret + "=",
      secret.slice(0, 42) + "+",
      unusedBitsSet,
    ]
  ) {
    await assertRejects(() => open(blob, bad), EnvelopeError, undefined, `accepted ${bad}`);
  }
});

// Built independently by test/vectors.py (Python hashlib/hmac + `cryptography`), not WebCrypto.
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

Deno.test("the reveal token and its hash match the spec vectors", async () => {
  assertEquals(await revealToken(vectors.secret), vectors.revealToken);
  assertEquals(await revealHash(vectors.revealToken), vectors.revealHash);
});

Deno.test("seal returns the reveal hash for its own secret", async () => {
  const sealed = await seal(utf8("hunter2"), { kind: "text" });
  assertEquals(sealed.revealHash, await revealHash(await revealToken(sealed.secret)));
});

Deno.test("a second vector, with - and _ in its secret, matches", async () => {
  const v = vectors.valid2;
  assertEquals(await revealToken(v.secret), v.revealToken);
  assertEquals(await revealHash(v.revealToken), v.revealHash);
  assertEquals(text((await open(fromBase64(v.blob), v.secret)).content), v.content);
});

Deno.test("a v1 blob built by an independent implementation opens", async () => {
  const opened = await open(fromBase64(vectors.valid.blob), vectors.secret);
  assertEquals<unknown>(opened.meta, vectors.valid.meta);
  assertEquals(text(opened.content), vectors.valid.content);
});

Deno.test("seal enforces the 1 MiB content and 1 KiB metadata limits", async () => {
  const MiB = 1024 * 1024;
  await seal(new Uint8Array(MiB), { kind: "text" });
  await assertRejects(() => seal(new Uint8Array(MiB + 1), { kind: "text" }), RangeError);
  await assertRejects(() => seal(utf8("x"), { kind: "file", name: "n".repeat(1024) }), RangeError);
});

Deno.test("authentic blobs with hostile framing or metadata are rejected", async () => {
  for (const [name, blob] of Object.entries<string>(vectors.invalid)) {
    await assertRejects(
      () => open(fromBase64(blob), vectors.secret),
      EnvelopeError,
      undefined,
      name,
    );
  }
});

/**
 * Build a v1 blob from raw plaintext with plain WebCrypto, independently of envelope.js, for cases
 * too large for vectors.json. Secret is 32 zero bytes (vectors.secret).
 */
async function rawBlob(plaintext: Uint8Array<ArrayBuffer>, aad = "heka-drop/v1") {
  const ikm = await crypto.subtle.importKey("raw", new Uint8Array(32), "HKDF", false, [
    "deriveKey",
  ]);
  const key = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: utf8("heka-drop/v1/enc") },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const nonce = new Uint8Array(12);
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: utf8(aad) },
    key,
    plaintext,
  );
  return new Uint8Array([1, ...nonce, ...new Uint8Array(sealed)]);
}

function framed(meta: string, contentBytes: number) {
  const m = utf8(meta);
  const out = new Uint8Array(4 + m.length + contentBytes);
  new DataView(out.buffer).setUint32(0, m.length);
  out.set(m, 4);
  return out;
}

Deno.test("open enforces the content limit, and rejects oversized blobs before decrypting", async () => {
  const atLimit = await rawBlob(framed('{"kind":"text"}', MAX_CONTENT_BYTES));
  assertEquals((await open(atLimit, vectors.secret)).content.length, MAX_CONTENT_BYTES);

  const overContent = await rawBlob(framed('{"kind":"text"}', MAX_CONTENT_BYTES + 1));
  await assertRejects(() => open(overContent, vectors.secret), EnvelopeError);

  const oversized = new Uint8Array(MAX_BLOB_BYTES + 1);
  oversized[0] = 1;
  await assertRejects(() => open(oversized, vectors.secret), EnvelopeError);
});

Deno.test("seal refuses metadata that open would reject", async () => {
  for (
    const meta of [{ kind: "html" }, { kind: "file", name: "../x" }, { kind: "text", name: "x" }]
  ) {
    await assertRejects(
      () => seal(utf8("x"), meta as unknown as Parameters<typeof seal>[1]),
      TypeError,
      undefined,
      JSON.stringify(meta),
    );
  }
});

Deno.test("opened content owns its buffer, without the framing", async () => {
  const { blob, secret } = await seal(utf8("hunter2"), { kind: "text" });
  const { content } = await open(blob, secret);
  assertEquals([content.byteOffset, content.buffer.byteLength], [0, 7]);
});

Deno.test("edge sizes: empty content and exactly 1 KiB of metadata round-trip", async () => {
  const empty = await seal(new Uint8Array(), { kind: "text" });
  assertEquals((await open(empty.blob, empty.secret)).content.length, 0);

  const name = "n".repeat(1024 - '{"kind":"file","name":""}'.length);
  const full = await seal(utf8("x"), { kind: "file", name });
  assertEquals((await open(full.blob, full.secret)).meta, { kind: "file", name });
});

Deno.test("flipping one bit in the nonce, ciphertext or tag, or truncating the tag, is rejected", async () => {
  const { blob, secret } = await seal(utf8("hunter2"), { kind: "text" });
  const nonce = 1, body = 13, tag = blob.length - 1;
  for (const at of [nonce, body, tag]) {
    const tampered = blob.slice();
    tampered[at] ^= 1;
    await assertRejects(() => open(tampered, secret), EnvelopeError, undefined, `byte ${at}`);
  }
  await assertRejects(() => open(blob.slice(0, -1), secret), EnvelopeError);
});

Deno.test("revealToken and revealHash accept only canonical 43-character values", async () => {
  const { secret } = await seal(utf8("x"), { kind: "text" });
  const token = await revealToken(secret);
  for (const bad of ["", token.slice(0, 42), token + "=", token.slice(0, 42) + "+"]) {
    await assertRejects(() => revealToken(bad), EnvelopeError, undefined, bad);
    await assertRejects(() => revealHash(bad), EnvelopeError, undefined, bad);
  }
});
