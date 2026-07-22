import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runCLI, type CLIIO } from "../src/cli.ts";
import { CLI_VERSION } from "../src/metadata.ts";
import { FakeDoctorProbe } from "./support.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function capture(): { io: CLIIO; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value),
    },
  };
}

describe("fia command routing", () => {
  test("shows root help with no arguments", async () => {
    const output = capture();

    expect(await runCLI([], { io: output.io })).toBe(0);
    expect(output.stdout.join("")).toContain("Usage:");
    expect(output.stdout.join("")).toContain("doctor");
    expect(output.stdout.join("")).toContain("dev");
    expect(output.stdout.join("")).toContain("build");
    expect(output.stdout.join("")).toContain("run");
    expect(output.stderr).toEqual([]);
  });

  test("shows help and version", async () => {
    const help = capture();
    const version = capture();

    expect(await runCLI(["--help"], { io: help.io })).toBe(0);
    expect(await runCLI(["--version"], { io: version.io })).toBe(0);
    expect(help.stdout.join("")).toContain("FIA command-line interface");
    expect(version.stdout.join("")).toBe(`fia ${CLI_VERSION}\n`);
  });

  test("renders doctor text and JSON without stderr noise", async () => {
    const text = capture();
    const json = capture();

    expect(await runCLI(["doctor"], { io: text.io, doctorProbe: new FakeDoctorProbe() })).toBe(0);
    expect(await runCLI(["doctor", "--json"], {
      io: json.io,
      doctorProbe: new FakeDoctorProbe(),
    })).toBe(0);

    expect(text.stdout.join("")).toContain("[pass] macOS:");
    const report = JSON.parse(json.stdout.join("")) as Record<string, unknown>;
    expect(report).toMatchObject({ schemaVersion: 1, ok: true });
    expect(text.stderr).toEqual([]);
    expect(json.stderr).toEqual([]);
  });

  test("accepts debug before or after doctor", async () => {
    for (const args of [["--debug", "doctor", "--json"], ["doctor", "--debug", "--json"]]) {
      const output = capture();
      expect(await runCLI(args, { io: output.io, doctorProbe: new FakeDoctorProbe() })).toBe(0);
      const report = JSON.parse(output.stdout.join("")) as { checks: Array<{ details?: string[] }> };
      expect(report.checks.some((check) => check.details !== undefined)).toBe(true);
    }
  });

  test("routes create help and a no-install project", async () => {
    const help = capture();
    expect(await runCLI(["create", "--help"], { io: help.io })).toBe(0);
    expect(help.stdout.join("")).toContain("create <name>");

    const cwd = await mkdtemp(resolve(tmpdir(), "fia-cli-create-"));
    temporaryDirectories.push(cwd);
    const created = capture();
    expect(await runCLI(["create", "from-cli", "--no-install"], {
      io: created.io,
      workingDirectory: cwd,
      create: { cliPackageSpec: "file:../cli" },
    })).toBe(0);
    expect(await Bun.file(resolve(cwd, "from-cli/package.json")).exists()).toBe(true);
    expect(created.stderr).toEqual([]);
  });

  test("rejects duplicate and unknown create options", async () => {
    for (const args of [
      ["create", "hello", "--no-install", "--no-install"],
      ["create", "hello", "--git", "--git"],
      ["create", "hello", "--force"],
      ["create", "hello", "--runtime", "node"],
    ]) {
      const result = capture();
      expect(await runCLI(args, { io: result.io })).toBe(2);
      expect(result.stderr.join("")).toContain("fia: error:");
    }
  });

  test("shows application command help and rejects options", async () => {
    for (const command of ["dev", "build", "run"] as const) {
      const help = capture();
      expect(await runCLI([command, "--help"], { io: help.io })).toBe(0);
      expect(help.stdout.join("")).toContain(`fia [--debug] ${command}`);

      const invalid = capture();
      expect(await runCLI([command, "--unknown"], { io: invalid.io })).toBe(2);
      expect(invalid.stderr.join("")).toContain(`unknown ${command} option`);
    }
  });

  test("uses exit 1 for failed required diagnostics", async () => {
    const output = capture();
    const probe = new FakeDoctorProbe();
    probe.architecture = "x64";

    expect(await runCLI(["doctor"], { io: output.io, doctorProbe: probe })).toBe(1);
    expect(output.stdout.join("")).toContain("[fail] Architecture:");
    expect(output.stderr).toEqual([]);
  });

  test("uses exit 2 and stderr for invalid usage", async () => {
    for (const args of [["create"], ["doctor", "--unknown"], ["--version", "extra"]]) {
      const output = capture();
      expect(await runCLI(args, { io: output.io })).toBe(2);
      expect(output.stdout).toEqual([]);
      expect(output.stderr.join("")).toContain("fia: error:");
    }
  });
});
