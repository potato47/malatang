import {
  executeApplicationCommand,
  type ApplicationCommand,
  type ApplicationCommandDependencies,
  type BrowserCompanion,
} from "./application.ts";
import { checkProject, renderCheck } from "./check.ts";
import { createProject, type CreateProjectDependencies } from "./create.ts";
import {
  CreateCancelled,
  parseCreateArguments,
  resolveCreateOptions,
  shouldPromptCreate,
  type CreatePrompts,
  type CreateTerminal,
} from "./create-options.ts";
import { describeProject } from "./describe.ts";
import { renderDoctorText, runDoctor } from "./doctor.ts";
import { generateNativeAPI } from "./generate.ts";
import { CLI_VERSION } from "./metadata.ts";
import type { UpdateChannel } from "./project-config.ts";
import { SystemDoctorProbe, type DoctorProbe } from "./system-probe.ts";

export interface CLIIO {
  stdout(value: string): void;
  stderr(value: string): void;
}

export interface CLIDependencies {
  io?: CLIIO;
  doctorProbe?: DoctorProbe;
  create?: CreateProjectDependencies;
  createPrompts?: CreatePrompts;
  createTerminal?: CreateTerminal;
  application?: ApplicationCommandDependencies;
  applicationExecutor?: typeof executeApplicationCommand;
  workingDirectory?: string;
}

const defaultIO: CLIIO = {
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
};

const rootHelp = `FIA 2.0 — Swift-first macOS application framework

Usage:
  fia create [name] [--template native|web|hybrid] [--backend bun|--no-backend] [--local] [--install|--no-install] [--git|--no-git] [-y|--yes]
  fia dev [--browser chrome|edge] [--app]
  fia run
  fia generate [--check]
  fia check [--json]
  fia test
  fia describe [--json]
  fia build
  fia release [--channel stable|beta]
  fia doctor [--json]

Global options:
  -h, --help       Show help
  -V, --version    Show the CLI version
  --debug          Include diagnostic details
`;

const commandHelp: Readonly<Record<string, string>> = {
  create: `Create a FIA 2.0 application

Usage:
  fia create [name] [--template native|web|hybrid] [--backend bun|--no-backend] [--local] [--install|--no-install] [--git|--no-git] [-y|--yes]

In an interactive terminal, prompts fill in options not supplied on the command line.
Defaults: Web (React + Vite), no Bun Backend, no Git, install dependencies.
-y, --yes skips prompts and uses defaults for unspecified options.
Non-TTY and CI environments never prompt. A name is required without prompts.
Ctrl+C cancels the wizard without creating files (exit code 130).
--local links both the JavaScript package and Swift Runtime to the source checkout
containing this CLI. Build the CLI with bun run cli:build before using a linked fia.
`,
  dev: `Build and launch a stable development application

Usage:
  fia dev [--browser chrome|edge] [--app]

Without options, FIA launches only the native App. With --browser it launches a
Browser Companion; add --app to show the native App at the same time.
`,
  run: "Usage:\n  fia run\n",
  generate: "Usage:\n  fia generate [--check]\n",
  check: "Usage:\n  fia check [--json]\n",
  test: "Usage:\n  fia test\n",
  describe: "Usage:\n  fia describe [--json]\n",
  build: "Usage:\n  fia build\n\nOutput: dist/<App>.app\n",
  release: "Usage:\n  fia release [--channel stable|beta]\n",
  doctor: "Usage:\n  fia doctor [--json]\n",
};

function usageError(io: CLIIO, message: string): number {
  io.stderr(`fia: error: ${message}\nRun 'fia --help' for usage.\n`);
  return 2;
}

function debugError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const current = error.stack ?? error.message;
  return error.cause === undefined ? current : `${current}\nCaused by: ${debugError(error.cause)}`;
}

