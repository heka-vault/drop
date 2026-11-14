import { parseArgs } from "@std/cli/parse-args";
import { basename } from "node:path";
import { seal } from "./envelope.js";

/** Everything the CLI touches in the outside world, injected so tests run it in-process. */
export interface Io {
  env(name: string): string | undefined;
  stdin(): Promise<Uint8Array<ArrayBuffer>>;
  readFile(path: string): Promise<Uint8Array<ArrayBuffer>>;
  stdout(line: string): void;
  stderr(line: string): void;
  fetch(input: string, init: RequestInit): Promise<Response>;
}

const USAGE = `drop send [--file PATH] [--label TEXT] [--opens N] [--ttl SECONDS]

Reads the secret from stdin (or PATH), encrypts it locally, uploads only ciphertext, and prints the link.
Needs DROP_API_URL, DROP_PUBLIC_URL and DROP_TOKEN in the environment.`;

interface Config {
  apiOrigin: string;
  publicOrigin: string;
  token: string;
}

/** 16 random bytes, base64url: the only shape we will put into a link. */
const DROP_ID = /^[A-Za-z0-9_-]{22}$/;
const TOKEN = /^hdt_[A-Za-z0-9_-]{43}$/;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** An origin we will send a token or a secret to: HTTPS, or plain HTTP only on loopback. */
function trustedOrigin(value: string | undefined): string | null {
  const url = value ? URL.parse(value) : null;
  if (url?.protocol === "https:") return url.origin;
  if (url?.protocol === "http:" && LOOPBACK.has(url.hostname)) return url.origin;
  return null;
}

function readConfig(io: Io): Config | string {
  const apiOrigin = trustedOrigin(io.env("DROP_API_URL"));
  const publicOrigin = trustedOrigin(io.env("DROP_PUBLIC_URL"));
  const token = io.env("DROP_TOKEN");
  if (!apiOrigin) return "DROP_API_URL must be an https:// URL (http:// only on loopback)";
  if (!publicOrigin) return "DROP_PUBLIC_URL must be an https:// URL (http:// only on loopback)";
  if (!token || !TOKEN.test(token)) return "DROP_TOKEN is missing or malformed (expected hdt_...)";
  return { apiOrigin, publicOrigin, token };
}

/** Run the CLI; returns the process exit code. */
export async function runCli(argv: string[], io: Io): Promise<number> {
  const args = parseArgs(argv, { string: ["file", "label", "opens", "ttl"] });
  if (args._[0] !== "send") {
    io.stderr(USAGE);
    return 2;
  }
  const config = readConfig(io);
  if (typeof config === "string") {
    io.stderr(config);
    return 2;
  }

  try {
    io.stdout(await send(args, config, io));
    return 0;
  } catch (e) {
    // Only our own fixed messages reach the terminal: library and server errors can carry the
    // token (e.g. an invalid header value) or terminal escape sequences.
    io.stderr(`drop: ${e instanceof CliError ? e.message : "unexpected error"}`);
    return 1;
  }
}

/** A failure whose message is ours and safe to print. */
class CliError extends Error {}

const API_ERRORS: Record<number, string> = {
  400: "the server rejected the request (check --opens 1-10, --ttl up to 604800 seconds, " +
    "--label up to 200 characters on one line)",
  401: "the API token was refused",
  413: "the secret is too large (1 MiB maximum)",
};

/** Seal the input, upload it, and return the link. Throws CliError for expected failures. */
async function send(
  args: { file?: string; label?: string; opens?: string; ttl?: string },
  config: Config,
  io: Io,
): Promise<string> {
  const input = args.file === undefined
    ? await io.stdin()
    : await io.readFile(args.file).catch(() => {
      throw new CliError(`cannot read ${args.file}`);
    });
  const meta = args.file === undefined
    ? { kind: "text" as const }
    : { kind: "file" as const, name: basename(args.file) };
  const sealed = await seal(input, meta).catch((e) => {
    throw new CliError(e instanceof RangeError ? API_ERRORS[413] : "cannot use that file name");
  });
  const headers: Record<string, string> = {
    authorization: `Bearer ${config.token}`,
    "content-type": "application/octet-stream",
    "x-drop-reveal-hash": sealed.revealHash,
  };
  if (args.label !== undefined) headers["x-drop-label"] = args.label;
  if (args.opens !== undefined) headers["x-drop-max-opens"] = args.opens;
  if (args.ttl !== undefined) headers["x-drop-ttl"] = args.ttl;

  const res = await io.fetch(`${config.apiOrigin}/api/v1/drops`, {
    method: "POST",
    headers,
    body: sealed.blob,
    redirect: "error",
  }).catch(() => {
    throw new CliError(`cannot reach the API at ${config.apiOrigin}`);
  });
  if (!res.ok) throw new CliError(API_ERRORS[res.status] ?? `the API returned HTTP ${res.status}`);
  const body = await res.json().catch(() => ({}));
  if (typeof body.id !== "string" || !DROP_ID.test(body.id)) {
    throw new CliError("the server returned a malformed drop id");
  }
  return `${config.publicOrigin}/d/${body.id}#${sealed.secret}`;
}

if (import.meta.main) {
  const io: Io = {
    env: (name) => Deno.env.get(name),
    stdin: async () => new Uint8Array(await new Response(Deno.stdin.readable).arrayBuffer()),
    readFile: (path) => Deno.readFile(path),
    stdout: (line) => console.log(line),
    stderr: (line) => console.error(line),
    fetch: (input, init) => fetch(input, init),
  };
  Deno.exit(await runCli(Deno.args, io));
}
