import { readFile, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { defaultAppPath, run } from "./shared.ts";
import { verifyApp } from "./verify-prototype.ts";

const hostExecutable = resolve(defaultAppPath, "Contents/MacOS/FIAHost");
const pidFile = resolve(homedir(), "Library/Application Support/dev.fia.prototype/runtime.pid");
const stderrCaptures = new Map<number, Promise<string>>();

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  description: string,
  timeoutMilliseconds = 12_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await Bun.sleep(100);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function readRuntimePID(): Promise<number> {
  await waitFor(() => Bun.file(pidFile).exists(), "runtime PID file");
  const pid = Number.parseInt((await readFile(pidFile, "utf8")).trim(), 10);
  if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error(`Invalid runtime PID file: ${pid}`);
  await waitFor(() => processExists(pid), `runtime ${pid} to start`);
  return pid;
}

async function clearStalePIDFile(): Promise<void> {
  if (!(await Bun.file(pidFile).exists())) return;
  const existing = Number.parseInt((await readFile(pidFile, "utf8")).trim(), 10);
  if (Number.isSafeInteger(existing) && processExists(existing)) {
    throw new Error(`Refusing lifecycle tests while runtime ${existing} is already running`);
  }
  await unlink(pidFile);
}

function launch(extraEnvironment: Record<string, string> = {}): Bun.Subprocess<"ignore", "pipe", "pipe"> {
  const host = Bun.spawn([hostExecutable], {
    cwd: resolve(defaultAppPath, "Contents/MacOS"),
    env: { ...process.env, FIA_INTERNAL_DIAGNOSTICS: "1", ...extraEnvironment },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  stderrCaptures.set(host.pid, new Response(host.stderr).text());
  return host;
}

async function capturedError(host: Bun.Subprocess<"ignore", "pipe", "pipe">): Promise<string> {
  return await (stderrCaptures.get(host.pid) ?? Promise.resolve(""));
}

async function gracefulScenario(): Promise<void> {
  await clearStalePIDFile();
  const host = launch({ FIA_INTERNAL_AUTO_QUIT_MS: "750" });
  let runtimePID: number | undefined;
  try {
    runtimePID = await readRuntimePID();
    const exitCode = await Promise.race([
      host.exited,
      Bun.sleep(15_000).then(() => { throw new Error("Host did not quit gracefully"); }),
    ]);
    const stderr = await capturedError(host);
    if (exitCode !== 0) throw new Error(`Host exited with ${exitCode}: ${stderr}`);
    if (stderr.includes("graceful timeout elapsed")) {
      throw new Error(`Runtime required signal escalation during normal quit:\n${stderr}`);
    }
    await waitFor(() => !processExists(runtimePID!), `runtime ${runtimePID} to exit after graceful quit`);
    await waitFor(async () => !(await Bun.file(pidFile).exists()), "runtime PID file removal");
  } catch (error) {
    if (processExists(host.pid)) process.kill(host.pid, "SIGKILL");
    await host.exited;
    if (runtimePID !== undefined && processExists(runtimePID)) process.kill(runtimePID, "SIGKILL");
    const stderr = await capturedError(host);
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${stderr}`);
  }
}

async function hostDeathScenario(): Promise<void> {
  await clearStalePIDFile();
  const host = launch();
  const runtimePID = await readRuntimePID();
  process.kill(host.pid, "SIGKILL");
  await host.exited;
  await capturedError(host);
  await waitFor(() => !processExists(runtimePID), `runtime ${runtimePID} to exit after Host SIGKILL`);
}

async function runtimeDeathScenario(): Promise<void> {
  await clearStalePIDFile();
  const host = launch();
  const runtimePID = await readRuntimePID();
  process.kill(runtimePID, "SIGKILL");
  await waitFor(() => !processExists(runtimePID), `runtime ${runtimePID} to terminate`);
  await Bun.sleep(750);
  if (!processExists(host.pid)) {
    throw new Error("Host exited instead of remaining available with its recovery UI");
  }
  process.kill(host.pid, "SIGKILL");
  await host.exited;
  await capturedError(host);
}

await verifyApp();
await clearStalePIDFile();

await gracefulScenario();
await hostDeathScenario();
await runtimeDeathScenario();
await run(["/usr/bin/codesign", "--verify", "--deep", "--strict", defaultAppPath]);
console.log("Lifecycle verification passed: graceful exit, Host death, and Runtime death.");
