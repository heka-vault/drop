import { parseArgs } from "@std/cli/parse-args";
import { dirname } from "node:path";
import { apiApp } from "./src/api.ts";
import { publicApp } from "./src/public.ts";
import { openSqlite } from "./src/sqlite.ts";
import { DropStore } from "./src/store.ts";

const env = (name: string, fallback: string) => Deno.env.get(name) ?? fallback;
function port(name: string, fallback: string): number {
  const value = env(name, fallback);
  if (!/^\d{1,5}$/.test(value)) throw new Error(`${name} must be a port number`);
  return Number(value);
}
const config = {
  db: env("HEKA_DROP_DB", "./data/drop.db"),
  apiHost: env("HEKA_DROP_API_HOST", "127.0.0.1"),
  apiPort: port("HEKA_DROP_API_PORT", "8091"),
  publicHost: env("HEKA_DROP_PUBLIC_HOST", "127.0.0.1"),
  publicPort: port("HEKA_DROP_PUBLIC_PORT", "8090"),
  sourceUrl: Deno.env.get("HEKA_DROP_SOURCE_URL") || undefined,
  revision: Deno.env.get("HEKA_DROP_REVISION") || undefined,
};

const PURGE_INTERVAL_MS = 60_000;

function openStore(): DropStore {
  Deno.mkdirSync(dirname(config.db), { recursive: true });
  return new DropStore(openSqlite(config.db));
}

const USAGE = `heka-drop <command>

  serve                                  Start the private API and the public redeem app
  create-token --name NAME [--out FILE]  Create an API token. Prints DROP_TOKEN=... once, or
                                         writes it to FILE (mode 600). Keep it off this host.
  revoke-token --name NAME               Revoke every token with that name
`;

if (import.meta.main) {
  const args = parseArgs(Deno.args, { string: ["name", "out"] });
  const [command] = args._;
  if (command === "serve") {
    const store = openStore();
    Deno.serve({ hostname: config.apiHost, port: config.apiPort }, apiApp(store).fetch);
    Deno.serve(
      { hostname: config.publicHost, port: config.publicPort },
      publicApp(store, {
        sourceUrl: config.sourceUrl,
        revision: config.revision,
      }).fetch,
    );
    setInterval(() => store.purgeExpired(), PURGE_INTERVAL_MS);
  } else if (command === "create-token" && args.name) {
    const line = `DROP_TOKEN=${openStore().createToken(args.name)}`;
    if (args.out) {
      Deno.writeTextFileSync(args.out, line + "\n", { mode: 0o600, createNew: true });
      console.error(`wrote token "${args.name}" to ${args.out}`);
    } else {
      console.log(line);
    }
  } else if (command === "revoke-token" && args.name) {
    console.log(`revoked ${openStore().revokeToken(args.name)} token(s) named "${args.name}"`);
  } else {
    console.error(USAGE);
    Deno.exit(command ? 2 : 0);
  }
}
