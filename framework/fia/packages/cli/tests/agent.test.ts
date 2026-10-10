import { exchangeBrowser } from "./browser-helpers.ts";
import { afterEach, expect, test } from "bun:test";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
  lstat,
} from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { defineAPI, implementAPI, z } from "../src/business-api.ts";
import { APIServer } from "../src/api-server.ts";
import { createAPIClient, readLines, readResult } from "../src/api-client.ts";
import { agentFetch, connectAgent } from "../src/agent-cli.ts";
import { startAgentServer, type AgentRecord } from "../src/agent-server.ts";
import { installSkill, manageCLI } from "../src/agent-install.ts";
import { defineBackend, type BackendNativeClient, type InitializeFrame } from "../src/backend.ts";
import { createGateway } from "../src/gateway.ts";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});
const contract = defineAPI({
  methods: {
    "counter.get": { description: "Read", input: z.strictObject({}), output: z.number() },
    "counter.add": {
      description: "Add",
      input: z.strictObject({ by: z.number() }),
      output: z.number(),
    },
    "bad.output": { description: "Invalid output", input: z.strictObject({}), output: z.number() },
    wait: { description: "Wait for cancellation", input: z.strictObject({}), output: z.null() },
  },
  events: {
    "counter.changed": { description: "Changed", payload: z.number() },
    "session.changed": {
      description: "Session",
      payload: z.object({ sessionId: z.string(), status: z.string() }),
    },
  },
});
async function fixture(development = false, commands = false) {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "fia-agent-")));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const bundlePath = resolve(root, "Test App.app");
  const supportPath = resolve(root, "data/test.app");
  await mkdir(resolve(supportPath, "Backend"), { recursive: true });
  await mkdir(resolve(bundlePath, "Contents/Helpers"), { recursive: true });
  await mkdir(resolve(bundlePath, "Contents/Resources"), { recursive: true });
  if (commands) {
    const directory = resolve(root, "agent/test-app/commands");
    await mkdir(directory, { recursive: true });
    await writeFile(
      resolve(directory, "probe.js"),
      `
if (process.argv.includes("wait")) { console.log("ready"); await new Promise(() => {}); }
else { console.log(JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),assets:process.env.FIA_COMMAND_ASSETS})); process.exitCode = process.argv.includes("fail") ? 7 : 0; }
`,
    );
    await writeFile(
      resolve(directory, "../metadata.json"),
      JSON.stringify({
        description: "Commands fixture",
        commands: { probe: { description: "Probe command", entry: "commands/probe.js" } },
      }),
    );
  }
  await symlink(process.execPath, resolve(bundlePath, "Contents/Helpers/bun"));
  for (const file of ["agent-cli.js", "script-preload.js"])
    await cp(
      resolve(import.meta.dir, "../dist", file),
      resolve(bundlePath, "Contents/Resources", file),
    );
  await writeFile(
    resolve(bundlePath, "Contents/Resources/fia.runtime.json"),
    JSON.stringify({
      schema: 4,
      runtimeId: "runtime",
      frameworkVersion: "test",
      app: { identifier: "test.app", name: "Test" },
      agent: { command: "test-app" },
    }),
  );
  let value = 0,
    aborted = false;
  const sources: string[] = [];
  const api = new APIServer(
    implementAPI(contract, {
      "counter.get": (_, ctx) => {
        sources.push(ctx.source);
        return value;
      },
      "counter.add": ({ by }, ctx) => {
        value += by;
        ctx.emit("counter.changed", value);
        return value;
      },
      "bad.output": () => "bad" as unknown as number,
      wait: (_, { signal }) =>
        new Promise<null>((resolve) =>
          signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              resolve(null);
            },
            { once: true },
          ),
        ),
    }),
    {
      app: {
        name: "Test",
        identifier: "test.app",
        dataDirectory: resolve(supportPath, "Backend"),
        codeDirectory: root,
      },
      native: {
        call: async () => ({ ok: true }),
        on: () => () => {},
      } as unknown as BackendNativeClient,
    },
  );
  api.ready = true;
  const init: InitializeFrame = {
    v: 5,
    type: "initialize",
    sessionSecret: "x".repeat(64),
    preferredPort: 0,
    development,
    applicationSupport: resolve(supportPath, "Backend"),
    generation: crypto.randomUUID(),
    webRoot: resolve(root, "web"),
    resourceDirectory: root,
    version: "1.0.0",
    build: 1,
    app: { name: "Test", identifier: "test.app" },
    bundlePath,
    runtimeId: "runtime",
    agentCommand: "test-app",
  };
  const server = await startAgentServer(
    api,
    init,
    () => "http://127.0.0.1:5173/_fia/browser/open#test",
  );
  cleanup.push(() => server.stop());
  const record = JSON.parse(
    await readFile(resolve(supportPath, "Agent/instance.json"), "utf8"),
  ) as AgentRecord;
  const send = agentFetch(record);
  const client = createAPIClient<typeof contract>(send);
  cleanup.push(async () => client.close());
  const spawn = (args: string[], stdin: "pipe" | "ignore" = "ignore") =>
    Bun.spawn(
      [
        process.execPath,
        "--no-env-file",
        "--no-orphans",
        resolve(bundlePath, "Contents/Resources/agent-cli.js"),
        bundlePath,
        supportPath,
        ...args,
      ],
      {
        cwd: root,
        env: { PATH: "/usr/bin:/bin", HOME: process.env.HOME },
        stdout: "pipe",
        stderr: "pipe",
        stdin,
      },
    );
  const cli = async (args: string[]) => {
    const child = spawn(args);
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { stdout, stderr, exitCode };
  };
  return {
    root,
    bundlePath,
    supportPath,
    api,
    server,
    record,
    send,
    client,
    cli,
    spawn,
    sources,
    init,
    aborted: () => aborted,
  };
}
async function until(predicate: () => boolean | Promise<boolean>, timeout = 4000) {
  const end = Date.now() + timeout;
  while (!(await predicate())) {
    if (Date.now() > end) throw new Error("Condition timed out");
    await Bun.sleep(20);
  }
}

