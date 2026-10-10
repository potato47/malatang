import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { isBunVersionSupported, MINIMUM_BUN_VERSION } from "../packages/cli/src/bun-version.ts";

export const repositoryRoot = resolve(import.meta.dir, "..");
export const generatedRoot = resolve(repositoryRoot, ".fia/generated");
export const generatedUIPath = resolve(generatedRoot, "ui/index.txt");
export const defaultAppPath = resolve(repositoryRoot, "dist/FIAPrototype.app");

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  quiet?: boolean;
}

export async function runInteractive(
  command: readonly string[],
  options: Omit<RunOptions, "quiet"> = {},
): Promise<void> {
  const child = Bun.spawn([...command], {
    cwd: options.cwd ?? repositoryRoot,
    env: options.env ?? process.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    const rendered = command.map((part) => JSON.stringify(part)).join(" ");
    throw new Error(`Command failed with status ${exitCode}: ${rendered}`);
  }
}

export async function run(command: readonly string[], options: RunOptions = {}): Promise<string> {
  const process = Bun.spawn([...command], {
    cwd: options.cwd ?? repositoryRoot,
    env: options.env ?? globalThis.process.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (!options.quiet) {
    if (stdout.length > 0) globalThis.process.stdout.write(stdout);
    if (stderr.length > 0) globalThis.process.stderr.write(stderr);
  }
  if (exitCode !== 0) {
    const rendered = command.map((part) => JSON.stringify(part)).join(" ");
    throw new Error(`Command failed with status ${exitCode}: ${rendered}\n${stderr.trim()}`);
  }
  return stdout;
}

export function requireBunVersion(): void {
  if (!isBunVersionSupported(Bun.version)) {
    throw new Error(`FIA requires Bun ${MINIMUM_BUN_VERSION} or newer; found ${Bun.version}`);
  }
}

export async function ensureParent(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
}

export function assertInsideWorkspace(path: string): void {
  const absolute = resolve(path);
  if (absolute !== repositoryRoot && !absolute.startsWith(`${repositoryRoot}/`)) {
    throw new Error(`Refusing to operate outside the FIA workspace: ${absolute}`);
  }
}
