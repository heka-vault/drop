import { assertEquals, assertMatch } from "@std/assert";
import { apiApp } from "../src/api.ts";
import { runCli } from "../src/cli.ts";
import { open, revealToken } from "../src/envelope.js";
import { publicApp } from "../src/public.ts";
import { openSqlite } from "../src/sqlite.ts";
import { DropStore } from "../src/store.ts";

const API = "http://127.0.0.1:8091";
const PUBLIC = "https://drop.example.test";

function setup(
  envOverrides: Record<string, string> = {},
  fakeApi?: (req: Request) => Response,
) {
  const store = new DropStore(openSqlite(":memory:"));
  const api = apiApp(store);
  const pub = publicApp(store);
  const token = store.createToken("agent");
  const env = { DROP_API_URL: API, DROP_PUBLIC_URL: PUBLIC, DROP_TOKEN: token, ...envOverrides };
  const out: string[] = [];
  const err: string[] = [];
  const run = (args: string[], stdin = "") =>
    runCli(args, {
      env: (name) => (env as Record<string, string>)[name],
      stdin: () => Promise.resolve(new TextEncoder().encode(stdin)),
      readFile: (path) => Deno.readFile(path),
      stdout: (line) => out.push(line),
      stderr: (line) => err.push(line),
      fetch: async (input, init) =>
        fakeApi ? fakeApi(new Request(input, init)) : await api.request(new Request(input, init)),
    });
  /** What the recipient's browser does with the printed link. */
  const redeem = async (link: string) => {
    const url = new URL(link);
    const secret = url.hash.slice(1);
    const res = await pub.request(`${url.pathname}/reveal`, {
      method: "POST",
      headers: { "x-drop-reveal": "1", "sec-fetch-site": "same-origin" },
      body: await revealToken(secret),
    });
    return open(new Uint8Array(await res.arrayBuffer()), secret);
  };
  const pending = () => store.list(store.authenticate(token)!);
  return { store, run, out, err, redeem, pending };
}

Deno.test("CLI: send prints only the link, and the link reveals the value", async () => {
  const { run, out, err, redeem } = setup();
  assertEquals(await run(["send", "--label", "db password"], "hunter2"), 0);
  assertEquals(err, []);
  assertEquals(out.length, 1);
  assertMatch(out[0], /^https:\/\/drop\.example\.test\/d\/[A-Za-z0-9_-]{22}#[A-Za-z0-9_-]{43}$/);

  const opened = await redeem(out[0]);
  assertEquals(opened.meta, { kind: "text" });
  assertEquals(new TextDecoder().decode(opened.content), "hunter2");
});

Deno.test("CLI: send --file sends the file's bytes under its base name only", async () => {
  const { run, out, redeem } = setup();
  const dir = Deno.makeTempDirSync();
  const bytes = new Uint8Array([0, 1, 2, 255]);
  Deno.writeFileSync(`${dir}/id_ed25519`, bytes);

  assertEquals(await run(["send", "--file", `${dir}/id_ed25519`]), 0);
  const opened = await redeem(out[0]);
  assertEquals(opened.meta, { kind: "file", name: "id_ed25519" });
  assertEquals(opened.content, bytes);
});

Deno.test("CLI: bad configuration exits 2 before anything is sent", async () => {
  const configs: Record<string, string>[] = [
    { DROP_TOKEN: "" },
    { DROP_API_URL: "" },
    { DROP_PUBLIC_URL: "" },
    { DROP_API_URL: "http://drop-api.example.test" },
    { DROP_PUBLIC_URL: "http://drop.example.test" },
    { DROP_PUBLIC_URL: "not a url" },
  ];
  for (const bad of configs) {
    const { run, out, err, pending } = setup(bad);
    assertEquals(await run(["send"], "hunter2"), 2, JSON.stringify(bad));
    assertEquals(out, []);
    assertEquals(err.length, 1);
    assertEquals(pending(), []);
  }
});

Deno.test("CLI: plain http is fine on loopback", async () => {
  const { run } = setup({ DROP_PUBLIC_URL: "http://localhost:8080" });
  assertEquals(await run(["send"], "hunter2"), 0);
});

Deno.test("CLI: an API error exits 1 with a local message and prints no link", async () => {
  const unauthorized = setup({ DROP_TOKEN: "hdt_" + "A".repeat(43) });
  assertEquals(await unauthorized.run(["send"], "hunter2"), 1);
  assertEquals(unauthorized.out, []);
  assertEquals(unauthorized.err, ["drop: the API token was refused"]);

  const badOption = setup();
  assertEquals(await badOption.run(["send", "--opens", "11"], "hunter2"), 1);
  assertMatch(badOption.err[0], /^drop: the server rejected the request \(check --opens/);
});

Deno.test("CLI: no failure ever prints the token, the link secret or the value", async () => {
  const token = "hdt_" + "B".repeat(43);
  const cases: [
    string,
    Record<string, string>,
    ((req: Request) => Response) | undefined,
    string,
  ][] = [
    ["malformed token", { DROP_TOKEN: token + "\nx" }, undefined, "hunter2"],
    [
      "token reflected in error",
      { DROP_TOKEN: token },
      (req) =>
        Response.json({ error: `bad ${req.headers.get("authorization")} \x1b[2J` }, {
          status: 400,
        }),
      "hunter2",
    ],
    ["fetch throws", { DROP_TOKEN: token }, (req) => {
      throw new TypeError(`network down for ${req.headers.get("authorization")}`);
    }, "hunter2"],
    [
      "non-JSON response",
      { DROP_TOKEN: token },
      () => new Response("<html>", { status: 502 }),
      "hunter2",
    ],
    ["oversized input", { DROP_TOKEN: token }, undefined, "x".repeat(1024 * 1024 + 1)],
  ];
  for (const [name, env, fakeApi, stdin] of cases) {
    const { run, out, err } = setup(env, fakeApi);
    const code = await run(["send"], stdin);
    assertEquals(code === 1 || code === 2, true, name);
    assertEquals(out, [], name);
    assertEquals(err.length, 1, name);
    const leaked = ["BBBB", "hunter2", "\x1b"].filter((s) => err[0].includes(s));
    assertEquals(leaked, [], `${name}: ${err[0]}`);
  }
});

Deno.test("CLI: the upload refuses redirects", async () => {
  let redirect = "";
  const { run } = setup({}, (req) => {
    redirect = req.redirect;
    return Response.json({ id: "A".repeat(22) }, { status: 201 });
  });
  await run(["send"], "hunter2");
  assertEquals(redirect, "error");
});

Deno.test("CLI: a malformed id from the server is never put into a link", async () => {
  for (const id of ["../../evil?x=", "short", "A".repeat(21) + "/", 42]) {
    const { run, out } = setup({}, () => Response.json({ id }, { status: 201 }));
    assertEquals(await run(["send"], "hunter2"), 1, String(id));
    assertEquals(out, []);
  }
});