test("API contract rejects non-JSON schemas and missing handlers", () => {
  expect(() =>
    defineAPI({ methods: { bad: { description: "bad", input: z.date(), output: z.string() } } }),
  ).toThrow();
  expect(() => implementAPI(contract, {} as never)).toThrow();
});
test("authenticated browser and CLI share one dispatcher, state and source context", async () => {
  const f = await fixture();
  const gateway = createGateway(defineBackend({}), f.api.context, f.init, f.api);
  gateway.ready = true;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: gateway.fetch,
    websocket: gateway.websocket,
  });
  cleanup.push(async () => {
    await server.stop(true);
  });
  const origin = "http://127.0.0.1:" + server.port;
  gateway.origin = origin;
  const { token } = await (await exchangeBrowser(origin, gateway.issueBrowserURL())).json();
  const call = (method: string, input: unknown, cookie = true) =>
    fetch(origin + "/_fia/api/call", {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        ...(cookie ? { authorization: "Bearer " + token } : {}),
      },
      body: JSON.stringify({ method, input, requestId: crypto.randomUUID() }),
    });
  expect((await call("counter.get", {}, false)).status).toBe(401);
  const writes = await Promise.all([
    call("counter.add", { by: 5 }).then(readResult),
    f.client.call("counter.add", { by: 2 }),
  ]);
  expect(writes).toContain(7);
  expect(await readResult(await call("counter.get", {}))).toBe(7);
  expect(f.sources).toContain("ui");
  const pending = call("wait", {});
  await until(() => f.api.calls.size === 1);
  gateway.revokeBrowsers();
  await until(f.aborted);
  expect((await pending).status).toBe(401);
  expect((await call("counter.get", {})).status).toBe(401);
  expect(await f.client.call("counter.get", {})).toBe(7);
});
test("shared API validates both directions, streams changes and protects local credentials", async () => {
  const f = await fixture();
  expect((await lstat(f.record.socket)).mode & 0o777).toBe(0o600);
  expect((await fetch("http://localhost/schema", { unix: f.record.socket })).status).toBe(401);
  const abort = new AbortController();
  const events = readLines(await f.send("/events", { signal: abort.signal }));
  expect((await events.next()).value?.type).toBe("ready");
  expect(await f.client.call("counter.add", { by: 2 })).toBe(2);
  expect((await events.next()).value).toEqual({
    type: "event",
    event: "counter.changed",
    payload: 2,
  });
  abort.abort();
  await events.return(undefined);
  await expect(f.client.call("counter.add", { by: "bad" } as never)).rejects.toMatchObject({
    code: "invalid_argument",
  });
  await expect(f.client.call("bad.output", {})).rejects.toMatchObject({ code: "invalid_output" });
  expect(await f.client.call("counter.get", {})).toBe(2);
});
test("cancellation reaches handlers and updates reject active calls and scripts", async () => {
  const f = await fixture();
  const abort = new AbortController();
  const pending = f.client.call("wait", {}, { signal: abort.signal }).catch((e) => e);
  await until(() => f.api.calls.size === 1);
  await expect(f.api.prepare()).rejects.toMatchObject({ code: "update_busy" });
  expect(f.api.updating).toBe(false);
  abort.abort();
  expect((await pending).code).toBe("cancelled");
  await until(f.aborted);
  const leaseAbort = new AbortController();
  const lease = readLines(await f.send("/lease", { signal: leaseAbort.signal }));
  await lease.next();
  await expect(f.api.prepare()).rejects.toMatchObject({ code: "update_busy" });
  leaseAbort.abort();
  await lease.return(undefined);
  await until(() => f.api.leases.size === 0);
  await expect(
    f.api.prepare(async () => ({ ready: false, reason: "saving" })),
  ).rejects.toMatchObject({ code: "update_busy" });
  await f.api.prepare();
  await f.server.publish();
  await expect(readResult(await f.send("/schema"))).rejects.toMatchObject({ code: "updating" });
});
test("event reconnection asks clients to refresh, and uncertain calls are never replayed", async () => {
  const f = await fixture();
  let connected = 0;
  const values: unknown[] = [];
  f.client.onReconnect(() => connected++);
  f.client.on("counter.changed", (value) => values.push(value));
  await until(() => connected === 1);
  await f.client.call("counter.add", { by: 1 });
  await until(() => values.length === 1);
  f.api.close();
  f.api.ready = true;
  await until(() => connected === 2);
  expect(values).toEqual([1]);
  let submitted = 0;
  const client = createAPIClient<typeof contract>(async () => {
    submitted++;
    throw new Error("lost");
  });
  await expect(client.call("counter.add", { by: 1 })).rejects.toMatchObject({
    code: "execution_unknown",
  });
  expect(submitted).toBe(1);
  client.close();
  await expect(
    connectAgent(
      {
        bundlePath: f.bundlePath,
        supportPath: f.supportPath,
        command: "test-app",
        identifier: "wrong.app",
      },
      "runtime",
      false,
    ),
  ).rejects.toMatchObject({ code: "instance_mismatch" });
});
test("update admission also rejects requests whose bodies were still arriving", async () => {
  const f = await fixture();
  let body!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      body = controller;
    },
  });
  const response = f.api.fetch(
    new Request("http://localhost/call", { method: "POST", body: stream }),
    "cli",
  );
  await f.api.prepare();
  body.enqueue(
    new TextEncoder().encode(
      JSON.stringify({ method: "counter.add", input: { by: 10 }, requestId: "late" }),
    ),
  );
  body.close();
  await expect(readResult(await response)).rejects.toMatchObject({ code: "updating" });
  f.api.updating = false;
  expect(await f.client.call("counter.get", {})).toBe(0);
  await expect(
    f.client.call("counter.get", {}, { signal: AbortSignal.abort() }),
  ).rejects.toMatchObject({ code: "cancelled" });
});
test("packaged CLI executes TypeScript, relative imports, JSONL and reports errors", async () => {
  const f = await fixture();
  const direct = await f.cli(["call", "counter.add", "--json", '{"by":3}']);
  if (direct.exitCode) throw new Error(direct.stderr);
  expect(direct.exitCode).toBe(0);
  expect(JSON.parse(direct.stdout)).toBe(3);
  const script = await f.cli([
    "exec",
    "-e",
    'const n: number = await app.call("counter.get", {}); console.log(n * 2);',
  ]);
  expect(script).toEqual({ exitCode: 0, stdout: "6\n", stderr: "" });
  expect(f.sources).toContain("script");
  await mkdir(resolve(f.root, "scripts"));
  await writeFile(resolve(f.root, "scripts/value.ts"), "export default 7");
  await writeFile(
    resolve(f.root, "scripts/run.ts"),
    'import n from "./value.ts"; console.log(await app.call("counter.add", {by:n}));',
  );
  const file = await f.cli(["exec", "--file", "scripts/run.ts", "--jsonl"]);
  expect(file.exitCode).toBe(0);
  expect(file.stdout).toContain('"type":"complete"');
  expect(file.stdout).toContain("10\\n");
  expect((await f.cli(["exec", "-e", "const ="])).exitCode).not.toBe(0);
  const timeout = await f.cli(["exec", "--timeout", "100", "-e", "while(true) {}"]);
  expect(timeout.exitCode).toBe(124);
  expect(timeout.stderr).toContain("timeout");
  const input = f.spawn(["exec"], "pipe");
  if (typeof input.stdin === "object") {
    input.stdin.write('console.log((await app.call("counter.get", {})) + 1);');
    input.stdin.end();
  }
  expect(await new Response(input.stdout).text()).toBe("11\n");
  expect(await input.exited).toBe(0);
}, 15000);
test("Ctrl-C and application disconnect terminate independent script processes", async () => {
  const f = await fixture();
  for (const cause of ["cancel", "disconnect"]) {
    const path = resolve(f.root, cause + ".pid");
    const child = f.spawn([
      "exec",
      "--timeout",
      "0",
      "-e",
      `await Bun.write(${JSON.stringify(path)}, String(process.pid)); while (true) {}`,
    ]);
    let pid: number | undefined;
    try {
      await until(() => Bun.file(path).exists());
      pid = Number(await readFile(path, "utf8"));
      if (cause === "cancel") child.kill("SIGINT");
      else f.api.close();
      expect(await child.exited).toBe(cause === "cancel" ? 130 : 75);
      await until(() => {
        try {
          process.kill(pid!, 0);
          return false;
        } catch {
          return true;
        }
      });
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      if (pid) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {}
      }
    }
  }
}, 10000);
test("a killed CLI supervisor leaves no script or descendant processes", async () => {
  const f = await fixture();
  const path = resolve(f.root, "pids.json");
  const code = `const child = Bun.spawn(["/bin/sleep", "60"]); await Bun.write(${JSON.stringify(path)}, JSON.stringify([process.pid, child.pid])); await Bun.sleep(60000);`;
  const supervisor = f.spawn(["exec", "-e", code]);
  let pids: number[] = [];
  try {
    await until(() => Bun.file(path).exists());
    pids = JSON.parse(await readFile(path, "utf8"));
    supervisor.kill("SIGKILL");
    await supervisor.exited;
    await until(() =>
      pids.every((pid) => {
        try {
          process.kill(pid, 0);
          return false;
        } catch {
          return true;
        }
      }),
    );
    await until(() => f.api.leases.size === 0);
  } finally {
    if (supervisor.exitCode === null && supervisor.signalCode === null) supervisor.kill("SIGKILL");
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
  }
}, 10000);
test("CLI and skill installation are explicit, repairable and never overwrite foreign files", async () => {
  const f = await fixture();
  const app = {
    identifier: "test.app",
    command: "test-app",
    bundlePath: f.bundlePath,
    supportPath: f.supportPath,
  };
  const bin = resolve(f.root, "bin");
  const path = resolve(bin, app.command);
  await manageCLI(app, "install", bin);
  expect(await readFile(path, "utf8")).toContain("Test App.app");
  expect((await manageCLI(app, "status", bin)).installed).toBe(true);
  await manageCLI({ ...app, bundlePath: "/new/path.app" }, "install", bin);
  expect(await readFile(path, "utf8")).toContain("/new/path.app");
  await manageCLI(app, "uninstall", bin);
  await writeFile(path, "foreign");
  await expect(manageCLI(app, "install", bin)).rejects.toThrow();
  await expect(manageCLI(app, "uninstall", bin)).rejects.toThrow();
  const assets = resolve(f.root, "assets/test-app");
  await mkdir(assets, { recursive: true });
  await writeFile(resolve(assets, "SKILL.md"), "version one");
  await symlink(resolve(f.root, "assets"), resolve(f.supportPath, "Agent/current"));
  const skill = await installSkill(app, resolve(f.root, "skills"));
  expect(await readFile(resolve(skill.path, "SKILL.md"), "utf8")).toBe("version one");
});

