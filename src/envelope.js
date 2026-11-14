// Heka Drop envelope, format v1. Plain JavaScript using only WebCrypto, so the CLI (Deno) and the
// redeem page (browser) load this same file. See docs/adr/0001-slice-1-plain-drops.md.

/** @typedef {{ kind: "text" } | { kind: "file", name: string }} Meta */
/** @typedef {Uint8Array<ArrayBuffer>} Bytes */

/** The blob or secret is not a valid v1 drop. Deliberately says nothing more specific. */
export class EnvelopeError extends Error {
  constructor() {
    super("this drop cannot be opened");
    this.name = "EnvelopeError";
  }
}

export const MAX_CONTENT_BYTES = 1024 * 1024;
export const MAX_META_BYTES = 1024;

const VERSION = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + NONCE_BYTES + TAG_BYTES;

/** Size bounds of a v1 blob, so the server can reject uploads it could never open. */
export const MIN_BLOB_BYTES = HEADER_BYTES + 4;
export const MAX_BLOB_BYTES = HEADER_BYTES + 4 + MAX_META_BYTES + MAX_CONTENT_BYTES;
const AAD = new TextEncoder().encode("heka-drop/v1");

/**
 * Unpadded base64url, as used in links. Also used by the server for ids and tokens. Only for
 * short values: the argument spread would overflow the stack on large inputs such as blobs.
 * @param {Uint8Array} bytes
 */
export function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_")
    .replace(/=+$/, "");
}

/** @param {string} text */
function fromBase64url(text) {
  const bin = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/**
 * Decode a 32-byte value (link secret or reveal token), accepting only its one canonical
 * 43-character base64url spelling.
 * @param {string} text
 */
function decode32(text) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(text)) throw new EnvelopeError();
  const bytes = fromBase64url(text);
  if (base64url(bytes) !== text) throw new EnvelopeError();
  return bytes;
}

/** @param {string} info */
const hkdf = (info) => ({
  name: "HKDF",
  hash: "SHA-256",
  salt: new Uint8Array(),
  info: new TextEncoder().encode(info),
});

/** @param {Bytes} secret @param {"deriveKey" | "deriveBits"} usage */
const importSecret = (secret, usage) =>
  crypto.subtle.importKey("raw", secret, "HKDF", false, [usage]);

/** @param {Bytes} secret @param {KeyUsage} usage */
async function encKey(secret, usage) {
  return crypto.subtle.deriveKey(
    hkdf("heka-drop/v1/enc"),
    await importSecret(secret, "deriveKey"),
    { name: "AES-GCM", length: 256 },
    false,
    [usage],
  );
}

/**
 * The token the browser presents to reveal a drop. Derived from the link secret, so holding only
 * the drop id is not enough to spend an open.
 * @param {string} secret
 * @returns {Promise<string>}
 */
export async function revealToken(secret) {
  const key = await importSecret(decode32(secret), "deriveBits");
  return base64url(
    new Uint8Array(await crypto.subtle.deriveBits(hkdf("heka-drop/v1/reveal"), key, 256)),
  );
}

/**
 * What the server stores and compares: hex SHA-256 of the reveal token's bytes.
 * @param {string} token
 * @returns {Promise<string>}
 */
export async function revealHash(token) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", decode32(token)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Encrypt content under a fresh link secret.
 * @param {Bytes} content
 * @param {Meta} meta
 * @returns {Promise<{ blob: Bytes, secret: string, revealHash: string }>}
 */
export async function seal(content, meta) {
  if (!isMeta(meta)) {
    throw new TypeError("metadata must be { kind: 'text' } or a file with a plain name");
  }
  const metaBytes = new TextEncoder().encode(JSON.stringify(meta));
  if (content.length > MAX_CONTENT_BYTES) throw new RangeError("content is over 1 MiB");
  if (metaBytes.length > MAX_META_BYTES) throw new RangeError("file name is too long");
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const plaintext = new Uint8Array(4 + metaBytes.length + content.length);
  new DataView(plaintext.buffer).setUint32(0, metaBytes.length);
  plaintext.set(metaBytes, 4);
  plaintext.set(content, 4 + metaBytes.length);

  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const key = await encKey(secret, "encrypt");
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: AAD, tagLength: TAG_BYTES * 8 },
      key,
      plaintext,
    ),
  );
  const blob = new Uint8Array(1 + NONCE_BYTES + sealed.length);
  blob[0] = VERSION;
  blob.set(nonce, 1);
  blob.set(sealed, 1 + NONCE_BYTES);
  const encoded = base64url(secret);
  return { blob, secret: encoded, revealHash: await revealHash(await revealToken(encoded)) };
}

/**
 * Decrypt a blob with the link secret from the URL fragment.
 * @param {Bytes} blob
 * @param {string} secret
 * @returns {Promise<{ meta: Meta, content: Bytes }>}
 */
export async function open(blob, secret) {
  if (blob.length < MIN_BLOB_BYTES || blob.length > MAX_BLOB_BYTES || blob[0] !== VERSION) {
    throw new EnvelopeError();
  }
  const key = await encKey(decode32(secret), "decrypt");
  let plaintext;
  try {
    plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: blob.subarray(1, 1 + NONCE_BYTES),
          additionalData: AAD,
          tagLength: TAG_BYTES * 8,
        },
        key,
        blob.subarray(1 + NONCE_BYTES),
      ),
    );
  } catch {
    throw new EnvelopeError();
  }
  return parsePlaintext(plaintext);
}

/**
 * Split authenticated plaintext into metadata and content. The sender holds the key, so these
 * bytes are still attacker-controlled: accept only the exact v1 shapes.
 * @param {Bytes} plaintext
 * @returns {{ meta: Meta, content: Bytes }}
 */
function parsePlaintext(plaintext) {
  if (plaintext.length < 4) throw new EnvelopeError();
  const metaLength = new DataView(plaintext.buffer, plaintext.byteOffset).getUint32(0);
  if (metaLength > MAX_META_BYTES || 4 + metaLength > plaintext.length) throw new EnvelopeError();
  let meta;
  try {
    meta = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(plaintext.subarray(4, 4 + metaLength)),
    );
  } catch {
    throw new EnvelopeError();
  }
  if (!isMeta(meta)) throw new EnvelopeError();
  const content = plaintext.slice(4 + metaLength);
  if (content.length > MAX_CONTENT_BYTES) throw new EnvelopeError();
  return { meta, content };
}

/**
 * A name safe to offer as a download as-is: a single path segment, well-formed Unicode, with no
 * control, format (bidi, zero-width) or separator characters. Sender and page share this one rule.
 * @param {unknown} name
 */
function isFileName(name) {
  return typeof name === "string" && name !== "" && name !== "." && name !== ".." &&
    name.isWellFormed() && !/[\p{Cc}\p{Cf}/\\]/u.test(name);
}

/**
 * @param {unknown} value
 * @returns {value is Meta}
 */
function isMeta(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort().join(",");
  const meta = /** @type {Record<string, unknown>} */ (value);
  if (meta.kind === "text") return keys === "kind";
  if (meta.kind === "file") return keys === "kind,name" && isFileName(meta.name);
  return false;
}
