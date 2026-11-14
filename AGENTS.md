# Agent notes

- Sibling of [heka-vault/vault](https://github.com/heka-vault/vault); follow its conventions (Deno 2 +
  Hono + `node:sqlite`, server-rendered pages, no build step) unless the README says otherwise.
- The server must never see plaintext or decryption keys. Encryption happens in the sender's CLI
  and decryption in the recipient's browser; the key travels only in the URL fragment.
- Never log or return ciphertext bodies, fragments, or tokens. Audit entries record who and when,
  not what.
- This repo will become public. Host names, IPs, tokens, and deployment details belong in the
  private ops repo, not here.