test("CLI event waits filter, count, time out quietly and preserve cancellation", async () => {
  const f = await fixture();
  const timeout = await f.cli(["events", "counter.changed", "--jsonl", "--timeout", "25"]);
  expect(timeout).toEqual({ stdout: "", stderr: "", exitCode: 124 });
  for (const args of [
    ["--count", "0"],
    ["--timeout", "-1"],
    ["--match", "[]"],
    ["--match", '{"x":{}}'],
  ])
    expect((await f.cli(["events", "counter.changed", ...args])).exitCode).toBe(2);
  const child = f.spawn([
    "events",
    "session.changed",
    "--count",
    "2",
    "--timeout",
    "2000",
    "--match",
    '{"sessionId":"a","status":"idle"}',
  ]);
  await until(() => (f.api as unknown as { streams: Set<unknown> }).streams.size === 1);
  f.api.emit("session.changed", { sessionId: "b", status: "idle" });
  f.api.emit("session.changed", { sessionId: "a", status: "running" });
  f.api.emit("session.changed", { sessionId: "a", status: "idle" });
  f.api.emit("session.changed", { sessionId: "a", status: "idle" });
  expect(await child.exited).toBe(0);
  expect(
    (await new Response(child.stdout).text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line).payload),
  ).toEqual([
    { sessionId: "a", status: "idle" },
    { sessionId: "a", status: "idle" },
  ]);
  expect(await new Response(child.stderr).text()).toBe("");
  await until(() => (f.api as unknown as { streams: Set<unknown> }).streams.size === 0);
  const cancelled = f.spawn(["events", "counter.changed"]);
  await until(() => (f.api as unknown as { streams: Set<unknown> }).streams.size === 1);
  cancelled.kill("SIGINT");
  expect(await cancelled.exited).toBe(130);
  expect(await new Response(cancelled.stdout).text()).toBe("");
  expect(await new Response(cancelled.stderr).text()).toContain('"cancelled"');
});

