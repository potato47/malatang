import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runCLI, type CLIIO } from "../src/cli.ts";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);
function capture(): { io: CLIIO; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [],
    stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: { stdout: (value) => stdout.push(value), stderr: (value) => stderr.push(value) },
  };
}

describe("FIA 2.0 CLI", () => {
  test("advertises the replacement command set", async () => {
    const output = capture();
    expect(await runCLI([], { io: output.io })).toBe(0);
    for (const command of [
      "create",
      "dev",
      "run",
      "generate",
      "check",
      "test",
      "describe",
      "build",
      "release",
      "doctor",
    ]) {
      expect(output.stdout.join("")).toContain(command);
    }
    expect(output.stdout.join("")).not.toContain("fia package");
  });

  test("creates Web/no-Bun by default", async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), "fia-cli-v2-"));
    roots.push(cwd);
    const output = capture();
    expect(
      await runCLI(["create", "default-app", "--no-install"], {
        io: output.io,
        workingDirectory: cwd,
      }),
    ).toBe(0);
    expect(await Bun.file(resolve(cwd, "default-app/frontend/App.tsx")).exists()).toBe(true);
    expect(await Bun.file(resolve(cwd, "default-app/backend/index.ts")).exists()).toBe(false);
  });

  test("routes Browser Companion and release channel options", async () => {
    const calls: unknown[] = [];
    const output = capture();
    const executor = async (options: unknown): Promise<void> => {
      calls.push(options);
    };
    expect(
      await runCLI(["dev", "--browser", "chrome", "--app"], {
        io: output.io,
        applicationExecutor: executor as never,
      }),
    ).toBe(0);
    expect(
      await runCLI(["release", "--channel", "beta"], {
        io: output.io,
        applicationExecutor: executor as never,
      }),
    ).toBe(0);
    expect(calls).toMatchObject([
      { command: "dev", browser: "chrome", app: true },
      { command: "release", channel: "beta" },
    ]);
  });

  test("rejects removed and unsupported options", async () => {
    for (const args of [
      ["package"],
      ["create", "bad", "--backend", "node"],
      ["dev", "--browser", "safari"],
      ["dev", "chrome"],
      ["dev", "--browser", "chrome", "--browser", "edge"],
      ["dev", "--app", "--app"],
    ]) {
      const output = capture();
      expect(await runCLI(args, { io: output.io })).toBe(2);
    }
  });

  test("keeps command failures machine-readable in JSON mode", async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), "fia-cli-json-v2-"));
    roots.push(cwd);
    const output = capture();
    expect(await runCLI(["describe", "--json"], { io: output.io, workingDirectory: cwd })).toBe(1);
    expect(JSON.parse(output.stderr.join(""))).toMatchObject({
      code: "invalid_request",
      component: "cli",
      method: "describe",
      recoverable: false,
    });
  });
});
