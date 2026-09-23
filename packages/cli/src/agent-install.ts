import {
  lstat,
  mkdir,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
export interface AgentInstallation {
  identifier: string;
  command: string;
  bundlePath: string;
  supportPath: string;
}
const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
export async function manageCLI(
  app: AgentInstallation,
  action: "install" | "uninstall" | "status",
  directory = resolve(homedir(), ".local/bin"),
) {
  const path = resolve(directory, app.command);
  const marker = "# FIA CLI " + app.identifier;
  let existing: string | undefined;
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error("Command path is not an owned regular file: " + path);
    existing = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const owned = existing?.split("\n")[1] === marker;
  const expected = `#!/bin/sh\n${marker}\nexec ${quote(resolve(app.bundlePath, "Contents/MacOS/FIAHost"))} --cli "$@"\n`;
  if (action === "status")
    return {
      path,
      installed: owned && existing === expected,
      conflict: existing !== undefined && !owned,
      onPath: (process.env.PATH ?? "").split(":").includes(directory),
    };
  if (existing !== undefined && !owned)
    throw new Error("Refusing to replace another command: " + path);
  if (action === "uninstall") {
    if (owned) await rm(path);
    return { path, installed: false };
  }
  await mkdir(directory, { recursive: true });
  if (existing === undefined) await writeFile(path, expected, { mode: 0o755, flag: "wx" });
  else {
    const temporary = path + ".fia-" + crypto.randomUUID();
    await writeFile(temporary, expected, { mode: 0o755, flag: "wx" });
    await rename(temporary, path);
  }
  return {
    path,
    installed: true,
    pathHint: `Add ${directory} to PATH if it is not already present.`,
  };
}
export async function installSkill(
  app: AgentInstallation,
  directory = resolve(homedir(), ".agents/skills"),
) {
  const target = resolve(app.supportPath, "Agent/current", app.command);
  await realpath(target);
  await mkdir(directory, { recursive: true });
  const path = resolve(directory, app.command);
  try {
    if ((await readlink(path)) === target) return { path, installed: true };
    throw new Error("Skill path belongs to another installation: " + path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await symlink(target, path);
  return { path, installed: true };
}