test("browser URLs require the authenticated agent endpoint in every mode", async () => {
  const production = await fixture();
  expect((await production.cli(["open", "--browser", "--url"])).exitCode).toBe(0);
  const dev = await fixture(true);
  const result = await dev.cli(["open", "--browser", "--url"]);
  expect(result.exitCode).toBe(0);
  expect(result.stdout.trim()).toBe("http://127.0.0.1:5173/_fia/browser/open#test");
  expect(result.stderr).toBe("");
  expect((await dev.cli(["open", "--url"])).exitCode).toBe(2);
  expect(
    (await fetch("http://localhost/browser", { unix: dev.record.socket, method: "POST" })).status,
  ).toBe(401);
});

test("application commands preserve arguments, cwd, asset root, help and exit status", async () => {
  const f = await fixture(false, true);
  const result = await f.cli(["probe", "a b", "--json", "$(literal)"]);
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    args: ["a b", "--json", "$(literal)"],
    cwd: f.root,
    assets: f.root,
  });
  expect((await f.cli(["probe", "fail"])).exitCode).toBe(7);
  expect((await f.cli(["help"])).stdout).toContain("probe: Probe command");
  expect((await f.cli(["unregistered"])).exitCode).toBe(2);
});

test("application commands hold the update lease and are cancelled with their supervisor", async () => {
  const f = await fixture(true, true);
  const child = f.spawn(["probe", "wait"]);
  await until(() => f.api.leases.size === 1);
  await expect(f.api.prepare()).rejects.toMatchObject({ code: "update_busy" });
  child.kill("SIGINT");
  expect(await child.exited).toBe(130);
  await until(() => f.api.leases.size === 0);
  await f.api.prepare();
  expect(f.api.updating).toBe(true);
});
