import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildApplication, defaultRunner } from "../packages/cli/src/application.ts";
import { localProfile } from "../packages/cli/src/local-profile.ts";
import type { ResolvedFIAConfig } from "../packages/cli/src/project-config.ts";
import { sha256 } from "../packages/cli/src/artifacts.ts";
import { waitUntil } from "../packages/cli/src/smoke.ts";

/** Real bundle/CLI test: embedded preview storage, locks, restart and simultaneous development. */
export async function smokeLocalProfiles(
  config: ResolvedFIAConfig,
  development: () => Promise<void>,
) {
  const preview = await buildApplication(config, { preview: true });
  const profile = localProfile(config, "preview");
  const manifest = JSON.parse(
    await readFile(resolve(preview.app, "Contents/Resources/fia.runtime.json"), "utf8"),
  );
  if (
    manifest.updates ||
    manifest.app.name !== `${config.app.name} Preview` ||
    manifest.agent.command !== `${config.agent.command}-preview`
  )
    throw new Error("Preview identity or update isolation failed");
  const plist = await defaultRunner(
    [
      "/usr/bin/plutil",
      "-extract",
      "CFBundleIdentifier",
      "raw",
      resolve(preview.app, "Contents/Info.plist"),
    ],
    { cwd: config.projectRoot },
  );
  if (plist.stdout.trim() !== profile.bundleIdentifier)
    throw new Error("Preview bundle identity failed");
  if (
    config.app.icon &&
    (await sha256(resolve(preview.app, "Contents/Resources/AppIcon.icns"))) ===
      (await sha256(resolve(config.projectRoot, config.app.icon)))
  )
    throw new Error("Preview Dock badge is missing");
  const env = { PATH: process.env.PATH };
  const run = async (args: string[], projectCLI = false) => {
    const command = projectCLI
      ? [
          process.execPath,
          resolve(import.meta.dir, "../packages/cli/src/index.ts"),
          "agent",
          "--preview",
          ...args,
        ]
      : [preview.executable, "--cli", ...args];
    const result = await defaultRunner(command, { cwd: config.projectRoot, env });
    if (result.exitCode !== 0) throw new Error("Preview CLI failed: " + result.stderr);
    return result.stdout;
  };
  const instancePath = resolve(profile.dataRoot, config.app.identifier, "Agent/instance.json");
  let pid: number | undefined;
  const quit = async () => {
    await run(["quit"]);
    await waitUntil(
      async () => {
        try {
          process.kill(pid!, 0);
          return undefined;
        } catch {
          return true;
        }
      },
      10000,
      "Preview quit",
    );
    pid = undefined;
  };
  try {
    if (JSON.parse(await run(["call", "counter.increment", "--json", '{"by":7}'])).value !== 7)
      throw new Error("Preview did not start with isolated data");
    pid = JSON.parse(await readFile(instancePath, "utf8")).hostPID;
    const duplicate = await defaultRunner([preview.executable], { cwd: config.projectRoot, env });
    if (duplicate.exitCode === 0 || !duplicate.stderr.includes("already running"))
      throw new Error("Preview did not retain same-profile single-instance protection");
    await development();
    if (JSON.parse(await run(["call", "counter.get", "--json", "{}"], true)).value !== 7)
      throw new Error("Development changed preview state");
    await quit();
    if (JSON.parse(await run(["call", "counter.get", "--json", "{}"], true)).value !== 7)
      throw new Error("Preview CLI restart lost persistent data");
    pid = JSON.parse(await readFile(instancePath, "utf8")).hostPID;
    await quit();
    console.log(
      "Local profiles: embedded preview data, distinct bundle/icon/CLI, single-instance lock, concurrent development and persistent restart passed.",
    );
  } finally {
    if (pid) await quit();
  }
}
