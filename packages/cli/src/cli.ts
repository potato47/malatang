import { renderDoctorText, runDoctor } from "./doctor.ts";
import { createProject, type CreateProjectDependencies } from "./create.ts";
import { CLI_VERSION } from "./metadata.ts";
import { SystemDoctorProbe, type DoctorProbe } from "./system-probe.ts";
import { loadProjectConfig } from "./project-config.ts";
import {
  executeApplicationCommand,
  type ApplicationCommand,
  type ApplicationCommandDependencies,
} from "./application.ts";

export interface CLIIO {
  stdout(value: string): void;
  stderr(value: string): void;
}

export interface CLIDependencies {
  io?: CLIIO;
  doctorProbe?: DoctorProbe;
  create?: CreateProjectDependencies;
  application?: ApplicationCommandDependencies;
  workingDirectory?: string;
}

const defaultIO: CLIIO = {
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
};

const rootHelp = `FIA command-line interface

Usage:
  fia [--help]
  fia [--version]
  fia [--debug] create <name> [--runtime <bun|swift>] [--no-install] [--git]
  fia [--debug] dev
  fia [--debug] build
  fia [--debug] run
  fia [--debug] doctor [--json]

Commands:
  create       Create a React FIA project with a Bun or Swift backend
  dev          Launch the application with React HMR
  build        Build and ad-hoc sign a production .app
  run          Build and launch the current source in production mode
  doctor       Check the local FIA development environment

Global options:
  -h, --help   Show help
  -V, --version
               Show the CLI version
  --debug      Include diagnostic command details
`;

const createHelp = `Create a React FIA project with a Bun or Swift backend

Usage:
  fia [--debug] create <name> [--runtime <bun|swift>] [--no-install] [--git]

Options:
  -h, --help   Show help for create
  --no-install Generate files without running bun install
  --git        Initialize a Git repository
  --runtime    Select the application backend (default: bun)
  --debug      Include diagnostic error details
`;

const doctorHelp = `Check the local FIA development environment

Usage:
  fia [--debug] doctor [--json]

Options:
  -h, --help   Show help for doctor
  --json       Emit a machine-readable DoctorReport
  --debug      Include diagnostic command details
`;

const applicationHelp: Record<ApplicationCommand, string> = {
  dev: `Launch the FIA application with hot module replacement

Usage:
  fia [--debug] dev

Options:
  -h, --help   Show help for dev
  --debug      Include diagnostic command details
`,
  build: `Build and ad-hoc sign a production FIA application

Usage:
  fia [--debug] build

Output:
  dist/<application name>.app

Options:
  -h, --help   Show help for build
  --debug      Include diagnostic command details
`,
  run: `Build and launch the current source using the production protocol

Usage:
  fia [--debug] run

Options:
  -h, --help   Show help for run
  --debug      Include diagnostic command details
`,
};

function usageError(io: CLIIO, message: string): number {
  io.stderr(`fia: error: ${message}\nRun 'fia --help' for usage.\n`);
  return 2;
}

function debugError(error: unknown): string {
  if (error instanceof Error) {
    const description = error.stack ?? error.message;
    return error.cause === undefined ? description : `${description}\nCaused by: ${debugError(error.cause)}`;
  }
  return String(error);
}

