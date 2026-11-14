# Heka Drop

Hand a secret to a person with a link. An agent takes a value (usually from
[Heka Vault](https://github.com/heka-vault/vault)), encrypts it, and gets back a URL that works a
limited number of times. You paste the URL to a collaborator; they sign in, click Reveal, and the
secret is gone from the server.

**Status:** design. No code yet.

## Decided so far

- **End-to-end encrypted.** The sender encrypts before upload. The key rides in the URL `#fragment`,
  which browsers never send, so the server stores only ciphertext.
- **One open and 24 hours by default.** A sender can raise either per drop, up to 10 opens and 7
  days. Ciphertext is deleted on the last open or at expiry.
- **Recipients sign in with GitHub or Google before a drop reveals.** By default anyone holding the
  link may sign in and open it; no account has to exist before the link is sent. Who opened it is
  recorded.
- **Stricter mode, per deployment or per drop:** address a drop to a specific person, and only that
  identity can open it.
- **Sign-in is Cloudflare Access** in front of the redeem page. The app trusts the verified identity
  Access passes on and has no OAuth code of its own.
- **Reveal is an explicit click,** so chat link previews cannot use up a drop.
- **Creating drops needs an API token;** only the redeem page faces the internet.
- **A `drop` CLI does the sending.** It reads the value from Heka Vault with the host's own project
  key (or from stdin or a file), encrypts locally, uploads, and prints only the URL. The value stays
  out of the agent's context, and the Drop server holds no vault credentials.
- **Payloads:** text, JSON, and files up to about 1 MB.

## First version also includes

- A Discord message when a drop is opened: who, when, and its label, never the value.
- Listing pending drops and revoking one before it is opened.
- Reverse drops: a request link a collaborator uses to send a secret back, encrypted to the
  requester.

## Open

- Where it runs and under which hostname.
- How a reverse drop is encrypted to the requester, and how it reaches the vault.
- License, and when the repo goes public.
