import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import cliPackage from "../packages/cli/package.json";
import rootPackage from "../package.json";
import { CLI_PACKAGE_NAME, CLI_VERSION } from "../packages/cli/src/metadata.ts";
import { repositoryRoot, requireBunVersion } from "./shared.ts";

const NPM_REGISTRY = "https://registry.npmjs.org/";
const PACKAGE_DIRECTORY = resolve(repositoryRoot, "packages/cli");

const help = `Publish @semicoder/fia from the FIA repository root

Usage:
  bun run release:npm --dry-run
  bun run release:npm

Options:
  --dry-run    Run local checks and npm's publication simulation
  -h, --help   Show this help
`;

export interface ReleaseArguments {
  readonly dryRun: boolean;
  readonly help: boolean;
}
interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export function parseReleaseArguments(arguments_: readonly string[]): ReleaseArguments {
  let dryRun = false;
  let showHelp = false;
  for (const argument of arguments_) {
    if (argument === "--dry-run") {
      if (dryRun) throw new Error("--dry-run may only be specified once");
      dryRun = true;
    } else if (argument === "-h" || argument === "--help") showHelp = true;
    else throw new Error(`unknown option: ${argument}`);
  }
  if (showHelp && arguments_.length !== 1) throw new Error("--help does not accept other options");
  return { dryRun, help: showHelp };
}

async function capture(command: readonly string[], cwd = repositoryRoot): Promise<CommandResult> {
  const child = Bun.spawn([...command], {
    cwd,
    env: process.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stdout, stderr };
}

async function run(command: readonly string[], cwd = repositoryRoot): Promise<void> {
  const child = Bun.spawn([...command], {
    cwd,
    env: process.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0)
    throw new Error(`command failed with status ${exitCode}: ${command.join(" ")}`);
}

export async function validateReleaseMetadata(): Promise<void> {
  if (
    cliPackage.name !== CLI_PACKAGE_NAME ||
    cliPackage.version !== CLI_VERSION ||
    rootPackage.version !== CLI_VERSION
  ) {
    throw new Error("npm package and FIA framework versions must match");
  }
  if (cliPackage.publishConfig.access !== "public")
    throw new Error("package publishConfig.access must be public");
  const expectedFiles = ["bin", "dist", "templates", "README.md"];
  if (JSON.stringify(cliPackage.files) !== JSON.stringify(expectedFiles)) {
    throw new Error(`package files must be exactly ${expectedFiles.join(", ")}`);
  }
  const expectedExports = ["./client", "./backend", "./vite"];
  if (JSON.stringify(Object.keys(cliPackage.exports)) !== JSON.stringify(expectedExports)) {
    throw new Error("package exports must contain client, backend, and vite only");
  }
  const packageManifest = await readFile(resolve(repositoryRoot, "Package.swift"), "utf8");
  if (!packageManifest.includes('exact: "2.9.6"') || !packageManifest.includes('exact: "2.97.1"')) {
    throw new Error("Swift Package dependencies must pin Sparkle 2.9.6 and SwiftNIO 2.97.1");
  }
  const swiftVersion = await readFile(
    resolve(repositoryRoot, "Sources/FIACore/FIAVersion.swift"),
    "utf8",
  );
  if (!swiftVersion.includes(`public static let current = "${CLI_VERSION}"`)) {
    throw new Error("Swift Runtime and npm CLI versions must match exactly");
  }
  const template = await readFile(
    resolve(PACKAGE_DIRECTORY, "templates/v2/common/native/Package.swift.template"),
    "utf8",
  );
  if (!template.includes("__FIA_SWIFT_PACKAGE_DEPENDENCY__")) {
    throw new Error("application templates must render the FIA Swift Package dependency");
  }
}

async function ensureAuthenticated(): Promise<void> {
  const result = await capture(["npm", "whoami", "--registry", NPM_REGISTRY]);
  if (result.exitCode !== 0)
    throw new Error(`npm authentication is required; run npm login --registry ${NPM_REGISTRY}`);
}

async function ensureVersionIsUnpublished(): Promise<void> {
  const specification = `${CLI_PACKAGE_NAME}@${CLI_VERSION}`;
  const result = await capture([
    "npm",
    "view",
    specification,
    "version",
    "--json",
    "--registry",
    NPM_REGISTRY,
  ]);
  if (result.exitCode === 0) throw new Error(`${specification} is already published`);
  const diagnostic = `${result.stdout}\n${result.stderr}`;
  if (!diagnostic.includes("E404") && !diagnostic.includes("404 Not Found")) {
    throw new Error(`could not check whether ${specification} is available`);
  }
}

export async function publishNPM(arguments_: ReleaseArguments): Promise<void> {
  requireBunVersion();
  await validateReleaseMetadata();
  const status = await capture(["git", "status", "--porcelain", "--untracked-files=all"]);
  if (status.exitCode !== 0) throw new Error("could not inspect the Git working tree");
  if (status.stdout.trim() && !arguments_.dryRun)
    throw new Error("refusing to publish from a dirty working tree");
  await run([process.execPath, "run", "check"]);
  await run([
    "npm",
    "publish",
    `--workspace=${CLI_PACKAGE_NAME}`,
    "--access=public",
    "--dry-run",
    `--registry=${NPM_REGISTRY}`,
  ]);
  if (arguments_.dryRun) return;
  await ensureAuthenticated();
  await ensureVersionIsUnpublished();
  await run([
    "npm",
    "publish",
    `--workspace=${CLI_PACKAGE_NAME}`,
    "--access=public",
    `--registry=${NPM_REGISTRY}`,
  ]);
}

if (import.meta.main) {
  try {
    const arguments_ = parseReleaseArguments(process.argv.slice(2));
    if (arguments_.help) process.stdout.write(help);
    else await publishNPM(arguments_);
  } catch (error) {
    process.stderr.write(
      `release:npm: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
