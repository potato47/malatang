import { describe, expect, test } from "bun:test";
import { runCLI, type CLIIO } from "../src/cli.ts";
import { FakeDoctorProbe } from "./support.ts";

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
    expect(output.stderr).toEqual([]);
  });

  test("shows help and version", async () => {
    const help = capture();
    const version = capture();

    expect(await runCLI(["--help"], { io: help.io })).toBe(0);
    expect(await runCLI(["--version"], { io: version.io })).toBe(0);
    expect(help.stdout.join("")).toContain("FIA command-line interface");
    expect(version.stdout.join("")).toBe("fia 0.1.0\n");
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
