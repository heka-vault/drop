# Heka Drop

Hand a secret to a person with a link. An agent takes a value (usually from
[Heka Vault](https://github.com/heka-vault/vault)), encrypts it, and gets back a URL that works a
limited number of times. You paste the URL to a collaborator; they sign in, click Reveal, and the
secret is gone from the server.

**Status:** design. No code yet.

## Decided so far

- **End-to-end encrypted.** The sender encrypts before upload. The key rides in the URL `#fragment`,
  which browsers never send, so the server stores only ciphertext.
- **One-time by default, N-time on request,** always with an expiry.
- **Recipients sign in with GitHub or Google before a drop reveals.** By default anyone holding the
  link may sign in and open it; no account has to exist before the link is sent. Who opened it is
  recorded.
- **Stricter mode, per deployment or per drop:** address a drop to a specific person, who must
  already be known and must be the one who signs in.
- **Reveal is an explicit click,** so chat link previews cannot use up a drop.
- **Creating drops needs an API token;** only the redeem page faces the internet.
- Payloads: text and JSON first; small files (a signing key) possibly later.
