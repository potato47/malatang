import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { exists } from "node:fs/promises";
import type { ResolvedFIAConfig } from "./project-config.ts";

export async function waitUntil<T>(
  read: () => Promise<T | undefined>,
  timeout: number,
  label: string,
): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await read();
    if (result !== undefined) return result;
    await Bun.sleep(100);
  }
  throw new Error(`${label} timed out after ${timeout} ms`);
}

export async function readInspection(
  directory: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await readFile(resolve(directory, "ready.json"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

export async function smokeApplication(
  config: ResolvedFIAConfig,
  app = resolve(config.projectRoot, "dist", `${config.app.name}.app`),
) {
  const executable = resolve(app, "Contents/MacOS/FIAHost");
  if (!(await exists(executable)))
    throw new Error("No built app found. Run fia build before fia smoke.");
  const directory = await mkdtemp(resolve(tmpdir(), "fia-smoke-"));
  await mkdir(resolve(directory, "data"));
  const child = Bun.spawn([executable], {
    cwd: directory,
    env: {
      PATH: "/usr/bin:/bin",
      TMPDIR: directory,
      FIA_CONTROL_DIRECTORY: directory,
      FIA_DATA_DIRECTORY: resolve(directory, "data"),
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  let log = "";
  const drain = async (stream: ReadableStream<Uint8Array>) => {
    for await (const data of stream) log = (log + new TextDecoder().decode(data)).slice(-65536);
  };
  const drains = [drain(child.stdout), drain(child.stderr)];
  try {
    const runtime = await waitUntil(
      async () => {
        if (child.exitCode !== null)
          throw new Error(`Packaged application exited before ready (${child.exitCode}): ${log}`);
        const status = await readInspection(directory);
        if (status?.backend === "failed") throw new Error(`Packaged backend failed: ${log}`);
        return status?.lifecycle === "running" &&
          status.backend === "ready" &&
          Array.isArray(status.frontendsReady) &&
          status.frontendsReady.includes("main")
          ? status
          : undefined;
      },
      30000,
      "Packaged application readiness",
    );
    await writeFile(resolve(directory, "quit"), "");
    await waitUntil(
      async () => (child.exitCode === null ? undefined : child.exitCode),
      20000,
      "Ordinary application quit",
    );
    await Promise.all(drains);
    if (child.exitCode !== 0) throw new Error(`Packaged app exited with ${child.exitCode}: ${log}`);
    const groups = Array.isArray(runtime.processGroups) ? runtime.processGroups : [];
    await waitUntil(
      async () =>
        groups.every((pid) => {
          if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 1)
            throw new Error("Invalid process identity from runtime inspection");
          try {
            process.kill(-pid, 0);
            return false;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ESRCH") return true;
            throw error;
          }
        })
          ? true
          : undefined,
      3000,
      "Managed process group cleanup",
    );
    return {
      schemaVersion: 1,
      ok: true,
      application: app,
      checks: [
        "packaged-launch",
        "runtime-ready",
        "backend-ready",
        "ordinary-quit",
        "managed-process-groups-stopped",
      ],
      runtime,
      desktopInteraction: "not-tested",
      logs: log,
    };
  } finally {
    if (child.exitCode === null) {
      await writeFile(resolve(directory, "quit"), "").catch(() => {});
      try {
        await waitUntil(
          async () => (child.exitCode === null ? undefined : child.exitCode),
          5000,
          "Cleanup",
        );
      } catch {
        child.kill("SIGKILL");
        await child.exited;
      }
    }
    await Promise.all(drains);
    await rm(directory, { recursive: true, force: true });
  }
}