function writeCommandError(
  io: CLIIO,
  error: unknown,
  fallback: string,
  options: { debug: boolean; json: boolean; method: string },
): void {
  const message = error instanceof Error ? error.message : fallback;
  if (options.json) {
    io.stderr(
      `${JSON.stringify({
        code: "invalid_request",
        component: "cli",
        method: options.method,
        message,
        recoverable: false,
        ...(options.debug ? { details: debugError(error) } : {}),
      })}\n`,
    );
    return;
  }
  io.stderr(`fia: error: ${message}\n`);
  if (options.debug) io.stderr(`${debugError(error)}\n`);
}

function repeated(flags: readonly string[], value: string): boolean {
  return flags.filter((flag) => flag === value).length > 1;
}

function optionValue(flags: readonly string[], option: string): string | undefined {
  const index = flags.indexOf(option);
  if (index < 0) return undefined;
  const value = flags[index + 1];
  if (value === undefined || value.startsWith("-")) throw new Error(`${option} requires a value`);
  return value;
}

async function execute(
  io: CLIIO,
  debug: boolean,
  fallback: string,
  operation: () => Promise<void>,
  options: { json?: boolean; method?: string } = {},
): Promise<number> {
  try {
    await operation();
    return 0;
  } catch (error) {
    writeCommandError(io, error, fallback, {
      debug,
      json: options.json ?? false,
      method: options.method ?? "execute",
    });
    return 1;
  }
}

