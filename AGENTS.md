# Agent notes

- Sibling of [heka-vault/vault](https://github.com/heka-vault/vault); follow its conventions (Deno
  2 + Hono + `node:sqlite`, server-rendered pages, no build step) unless the README says otherwise.
- The server must never see plaintext or decryption keys. Encryption happens in the sender's CLI and
  decryption in the recipient's browser; the key travels only in the URL fragment.
- Never log or return ciphertext bodies, fragments, or tokens. Audit entries record who and when,
  not what.
- This repo will become public. Host names, IPs, tokens, and deployment details belong in the
  private ops repo, not here.
- All rules live in `src/store.ts` (`DropStore`), which reaches storage only through the `Sql` port
  in `src/sql.ts`. Routes in `src/api.ts` and `src/public.ts` stay thin.
- `src/envelope.js` is the one implementation of the drop format, shared by the CLI and the browser.
  Keep it plain JavaScript with no imports. Changing the format means a new version byte and new
  vectors from `test/vectors.py`.
- Work test-first. Changes to crypto, link handling or the reveal path get a security review.
- Before committing, run `deno task check && deno task test`.
