import { CLI_PACKAGE_NAME, CLI_VERSION, MINIMUM_MACOS_MAJOR_VERSION } from "./metadata.ts";
import { isBunVersionSupported, MINIMUM_BUN_VERSION } from "./bun-version.ts";
import { ACCESS_MODE, type CommandResult, type DoctorProbe } from "./system-probe.ts";

export type DoctorStatus = "pass" | "warn" | "fail";

export interface DoctorCheckResult {
  id: string;
  label: string;
  status: DoctorStatus;
  required: boolean;
  message: string;
  details?: string[];
}

export interface DoctorReport {
  schemaVersion: 1;
  cli: {
    name: typeof CLI_PACKAGE_NAME;
    version: string;
  };
  ok: boolean;
  checks: DoctorCheckResult[];
}

export interface DoctorOptions {
  debug?: boolean;
}

interface CheckContext {
  probe: DoctorProbe;
  debug: boolean;
}

function firstLine(value: string): string | undefined {
  const line = value.split(/\r?\n/, 1)[0]?.trim();
  return line === undefined || line.length === 0 ? undefined : line;
}

function commandDetails(command: readonly string[], result: CommandResult): string[] {
  const details = [`command: ${command.join(" ")}`, `exit code: ${result.exitCode}`];
  if (result.timedOut) details.push("timed out after 5000 ms");
  const stderr = result.error ?? firstLine(result.stderr);
  if (stderr !== undefined) details.push(`error: ${stderr}`);
  return details;
}

function result(
  id: string,
  label: string,
  required: boolean,
  status: DoctorStatus,
  message: string,
  details?: string[],
): DoctorCheckResult {
  return details === undefined || details.length === 0
    ? { id, label, required, status, message }
    : { id, label, required, status, message, details };
}

function failureStatus(required: boolean): DoctorStatus {
  return required ? "fail" : "warn";
}

async function platformCheck({ probe, debug }: CheckContext): Promise<DoctorCheckResult> {
  const required = true;
  const label = "macOS";
  if (probe.platform !== "darwin") {
    return result(
      "platform",
      label,
      required,
      "fail",
      `FIA requires macOS; found ${probe.platform}`,
      debug ? [`process.platform: ${probe.platform}`] : undefined,
    );
  }

  const command = ["/usr/bin/sw_vers", "-productVersion"] as const;
  const commandResult = await probe.run(command);
  const version = firstLine(commandResult.stdout);
  const major =
    version === undefined ? Number.NaN : Number.parseInt(version.split(".")[0] ?? "", 10);
  if (commandResult.exitCode !== 0 || commandResult.timedOut || !Number.isFinite(major)) {
    return result(
      "platform",
      label,
      required,
      "fail",
      "Could not determine the macOS version",
      debug ? commandDetails(command, commandResult) : undefined,
    );
  }
  if (major < MINIMUM_MACOS_MAJOR_VERSION) {
    return result(
      "platform",
      label,
      required,
      "fail",
      `macOS ${version} is unsupported; FIA requires macOS ${MINIMUM_MACOS_MAJOR_VERSION} or newer`,
    );
  }
  return result("platform", label, required, "pass", `macOS ${version}`);
}

async function architectureCheck({ probe, debug }: CheckContext): Promise<DoctorCheckResult> {
  const supported = probe.architecture === "arm64";
  return result(
    "architecture",
    "Architecture",
    true,
    supported ? "pass" : "fail",
    supported ? "Apple Silicon (arm64)" : `FIA requires arm64; found ${probe.architecture}`,
    debug ? [`process.arch: ${probe.architecture}`] : undefined,
  );
}

async function bunCheck({ probe, debug }: CheckContext): Promise<DoctorCheckResult> {
  if (probe.bunVersion === undefined) {
    return result("bun", "Bun", true, "fail", `Bun ${MINIMUM_BUN_VERSION} or newer is required`);
  }
  const supported = isBunVersionSupported(probe.bunVersion);
  return result(
    "bun",
    "Bun",
    true,
    supported ? "pass" : "fail",
    supported
      ? `Bun ${probe.bunVersion}`
      : `Bun ${probe.bunVersion} is unsupported; FIA requires ${MINIMUM_BUN_VERSION} or newer`,
    debug ? [`Bun.version: ${probe.bunVersion}`] : undefined,
  );
}

async function codesignCheck({ probe, debug }: CheckContext): Promise<DoctorCheckResult> {
  const path = "/usr/bin/codesign";
  const available = await probe.canAccess(path, ACCESS_MODE.executable);
  return result(
    "codesign",
    "Code signing",
    true,
    available ? "pass" : "fail",
    available ? `codesign is available at ${path}` : `Required tool is not executable: ${path}`,
    debug ? [`path: ${path}`] : undefined,
  );
}