export async function runCLI(
  args: readonly string[],
  dependencies: CLIDependencies = {},
): Promise<number> {
  const io = dependencies.io ?? defaultIO;
  const remaining = args.filter((value) => value !== "--debug");
  const debug = args.length !== remaining.length;
  const command = remaining[0];
  if (command === undefined || command === "-h" || command === "--help") {
    if (remaining.length > 1) return usageError(io, "--help does not accept arguments");
    io.stdout(rootHelp);
    return 0;
  }
  if (command === "-V" || command === "--version") {
    if (remaining.length !== 1) return usageError(io, "--version does not accept arguments");
    io.stdout(`fia ${CLI_VERSION}\n`);
    return 0;
  }
  if (!(command in commandHelp)) return usageError(io, `unknown command: ${command}`);
  const flags = remaining.slice(1);
  if (flags.includes("-h") || flags.includes("--help")) {
    if (flags.length !== 1)
      return usageError(io, `${command} --help does not accept other options`);
    io.stdout(commandHelp[command]!);
    return 0;
  }
  const cwd = dependencies.workingDirectory ?? process.cwd();

  if (command === "create") {
    let parsed;
    try {
      parsed = parseCreateArguments(flags);
    } catch (error) {
      return usageError(io, error instanceof Error ? error.message : "invalid create option");
    }
    const interactive = shouldPromptCreate(
      parsed,
      dependencies.createTerminal ?? {
        stdinTTY: Boolean(process.stdin.isTTY),
        stdoutTTY: Boolean(process.stdout.isTTY),
        ci: Boolean(process.env.CI && process.env.CI !== "false" && process.env.CI !== "0"),
      },
    );
    if (!interactive && parsed.name === undefined)
      return usageError(io, "create requires a project name");
    let options;
    try {
      options = await resolveCreateOptions(parsed, cwd, interactive, dependencies.createPrompts);
    } catch (error) {
      if (error instanceof CreateCancelled) {
        io.stdout("Project creation cancelled.\n");
        return 130;
      }
      writeCommandError(io, error, "invalid project target", {
        debug,
        json: false,
        method: "create",
      });
      return 1;
    }
    return await execute(io, debug, "project creation failed", async () => {
      await createProject({ ...options, cwd, io, dependencies: dependencies.create });
    });
  }

  if (command === "generate") {
    const unknown = flags.find((flag) => flag !== "--check");
    if (unknown !== undefined) return usageError(io, `unknown generate option: ${unknown}`);
    if (repeated(flags, "--check"))
      return usageError(io, "generate --check may only be specified once");
    return await execute(io, debug, "generation failed", async () => {
      const result = await generateNativeAPI({ cwd, check: flags.includes("--check") });
      if (flags.includes("--check") && result.changed.length > 0) {
        throw new Error(`generated files are stale: ${result.changed.join(", ")}`);
      }
      io.stdout(
        flags.includes("--check")
          ? "Generated Native API is current.\n"
          : `${result.outputs.join("\n")}\n`,
      );
    });
  }

  if (command === "check") {
    const unknown = flags.find((flag) => flag !== "--json");
    if (unknown !== undefined) return usageError(io, `unknown check option: ${unknown}`);
    const report = await checkProject(cwd);
    io.stdout(
      flags.includes("--json") ? `${JSON.stringify(report, null, 2)}\n` : renderCheck(report),
    );
    return report.ok ? 0 : 1;
  }

  if (command === "describe") {
    const unknown = flags.find((flag) => flag !== "--json");
    if (unknown !== undefined) return usageError(io, `unknown describe option: ${unknown}`);
    return await execute(
      io,
      debug,
      "description failed",
      async () => {
        const description = await describeProject(cwd);
        io.stdout(`${JSON.stringify(description, null, 2)}\n`);
      },
      { json: flags.includes("--json"), method: "describe" },
    );
  }

  if (command === "doctor") {
    const unknown = flags.find((flag) => flag !== "--json");
    if (unknown !== undefined) return usageError(io, `unknown doctor option: ${unknown}`);
    try {
      const report = await runDoctor(dependencies.doctorProbe ?? new SystemDoctorProbe(), {
        debug,
      });
      io.stdout(
        flags.includes("--json")
          ? `${JSON.stringify(report, null, 2)}\n`
          : renderDoctorText(report),
      );
      return report.ok ? 0 : 1;
    } catch (error) {
      writeCommandError(io, error, "doctor could not complete", {
        debug,
        json: flags.includes("--json"),
        method: "doctor",
      });
      return 1;
    }
  }

  const applicationCommand = command as ApplicationCommand;
  let browser: BrowserCompanion | undefined;
  let app: boolean | undefined;
  let channel: UpdateChannel | undefined;
  if (command === "dev") {
    if (repeated(flags, "--browser"))
      return usageError(io, "dev --browser may only be specified once");
    if (repeated(flags, "--app")) return usageError(io, "dev --app may only be specified once");
    const browserValue = (() => {
      try {
        return optionValue(flags, "--browser");
      } catch {
        return "__missing__";
      }
    })();
    if (browserValue === "__missing__") return usageError(io, "--browser requires a value");
    if (browserValue !== undefined && browserValue !== "chrome" && browserValue !== "edge") {
      return usageError(io, `unsupported browser: ${browserValue}`);
    }
    browser = browserValue as BrowserCompanion | undefined;
    app = flags.includes("--app") ? true : undefined;
    const consumed = new Set<number>();
    for (let index = 0; index < flags.length; index += 1) {
      if (flags[index] === "--browser") {
        consumed.add(index);
        consumed.add(index + 1);
      } else if (flags[index] === "--app") consumed.add(index);
    }
    const unknownIndex = flags.findIndex((_flag, index) => !consumed.has(index));
    if (unknownIndex >= 0) return usageError(io, `unknown dev option: ${flags[unknownIndex]}`);
  } else if (command === "release") {
    let value: string | undefined;
    try {
      value = optionValue(flags, "--channel");
    } catch (error) {
      return usageError(io, error instanceof Error ? error.message : "invalid channel");
    }
    if (value !== undefined && value !== "stable" && value !== "beta") {
      return usageError(io, `invalid release channel: ${value}`);
    }
    channel = value as UpdateChannel | undefined;
    if (flags.length !== (value === undefined ? 0 : 2))
      return usageError(io, `unknown release option: ${flags[0]}`);
  } else if (flags.length > 0) {
    return usageError(io, `unknown ${command} option: ${flags[0]}`);
  }
  return await execute(io, debug, `${command} failed`, async () => {
    await (dependencies.applicationExecutor ?? executeApplicationCommand)({
      command: applicationCommand,
      cwd,
      debug,
      io,
      ...(browser === undefined ? {} : { browser }),
      ...(app === undefined ? {} : { app }),
      ...(channel === undefined ? {} : { channel }),
      dependencies: dependencies.application,
    });
  });
}
