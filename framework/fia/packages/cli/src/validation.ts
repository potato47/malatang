import { resolve } from "node:path";
import { readdir } from "node:fs/promises";
import { exists } from "node:fs/promises";
import type { ResolvedFIAConfig } from "./project-config.ts";

export async function runCapture(command: readonly string[], cwd: string) {
  const child = Bun.spawn([...command], { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

export async function typecheckCommands(
  config: ResolvedFIAConfig,
): Promise<Array<{ id: string; command: string[] }>> {
  const tsc = resolve(config.projectRoot, "node_modules/typescript/bin/tsc");
  const commands = [
    { id: "typescript", command: [process.execPath, tsc, "--noEmit", "-p", "tsconfig.json"] },
  ];
  return commands;
}

export async function checkTypes(
  config: ResolvedFIAConfig,
): Promise<Array<{ id: string; status: "pass" | "fail"; message: string }>> {
  const checks: Array<{ id: string; status: "pass" | "fail"; message: string }> = [];
  for (const { id, command } of await typecheckCommands(config)) {
    try {
      const result = await runCapture(command, config.projectRoot);
      checks.push({
        id,
        status: result.exitCode === 0 ? "pass" : "fail",
        message:
          result.exitCode === 0
            ? "TypeScript types are valid"
            : `${result.stderr || result.stdout}\nInstall project dependencies with bun install and fix the reported types.`,
      });
    } catch (error) {
      checks.push({ id, status: "fail", message: String(error) });
    }
  }
  return checks;
}

export async function applicationTests(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(directory: string) {
    if (!(await exists(directory))) return;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (
        ["node_modules", ".fia", ".git", "dist", "native"].includes(entry.name) ||
        entry.isSymbolicLink()
      )
        continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (/\.(test|spec)\.[cm]?[jt]sx?$/u.test(entry.name)) files.push(path);
    }
  }
  await walk(root);
  return files.sort();
}
