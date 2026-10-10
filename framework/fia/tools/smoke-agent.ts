import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { readInspection, waitUntil } from "../packages/cli/src/smoke.ts";
import { defaultRunner } from "../packages/cli/src/application.ts";
import type { ResolvedFIAConfig } from "../packages/cli/src/project-config.ts";

export async function smokeAgent(config: ResolvedFIAConfig, app: string) {
  const root = await mkdtemp(resolve(tmpdir(), "fia-agent-smoke-"));
  const control = resolve(root, "control");
  await mkdir(control);
  const env = {
    PATH: "/usr/bin:/bin",
    FIA_DATA_DIRECTORY: resolve(root, "data"),
    FIA_CONTROL_DIRECTORY: control,
  };
  const host = resolve(app, "Contents/MacOS/FIAHost");
  const run = async (args: string[], executable = host) => {
    const child = Bun.spawn([executable, ...(executable === host ? ["--cli"] : []), ...args], {
      env,
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (exitCode !== 0) throw new Error(`Agent CLI failed (${exitCode}): ${stderr}`);
    return stdout;
  };
  let quit = false;
  try {
    const cold = await Promise.all(
      Array.from({ length: 3 }, () => run(["call", "counter.get", "--json", "{}"])),
    );
    if (!cold.every((value) => JSON.parse(value).value === 0))
      throw new Error("Cold CLI calls did not share the application state");
    const hidden = await waitUntil(
      async () => {
        const state = await readInspection(control);
        return state?.backend === "ready" ? state : undefined;
      },
      5000,
      "Background application ready",
    );
    if (!hidden.background || (hidden.visibleWindows as string[]).length)
      throw new Error("CLI startup showed a window");
    if (process.env.FIA_SMOKE_DESKTOP === "1") {
      console.log(
        `Desktop verification: ${JSON.stringify({ app, control, resume: resolve(control, "desktop-verified") })}`,
      );
      await waitUntil(
        async () =>
          (await Bun.file(resolve(control, "desktop-verified")).exists()) ? true : undefined,
        300000,
        "Desktop verification",
      );
    }
    await Promise.all(
      Array.from({ length: 5 }, () => run(["call", "counter.increment", "--json", '{"by":1}'])),
    );
    if (JSON.parse(await run(["call", "counter.get", "--json", "{}"])).value !== 5)
      throw new Error("Concurrent counter writes were lost");
    await run(["call", "counter.increment", "--json", '{"by":-5}']);
    const changed = JSON.parse(await run(["call", "counter.increment", "--json", '{"by":2}']));
    if (changed.value !== 2) throw new Error("CLI counter change failed");
    const script = await run([
      "exec",
      "-e",
      'const n: number = (await app.call("counter.increment", {by:3})).value; console.log(n);',
    ]);
    if (script.trim() !== "5") throw new Error("Packaged TypeScript SDK did not use shared state");
    const installation = JSON.parse(await run(["install", "--dir", resolve(root, "bin")]));
    const installed = JSON.parse(
      await run(["call", "counter.get", "--json", "{}"], installation.path),
    );
    if (installed.value !== 5)
      throw new Error("Installed command is not using the application runtime");
    const skill = JSON.parse(await run(["skill", "install", "--dir", resolve(root, "skills")]));
    if (!(await readFile(resolve(skill.path, "SKILL.md"), "utf8")).includes(config.agent.command))
      throw new Error("Installed skill is incomplete");
    const signature = await defaultRunner(
      ["/usr/bin/codesign", "--verify", "--deep", "--strict", app],
      { cwd: root },
    );
    if (signature.exitCode) throw new Error("CLI installation changed the signed bundle");
    await run(["open"]);
    await waitUntil(
      async () => {
        const state = await readInspection(control);
        return (state?.visibleWindows as string[] | undefined)?.includes("main") &&
          state?.pid === hidden.pid
          ? true
          : undefined;
      },
      5000,
      "CLI open shows the existing window",
    );
    await run(["uninstall", "--dir", resolve(root, "bin")]);
    await run(["quit"]);
    quit = true;
    await waitUntil(
      async () => {
        try {
          process.kill(hidden.pid as number, 0);
          return;
        } catch {
          return true;
        }
      },
      10000,
      "Agent application quit",
    );
    console.log(
      "Agent: concurrent cold startup, hidden window, shared API, TypeScript, installed CLI/skill, signature, open and quit passed.",
    );
  } finally {
    if (!quit) {
      await run(["quit"]).catch(async () => {
        // Keep cleanup independent of the CLI path under test.
        await writeFile(resolve(control, "quit"), "quit");
      });
      const state = await readInspection(control);
      if (state)
        await waitUntil(
          async () => {
            try {
              process.kill(state.pid as number, 0);
              return;
            } catch {
              return true;
            }
          },
          10000,
          "Failed smoke application cleanup",
        );
    }
    await rm(root, { recursive: true, force: true });
  }
}
