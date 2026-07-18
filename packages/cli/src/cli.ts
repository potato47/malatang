import { renderDoctorText, runDoctor } from "./doctor.ts";
import { CLI_VERSION } from "./metadata.ts";
import { SystemDoctorProbe, type DoctorProbe } from "./system-probe.ts";

export interface CLIIO {
  stdout(value: string): void;
  stderr(value: string): void;
}

export interface CLIDependencies {
  io?: CLIIO;
  doctorProbe?: DoctorProbe;
}

const defaultIO: CLIIO = {
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
};

const rootHelp = `FIA command-line interface

Usage:
  fia [--help]
  fia [--version]
  fia [--debug] doctor [--json]

Commands:
  doctor       Check the local FIA development environment

Global options:
  -h, --help   Show help
  -V, --version
               Show the CLI version
  --debug      Include diagnostic command details
`;

const doctorHelp = `Check the local FIA development environment

Usage:
  fia [--debug] doctor [--json]

Options:
  -h, --help   Show help for doctor
  --json       Emit a machine-readable DoctorReport
  --debug      Include diagnostic command details
`;

function usageError(io: CLIIO, message: string): number {
  io.stderr(`fia: error: ${message}\nRun 'fia --help' for usage.\n`);
  return 2;
}

function debugError(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;
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
    const report = await runDoctor(dependencies.doctorProbe ?? new SystemDoctorProbe(), { debug });
    io.stdout(flags.includes("--json") ? `${JSON.stringify(report, null, 2)}\n` : renderDoctorText(report));
    return report.ok ? 0 : 1;
  } catch (error) {
    io.stderr("fia: error: doctor could not complete\n");
    if (debug) io.stderr(`${debugError(error)}\n`);
    return 1;
  }
}
