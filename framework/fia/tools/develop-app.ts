import { isAbsolute, relative, resolve } from "node:path";
import { fingerprint, nativeInputs, cliInputs } from "./prepare.ts";
import { repositoryRoot } from "./shared.ts";
import { findWorkspace } from "./workspace.ts";
import { parseDevelopmentOptions } from "../packages/cli/src/development-options.ts";

export async function developmentInputs(projectRoot: string) {
  const workspace = await findWorkspace();
  return {
    build: await fingerprint(repositoryRoot, [...new Set([...nativeInputs, ...cliInputs])]),
    control:
      (await fingerprint(repositoryRoot, ["tools", "package.json", "packages/cli/package.json"])) +
      (await fingerprint(workspace.root, ["bun.lock", "package.json"])) +
      (await fingerprint(projectRoot, ["package.json"])),
  };
}

export async function stopDevelopmentChild(child: Bun.Subprocess, graceMilliseconds = 30_000) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      child.exited,
      new Promise<void>((_, reject) => {
        timer = setTimeout(() => {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
            child.kill("SIGKILL");
          }
          reject(new Error("Development process failed to stop gracefully"));
        }, graceMilliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Framework-maintainer entry point. Ordinary generated apps continue using fia dev. */
export async function developApplication(projectRoot: string, args: string[]) {
  projectRoot = resolve(projectRoot);
  parseDevelopmentOptions(args);
  const frameworkPath = relative(projectRoot, repositoryRoot);
  const ignore =
    frameworkPath && !frameworkPath.startsWith("..") && !isAbsolute(frameworkPath)
      ? ["--watch-ignore", frameworkPath]
      : [];
  let stopped = false;
  let child: Bun.Subprocess | undefined;
  let applied: string | undefined;
  let failed: string | undefined;
  const initial = await developmentInputs(projectRoot);
  const stop = () => {
    stopped = true;
    child?.kill("SIGTERM");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  const spawn = (command: string[], cwd: string) =>
    Bun.spawn(command, {
      cwd,
      detached: true,
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    });
  console.log(
    "framework: watching sources; framework changes restart this Dev instance and invalidate browser sessions",
  );
  try {
    while (!stopped) {
      const input = await developmentInputs(projectRoot);
      if (input.control !== initial.control) {
        console.error(
          "framework: dependency declarations, lockfile or maintainer tools changed; run bun install if needed, then restart dev",
        );
        return 75;
      }
      if (input.build !== applied && input.build !== failed) {
        // Wait for a quiet save interval before touching a live instance.
        await Bun.sleep(250);
        if (stopped) break;
        const settled = await developmentInputs(projectRoot);
        if (settled.build !== input.build || settled.control !== initial.control) continue;
        if (child) {
          await stopDevelopmentChild(child);
          child = undefined;
        }
        applied = undefined;
        console.log("framework: preparing latest sources");
        child = spawn(
          [process.execPath, resolve(repositoryRoot, "tools/prepare.ts")],
          repositoryRoot,
        );
        const code = await child.exited;
        child = undefined;
        if (stopped) break;
        const latest = await developmentInputs(projectRoot);
        if (latest.build !== input.build || latest.control !== initial.control) continue;
        if (code !== 0) {
          failed = input.build;
          console.error("framework: build failed; Dev is stopped. Fix framework sources to retry");
          continue;
        }
        failed = undefined;
        applied = input.build;
        child = spawn(
          [
            process.execPath,
            resolve(repositoryRoot, "packages/cli/bin/fia"),
            "dev",
            ...args,
            ...ignore,
          ],
          projectRoot,
        );
      }
      if (child && (child.exitCode !== null || child.signalCode !== null))
        return child.exitCode ?? 1;
      await Bun.sleep(400);
    }
    return 130;
  } finally {
    if (child) await stopDevelopmentChild(child);
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

if (import.meta.main) {
  try {
    const [project = ".", ...args] = process.argv.slice(2);
    process.exitCode = await developApplication(project, args);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
