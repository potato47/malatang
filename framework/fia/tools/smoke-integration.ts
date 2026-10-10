import { readFile, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { requestSession } from "../packages/cli/src/session.ts";
import { repositoryRoot } from "./shared.ts";
import { stopDevelopmentChild } from "./develop-app.ts";

// This test deliberately edits sources. Require a disposable checkout marked by its caller.
const project = resolve(process.argv[2] ?? ".");
if (!(await Bun.file(resolve(project, ".fia/integration-fixture")).exists()))
  throw new Error(
    "Run this smoke only in a disposable checkout containing .fia/integration-fixture",
  );
const client = resolve(repositoryRoot, "packages/cli/src/client.ts");
const native = resolve(repositoryRoot, "Sources/FIACore/FIAVersion.swift");
const addition = resolve(repositoryRoot, "packages/cli/src/integration-probe.ts");
const backend = resolve(project, "backend/index.ts");
const frontend = resolve(project, "frontend/style.css");
const manifest = resolve(project, "package.json");
const originals = new Map(
  await Promise.all(
    [client, native, backend, frontend, manifest].map(
      async (path) => [path, await readFile(path, "utf8")] as const,
    ),
  ),
);
const logs: string[] = [];
const pids = new Set<number>();
const results: string[] = [];
const child = Bun.spawn(
  [process.execPath, resolve(repositoryRoot, "tools/develop-app.ts"), project],
  {
    cwd: project,
    detached: true,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  },
);
const drain = async (stream: ReadableStream<Uint8Array>) => {
  for await (const bytes of stream) logs.push(new TextDecoder().decode(bytes));
};
const drains = Promise.all([drain(child.stdout), drain(child.stderr)]);
const wait = async <T>(label: string, probe: () => Promise<T | undefined>, timeout = 90_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await probe();
    if (value !== undefined) return value;
    await Bun.sleep(150);
  }
  throw new Error("Timed out: " + label + "\n" + logs.join(""));
};
const status = () =>
  requestSession(project, "status") as Promise<{
    running: boolean;
    runtime?: { pid: number; backend: string; frontendsReady: string[]; processGroups: number[] };
  }>;
const ready = (previous?: number) =>
  wait("ready after " + previous, async () => {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error("Supervisor exited\n" + logs.join(""));
    const { runtime } = await status();
    if (
      runtime?.backend === "ready" &&
      runtime.frontendsReady?.includes("main") &&
      runtime.pid !== previous
    ) {
      pids.add(runtime.pid);
      runtime.processGroups?.forEach((pid) => pids.add(pid));
      return runtime.pid;
    }
  });
const count = (text: string) => logs.join("").split(text).length - 1;
try {
  let pid = await ready();
  const beforeBurst = count("Application ready");
  await writeFile(client, originals.get(client)! + "\n// integration burst 1\n");
  await Bun.sleep(30);
  await writeFile(client, originals.get(client)! + "\n// integration burst 2\n");
  pid = await ready(pid);
  await Bun.sleep(1500);
  if (count("Application ready") !== beforeBurst + 1)
    throw new Error("Burst triggered duplicate restarts");
  results.push("TypeScript burst: one restart");
  const nativeBuilds = count("building native runtime");
  await writeFile(client, originals.get(client)! + "\nexport const = broken;\n");
  await wait("failed build", async () =>
    logs.join("").includes("build failed; Dev is stopped") && !(await status()).running
      ? true
      : undefined,
  );
  // Revert exactly to the last successful inputs: it must still restart the stopped app.
  await writeFile(client, originals.get(client)! + "\n// integration burst 2\n");
  pid = await ready(pid);
  if (count("building native runtime") !== nativeBuilds)
    throw new Error("CLI failure invalidated native cache");
  results.push("compile error: stopped, recovered, native cache retained");
  await writeFile(addition, "export const integrationProbe = true;\n");
  pid = await ready(pid);
  await rm(addition);
  pid = await ready(pid);
  results.push("source addition/deletion: restarted");
  await writeFile(native, originals.get(native)! + "\n// integration native rebuild\n");
  pid = await ready(pid);
  if (count("building native runtime") !== nativeBuilds + 1)
    throw new Error("Native source did not rebuild exactly once");
  results.push("native source: runtime rebuilt and restarted");
  const preparations = count("preparing latest sources");
  await writeFile(frontend, originals.get(frontend)! + "\n:root { --integration-smoke: 1; }\n");
  await Bun.sleep(2000);
  if ((await status()).runtime?.pid !== pid) throw new Error("Frontend edit restarted host");
  await writeFile(backend, originals.get(backend)! + "\n// integration application backend\n");
  pid = await ready(pid);
  if (count("preparing latest sources") !== preparations)
    throw new Error("App edit triggered framework rebuild");
  results.push("application frontend/backend: existing reload paths retained");
  await writeFile(manifest, originals.get(manifest)! + "\n");
  await wait("dependency change exits supervisor", async () =>
    child.exitCode !== null ? true : undefined,
  );
  if (child.exitCode !== 75) throw new Error("Dependency change did not request a restart");
  results.push("dependency declaration: supervisor exits with instructions");
} finally {
  await stopDevelopmentChild(child);
  await drains;
  for (const [path, original] of originals) await writeFile(path, original);
  await rm(addition, { force: true });
  await writeFile(resolve(project, ".fia/integration-smoke.log"), logs.join(""));
}
await wait(
  "all observed managed processes stopped",
  async () => {
    for (const pid of pids) {
      try {
        process.kill(pid, 0);
        return undefined;
      } catch {
        /* exited */
      }
    }
    return true;
  },
  10_000,
);
results.push("shutdown: all observed managed processes exited");
console.log(JSON.stringify({ ok: true, results }, null, 2));