async function workingDirectoryCheck({ probe, debug }: CheckContext): Promise<DoctorCheckResult> {
  const available = await probe.canAccess(probe.cwd, ACCESS_MODE.readableAndWritable);
  return result(
    "working-directory",
    "Working directory",
    true,
    available ? "pass" : "fail",
    available
      ? "Current directory is readable and writable"
      : "Current directory must be readable and writable",
    debug ? [`path: ${probe.cwd}`] : undefined,
  );
}

async function optionalCommandCheck(
  context: CheckContext,
  id: string,
  label: string,
  command: readonly string[],
  availableMessage: (commandResult: CommandResult) => string,
  required = false,
): Promise<DoctorCheckResult> {
  const commandResult = await context.probe.run(command);
  const available = commandResult.exitCode === 0 && !commandResult.timedOut;
  return result(
    id,
    label,
    required,
    available ? "pass" : failureStatus(required),
    available
      ? availableMessage(commandResult)
      : `${label} is not available${required ? "" : " (optional)"}`,
    context.debug ? commandDetails(command, commandResult) : undefined,
  );
}

async function swiftCheck(context: CheckContext): Promise<DoctorCheckResult> {
  const command = ["/usr/bin/xcrun", "swift", "--version"] as const;
  const commandResult = await context.probe.run(command);
  const line = firstLine(commandResult.stdout);
  const major = Number.parseInt(line?.match(/Swift version\s+(\d+)/i)?.[1] ?? "", 10);
  const available =
    commandResult.exitCode === 0 && !commandResult.timedOut && Number.isFinite(major);
  const supported = available && major >= 6;
  return result(
    "swift",
    "Swift",
    true,
    supported ? "pass" : "fail",
    supported
      ? (line ?? "Swift 6 is available")
      : available
        ? `Swift ${major} is unsupported; Swift 6 or newer is required`
        : "Swift 6 is required to build FIA applications",
    context.debug ? commandDetails(command, commandResult) : undefined,
  );
}

async function xcodeCheck(context: CheckContext): Promise<DoctorCheckResult> {
  return await optionalCommandCheck(
    context,
    "xcode",
    "Xcode",
    ["/usr/bin/xcodebuild", "-version"],
    (commandResult) => firstLine(commandResult.stdout) ?? "Xcode is available",
    true,
  );
}

async function toolCheck(
  context: CheckContext,
  id: "notarytool" | "stapler",
  label: string,
): Promise<DoctorCheckResult> {
  return await optionalCommandCheck(
    context,
    id,
    label,
    ["/usr/bin/xcrun", "--find", id],
    (commandResult) =>
      `${label} is available at ${firstLine(commandResult.stdout) ?? "the active toolchain"}`,
  );
}

async function developerIDCheck(context: CheckContext): Promise<DoctorCheckResult> {
  const command = ["/usr/bin/security", "find-identity", "-v", "-p", "codesigning"] as const;
  const commandResult = await context.probe.run(command);
  const identities = commandResult.stdout.match(/Developer ID Application:/g)?.length ?? 0;
  const available = commandResult.exitCode === 0 && !commandResult.timedOut && identities > 0;
  return result(
    "developer-id",
    "Developer ID",
    false,
    available ? "pass" : "warn",
    available
      ? `${identities} Developer ID Application ${identities === 1 ? "identity" : "identities"} available`
      : "No Developer ID Application identity found (optional)",
    context.debug ? commandDetails(command, commandResult) : undefined,
  );
}

export async function runDoctor(
  probe: DoctorProbe,
  options: DoctorOptions = {},
): Promise<DoctorReport> {
  const context = { probe, debug: options.debug === true };
  const checks: DoctorCheckResult[] = [];
  for (const check of [
    platformCheck,
    architectureCheck,
    bunCheck,
    codesignCheck,
    workingDirectoryCheck,
    swiftCheck,
    xcodeCheck,
  ]) {
    checks.push(await check(context));
  }
  checks.push(await toolCheck(context, "notarytool", "notarytool"));
  checks.push(await toolCheck(context, "stapler", "stapler"));
  checks.push(await developerIDCheck(context));

  return {
    schemaVersion: 1,
    cli: { name: CLI_PACKAGE_NAME, version: CLI_VERSION },
    ok: checks.every((check) => check.status !== "fail"),
    checks,
  };
}

export function renderDoctorText(report: DoctorReport): string {
  const lines = [`FIA Doctor (fia ${report.cli.version})`];
  for (const check of report.checks) {
    lines.push(`[${check.status}] ${check.label}: ${check.message}`);
    for (const detail of check.details ?? []) lines.push(`        ${detail}`);
  }
  lines.push(report.ok ? "Result: ready" : "Result: required checks failed");
  return `${lines.join("\n")}\n`;
}
