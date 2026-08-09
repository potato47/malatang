import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import cliPackage from "../packages/cli/package.json";
import { CLI_PACKAGE_NAME, CLI_VERSION } from "../packages/cli/src/metadata.ts";
import { repositoryRoot, requireBunVersion } from "./shared.ts";

const NPM_REGISTRY = "https://registry.npmjs.org/";
const PACKAGE_DIRECTORY = resolve(repositoryRoot, "packages/cli");
const HOST_DIRECTORY = resolve(PACKAGE_DIRECTORY, "assets/host/darwin-arm64");

const help = `Publish @semicoder/fia from the FIA repository root

Usage:
  bun run release:npm --dry-run
  bun run release:npm

Options:
  --dry-run    Run every local check and npm's publish simulation without publishing
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

interface HostManifest {
  readonly schemaVersion: number;
  readonly cliVersion: string;
  readonly hostVersion: string;
  readonly sha256: string;
  readonly architecture: string;
  readonly minimumSystemVersion: string;
  readonly configurationSchema: number;
  readonly stdioProtocol: number;
  readonly hostCapabilities: readonly string[];
}

export function parseReleaseArguments(arguments_: readonly string[]): ReleaseArguments {
  let dryRun = false;
  let showHelp = false;
  for (const argument of arguments_) {
    if (argument === "--dry-run") {
      if (dryRun) throw new Error("--dry-run may only be specified once");
      dryRun = true;
    } else if (argument === "-h" || argument === "--help") {
      showHelp = true;
    } else {
      throw new Error(`unknown option: ${argument}`);
    }
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
  if (exitCode !== 0) {
    const rendered = command.map((part) => JSON.stringify(part)).join(" ");
    throw new Error(`command failed with status ${exitCode}: ${rendered}`);
  }
}

function releaseStep(index: number, label: string): void {
  process.stdout.write(`\n[release ${index}/5] ${label}\n`);
}

export async function validateReleaseMetadata(): Promise<void> {
  if (cliPackage.name !== CLI_PACKAGE_NAME) {
    throw new Error(
      `package name ${cliPackage.name} does not match CLI metadata ${CLI_PACKAGE_NAME}`,
    );
  }
  if (cliPackage.version !== CLI_VERSION) {
    throw new Error(
      `package version ${cliPackage.version} does not match CLI metadata ${CLI_VERSION}`,
    );
  }
  if (cliPackage.publishConfig.access !== "public") {
    throw new Error("package publishConfig.access must be public");
  }
  if (
    JSON.stringify(cliPackage.files) !==
    JSON.stringify(["bin", "dist", "templates", "assets", "README.md"])
  ) {
    throw new Error("package files must be exactly bin, dist, templates, assets, and README.md");
  }
  if (
    JSON.stringify(Object.keys(cliPackage.exports)) !== JSON.stringify(["./config", "./backend"])
  ) {
    throw new Error("package exports must contain only config and the Bun backend runtime");
  }

  const manifestPath = resolve(HOST_DIRECTORY, "manifest.json");
  const hostPath = resolve(HOST_DIRECTORY, "FIAHost");
  let manifest: HostManifest;
  try {
    manifest = (await Bun.file(manifestPath).json()) as HostManifest;
    await access(hostPath, constants.R_OK | constants.X_OK);
  } catch (error) {
    throw new Error("the release Host asset or manifest is missing", { cause: error });
  }
  if (
    manifest.schemaVersion !== 3 ||
    manifest.cliVersion !== CLI_VERSION ||
    manifest.hostVersion !== CLI_VERSION ||
    manifest.architecture !== "arm64" ||
    manifest.minimumSystemVersion !== "14.0" ||
    manifest.configurationSchema !== 7 ||
    manifest.stdioProtocol !== 2 ||
    JSON.stringify(manifest.hostCapabilities) !==
      '["application","statusItem","webviews","system","notifications","dialogs","clipboard","keychain"]'
  ) {
    throw new Error(
      `Host manifest is not release-compatible with ${CLI_PACKAGE_NAME}@${CLI_VERSION}`,
    );
  }

  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(await Bun.file(hostPath).arrayBuffer());
  if (hasher.digest("hex") !== manifest.sha256) {
    throw new Error("Host asset checksum does not match its manifest");
  }
}

async function workingTreeStatus(): Promise<string> {
  const result = await capture(["git", "status", "--porcelain", "--untracked-files=all"]);
  if (result.exitCode !== 0)
    throw new Error(`could not inspect the Git working tree\n${result.stderr.trim()}`);
  return result.stdout.trim();
}

async function ensureAuthenticated(): Promise<void> {
  const result = await capture(["npm", "whoami", "--registry", NPM_REGISTRY]);
  if (result.exitCode !== 0) {
    throw new Error(`npm authentication is required; run npm login --registry ${NPM_REGISTRY}`);
  }
  process.stdout.write(`Authenticated on npm as ${result.stdout.trim()}\n`);
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
  if (result.exitCode === 0)
    throw new Error(`${specification} is already published; bump the release version first`);
  const diagnostic = `${result.stdout}\n${result.stderr}`;
  if (!diagnostic.includes("E404") && !diagnostic.includes("404 Not Found")) {
    throw new Error(
      `could not check whether ${specification} is available\n${result.stderr.trim()}`,
    );
  }
}

export async function publishNPM(arguments_: ReleaseArguments): Promise<void> {
  requireBunVersion();

  releaseStep(1, "Validate package metadata and embedded Host");
  await validateReleaseMetadata();
  const status = await workingTreeStatus();
  if (status.length > 0) {
    if (!arguments_.dryRun) {
      throw new Error(`refusing to publish from a dirty working tree:\n${status}`);
    }
    process.stdout.write("Dry run: allowing uncommitted working tree changes.\n");
  }

  releaseStep(2, "Run the complete repository check");
  await run([process.execPath, "run", "check"]);

  releaseStep(3, "Inspect npm's exact publication payload");
  await run([
    "npm",
    "publish",
    `--workspace=${CLI_PACKAGE_NAME}`,
    "--access=public",
    "--dry-run",
    `--registry=${NPM_REGISTRY}`,
  ]);

  if (arguments_.dryRun) {
    process.stdout.write(
      `\nDry run complete: ${CLI_PACKAGE_NAME}@${CLI_VERSION} was not published.\n`,
    );
    return;
  }

  releaseStep(4, "Verify npm authentication and version availability");
  await ensureAuthenticated();
  await ensureVersionIsUnpublished();

  releaseStep(5, `Publish ${CLI_PACKAGE_NAME}@${CLI_VERSION}`);
  await run([
    "npm",
    "publish",
    `--workspace=${CLI_PACKAGE_NAME}`,
    "--access=public",
    `--registry=${NPM_REGISTRY}`,
  ]);
  process.stdout.write(`\nPublished ${CLI_PACKAGE_NAME}@${CLI_VERSION}.\n`);
}

async function main(): Promise<void> {
  const arguments_ = parseReleaseArguments(process.argv.slice(2));
  if (arguments_.help) {
    process.stdout.write(help);
    return;
  }
  await publishNPM(arguments_);
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `release:npm: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
