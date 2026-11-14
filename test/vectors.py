"""Generate test/vectors.json: v1 blobs built independently of src/envelope.js.

Uses Python's hmac/hashlib (RFC 5869 HKDF by hand) and `cryptography`'s AESGCM, so the Deno tests
check our WebCrypto code against a second implementation. The secret is 32 zero bytes
("A" * 43) and the nonce is 00..0b, so the output is deterministic.

    python3 -I test/vectors.py > test/vectors.json
"""

import base64
import hashlib
import hmac
import json
import struct

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

SECRET = bytes(32)
# Non-zero secret whose base64url spelling uses both "-" and "_".
SECRET2 = bytes([0xFB, 0xFF, 0xBF]) * 10 + bytes([1, 2])
NONCE = bytes(range(12))


def hkdf(info: bytes, secret: bytes = SECRET) -> bytes:
    prk = hmac.new(bytes(32), secret, hashlib.sha256).digest()
    return hmac.new(prk, info + b"\x01", hashlib.sha256).digest()


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def blob(plaintext: bytes, secret: bytes = SECRET, aad: bytes = b"heka-drop/v1") -> str:
    sealed = AESGCM(hkdf(b"heka-drop/v1/enc", secret)).encrypt(NONCE, plaintext, aad)
    return base64.b64encode(b"\x01" + NONCE + sealed).decode()


def framed(meta: bytes, content: bytes) -> bytes:
    return struct.pack(">I", len(meta)) + meta + content


def js(obj) -> bytes:
    return json.dumps(obj, separators=(",", ":")).encode()


def bad_name(name: str) -> str:
    return blob(framed(js({"kind": "file", "name": name}), b"x"))


token = hkdf(b"heka-drop/v1/reveal")
token2 = hkdf(b"heka-drop/v1/reveal", SECRET2)

print(json.dumps({
    "secret": b64url(SECRET),
    "revealToken": b64url(token),
    "revealHash": hashlib.sha256(token).hexdigest(),
    "valid": {
        "blob": blob(framed(js({"kind": "file", "name": "id_ed25519"}), b"-----BEGIN KEY-----\n")),
        "meta": {"kind": "file", "name": "id_ed25519"},
        "content": "-----BEGIN KEY-----\n",
    },
    "valid2": {
        "secret": b64url(SECRET2),
        "revealToken": b64url(token2),
        "revealHash": hashlib.sha256(token2).hexdigest(),
        "blob": blob(framed(js({"kind": "text"}), b"second"), SECRET2),
        "content": "second",
    },
    "invalid": {
        "plaintext shorter than the length prefix": blob(b"\x00\x00"),
        "meta length beyond the plaintext": blob(struct.pack(">I", 100) + js({"kind": "text"})),
        "meta length 0xFFFFFFFF": blob(struct.pack(">I", 0xFFFFFFFF) + js({"kind": "text"})),
        "meta of length zero": blob(framed(b"", b"x")),
        "meta over 1 KiB": blob(framed(js({"kind": "file", "name": "n" * 1100}), b"x")),
        "invalid UTF-8 inside a JSON string": blob(framed(b'{"kind":"file","name":"a\xffb"}', b"x")),
        "meta is null": blob(framed(js(None), b"x")),
        "__proto__ key": blob(framed(b'{"kind":"text","__proto__":{}}', b"x")),
        "different AAD": blob(framed(js({"kind": "text"}), b"x"), aad=b"heka-drop/v2"),
        "empty file name": bad_name(""),
        "lone surrogate in name": blob(framed(b'{"kind":"file","name":"a\\ud800b"}', b"x")),
        "NUL in name": bad_name("a\x00b"),
        "C1 control in name": bad_name("a\x85b"),
        "bidi override in name": bad_name("txt.\u202eexe"),
        "path in name": bad_name("../x"),
        "backslash in name": bad_name("a\\b"),
        "name is .": bad_name("."),
        "name is ..": bad_name(".."),
        "meta not JSON": blob(framed(b"not json", b"x")),
        "meta is an array": blob(framed(js(["text"]), b"x")),
        "unknown kind": blob(framed(js({"kind": "html"}), b"<script>")),
        "file without a name": blob(framed(js({"kind": "file"}), b"x")),
        "file name not a string": blob(framed(js({"kind": "file", "name": 5}), b"x")),
        "text with a name": blob(framed(js({"kind": "text", "name": "x"}), b"x")),
        "unknown key": blob(framed(js({"kind": "text", "type": "text/html"}), b"x")),
        "blob shorter than a header": base64.b64encode(b"\x01" + bytes(20)).decode(),
    },
}, indent=2))
