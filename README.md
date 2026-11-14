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
- **Two kinds of link, chosen per drop.** A plain drop opens for anyone holding the link, with no
  sign-in. A drop marked *sign-in required* makes the recipient sign in with GitHub or Google first;
  if they have no account yet, that sign-in creates one. Nobody has to sign up before a link can be
  sent to them.
- **Sign-in is Cloudflare Access,** applied only to the sign-in-required paths. The app trusts the
  verified identity Access passes on and has no OAuth code of its own.
- **Addressed drops:** a sign-in-required drop can also name one person, and then only that person
  can open it.
- **Reveal is an explicit click,** so chat link previews cannot use up a drop.
- **Creating drops needs an API token;** only the redeem page faces the internet.
- **A `drop` CLI does the sending.** It reads the value from Heka Vault with the host's own project
  key (or from stdin or a file), encrypts locally, uploads, and prints only the URL. The value stays
  out of the agent's context, and the Drop server holds no vault credentials.
- **Payloads:** text, JSON, and files up to about 1 MB.

## First version also includes

- A Discord message when a drop is opened: who, when, and its label, never the value.
- Listing pending drops and revoking one before it is opened.
- Agents can post the link to Discord for the recipient themselves, as well as hand it back to the
  operator.

## People

Signing in creates a person: the verified GitHub or Google identity, plus metadata such as a
display name and a Discord user id. People exist so that:

- a drop or a reverse-drop request can be addressed to someone by name,
- agents can ping that person in Discord when something is waiting for them,
- the audit log names who opened or submitted what.

A Discord user id gets onto a person in one of two ways:

- **Created from Discord first.** An operator or agent creates the person with a name and Discord
  user id. The id is trusted from the start. The first sign-in through a link addressed to them
  attaches the GitHub or Google identity, and that attachment is announced in Discord so a wrong
  account is noticed.
- **Entered at sign-up.** The person types their own Discord id. It is stored as unverified until
  they confirm it by entering a short code sent to that account in a Discord DM.

Agents can only ping, or address a reverse-drop request to, a person whose Discord id is trusted or
confirmed.

## Reverse drops

A collaborator sometimes has to send a secret back. A reverse drop is a request link that lets them
do that, and it is the one place where an outsider writes into the system, so it is narrow:

- Only a holder of an API token can create a request. There is no open submit page; without a live
  request link there is nothing to post to.
- A request is addressed to one stored person, who must sign in as that identity. It accepts one
  submission, then closes, and it expires like any drop.
- The recipient's browser encrypts to a public key belonging to the host that asked. The server
  stores ciphertext it cannot read.
- Size is capped, and the submission is data only: it is never rendered, parsed, or executed by the
  server or the CLI.
- The requesting agent collects it with the CLI and writes it straight into the vault key named
  when the request was made. The value does not enter the agent's context, and a submission cannot
  choose where it lands.
- Every request, submission, and collection is audited and announced in Discord.

## Deployment

One container behind a Cloudflare tunnel, with Cloudflare Access on the redeem pages. The API that
creates drops is not exposed through the tunnel. Because the server holds only ciphertext, it can
live on a less trusted machine than the vault.

## Open

- Whether an API token is limited to drops for its own vault project.

## License

[MIT](LICENSE)