export async function runCLI(args: readonly string[], dependencies: CLIDependencies = {}): Promise<number> {
  const io = dependencies.io ?? defaultIO;
  const remaining = [...args];
  const debug = remaining.includes("--debug");
  for (let index = remaining.length - 1; index >= 0; index -= 1) {
    if (remaining[index] === "--debug") remaining.splice(index, 1);
  }

  if (remaining.length === 0) {
    io.stdout(rootHelp);
    return 0;
  }

  const command = remaining[0];
  if (command === "-h" || command === "--help") {
    if (remaining.length !== 1) return usageError(io, "--help does not accept arguments");
    io.stdout(rootHelp);
    return 0;
  }
  if (command === "-V" || command === "--version") {
    if (remaining.length !== 1) return usageError(io, "--version does not accept arguments");
    io.stdout(`fia ${CLI_VERSION}\n`);
    return 0;
  }
  if (command === "create") {
    const createArguments = remaining.slice(1);
    if (createArguments.includes("-h") || createArguments.includes("--help")) {
      if (createArguments.length !== 1) return usageError(io, "create --help does not accept other arguments");
      io.stdout(createHelp);
      return 0;
    }
    const name = createArguments[0];
    if (name === undefined || name.startsWith("-")) return usageError(io, "create requires a project name");
    const flags = createArguments.slice(1);
    let runtime: "bun" | "swift" = "bun";
    const runtimeIndex = flags.indexOf("--runtime");
    if (runtimeIndex >= 0) {
      const value = flags[runtimeIndex + 1];
      if (value !== "bun" && value !== "swift") return usageError(io, "create --runtime expects bun or swift");
      runtime = value;
      flags.splice(runtimeIndex, 2);
    }
    const unknown = flags.find((flag) => flag !== "--no-install" && flag !== "--git");
    if (unknown !== undefined) return usageError(io, `unknown create option: ${unknown}`);
    for (const flag of ["--no-install", "--git"] as const) {
      if (flags.filter((value) => value === flag).length > 1) {
        return usageError(io, `create ${flag} may only be specified once`);
      }
    }

    try {
      await createProject({
        name,
        cwd: dependencies.workingDirectory ?? process.cwd(),
        runtime,
        install: !flags.includes("--no-install"),
        initializeGit: flags.includes("--git"),
        io,
        dependencies: dependencies.create,
      });
      return 0;
    } catch (error) {
      io.stderr(`fia: error: ${error instanceof Error ? error.message : "project creation failed"}\n`);
      if (debug) io.stderr(`${debugError(error)}\n`);
      return 1;
    }
  }
  if (command === "dev" || command === "build" || command === "run") {
    const flags = remaining.slice(1);
    if (flags.includes("-h") || flags.includes("--help")) {
      if (flags.length !== 1) return usageError(io, `${command} --help does not accept other options`);
      io.stdout(applicationHelp[command]);
      return 0;
    }
    if (flags.length > 0) return usageError(io, `unknown ${command} option: ${flags[0]}`);
    try {
      await executeApplicationCommand({
        command,
        cwd: dependencies.workingDirectory ?? process.cwd(),
        debug,
        io,
        dependencies: dependencies.application,
      });
      return 0;
    } catch (error) {
      io.stderr(`fia: error: ${error instanceof Error ? error.message : `${command} failed`}\n`);
      if (debug) io.stderr(`${debugError(error)}\n`);
      return 1;
    }
  }
  if (command !== "doctor") return usageError(io, `unknown command: ${command}`);

  const flags = remaining.slice(1);
  if (flags.includes("-h") || flags.includes("--help")) {
    if (flags.length !== 1) return usageError(io, "doctor --help does not accept other options");
    io.stdout(doctorHelp);
    return 0;
  }
  const unknown = flags.find((flag) => flag !== "--json");
  if (unknown !== undefined) return usageError(io, `unknown doctor option: ${unknown}`);
  if (flags.filter((flag) => flag === "--json").length > 1) {
    return usageError(io, "doctor --json may only be specified once");
  }

  try {
    const probe = dependencies.doctorProbe ?? new SystemDoctorProbe();
    let requiresSwift = false;
    try {
      const config = await loadProjectConfig(dependencies.workingDirectory ?? probe.cwd);
      requiresSwift = config.runtime === "swift";
    } catch {
      // Doctor remains usable outside an FIA project and reports generic environment health.
    }
    const report = await runDoctor(probe, { debug, requiresSwift });
    io.stdout(flags.includes("--json") ? `${JSON.stringify(report, null, 2)}\n` : renderDoctorText(report));
    return report.ok ? 0 : 1;
  } catch (error) {
    io.stderr("fia: error: doctor could not complete\n");
    if (debug) io.stderr(`${debugError(error)}\n`);
    return 1;
  }
}
