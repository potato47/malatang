import { describe, expect, test } from "bun:test";
import { renderDoctorText, runDoctor } from "../src/doctor.ts";
import { CLI_PACKAGE_NAME, CLI_VERSION } from "../src/metadata.ts";
import { commandResult, FakeDoctorProbe } from "./support.ts";

const expectedIDs = [
  "platform",
  "architecture",
  "bun",
  "codesign",
  "working-directory",
  "swift",
  "xcode",
  "notarytool",
  "stapler",
  "developer-id",
];

describe("fia doctor", () => {
  test("returns a healthy report with stable check order", async () => {
    const report = await runDoctor(new FakeDoctorProbe());

    expect(report).toMatchObject({
      schemaVersion: 1,
      cli: { name: CLI_PACKAGE_NAME, version: CLI_VERSION },
      ok: true,
    });
    expect(report.checks.map((check) => check.id)).toEqual(expectedIDs);
    expect(report.checks.every((check) => check.status === "pass")).toBe(true);
    expect(report.checks.every((check) => check.details === undefined)).toBe(true);
  });

  test("fails unsupported macOS, architecture, and Bun versions", async () => {
    const probe = new FakeDoctorProbe();
    probe.architecture = "x64";
    probe.bunVersion = "1.3.14";
    probe.setCommand(["/usr/bin/sw_vers", "-productVersion"], commandResult("13.7.1\n"));

    const report = await runDoctor(probe);

    expect(report.ok).toBe(false);
    expect(report.checks.slice(0, 3).map((check) => check.status)).toEqual([
      "fail",
      "fail",
      "fail",
    ]);
  });

  test("accepts Bun versions newer than the minimum", async () => {
    const probe = new FakeDoctorProbe();
    probe.bunVersion = "1.4.1";

    const report = await runDoctor(probe);

    expect(report.ok).toBe(true);
    expect(report.checks.find((check) => check.id === "bun")).toMatchObject({
      status: "pass",
      message: "Bun 1.4.1",
    });
  });

  test("fails when Bun is unavailable", async () => {
    const probe = new FakeDoctorProbe();
    probe.bunVersion = undefined;

    const report = await runDoctor(probe);

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === "bun")).toMatchObject({
      required: true,
      status: "fail",
    });
  });

  test("fails when codesign or the working directory is unavailable", async () => {
    const probe = new FakeDoctorProbe();
    probe.accessible.set("/usr/bin/codesign", false);
    probe.accessible.set(probe.cwd, false);

    const report = await runDoctor(probe);

    expect(report.ok).toBe(false);
    expect(
      report.checks.filter((check) => check.status === "fail").map((check) => check.id),
    ).toEqual(["codesign", "working-directory"]);
  });

  test("requires Swift and Xcode but keeps release credentials optional", async () => {
    const probe = new FakeDoctorProbe();
    for (const command of [
      ["/usr/bin/xcrun", "swift", "--version"],
      ["/usr/bin/xcodebuild", "-version"],
      ["/usr/bin/xcrun", "--find", "notarytool"],
      ["/usr/bin/xcrun", "--find", "stapler"],
      ["/usr/bin/security", "find-identity", "-v", "-p", "codesigning"],
    ]) {
      probe.setCommand(command, commandResult("", { exitCode: 1, stderr: "not available" }));
    }

    const report = await runDoctor(probe);
    const optional = report.checks.filter((check) => !check.required);

    expect(report.ok).toBe(false);
    expect(
      report.checks.filter((check) => check.status === "fail").map((check) => check.id),
    ).toEqual(["swift", "xcode"]);
    expect(optional.map((check) => check.status)).toEqual(["warn", "warn", "warn"]);
  });

  test("requires Swift 6 for application builds", async () => {
    const old = new FakeDoctorProbe();
    old.setCommand(
      ["/usr/bin/xcrun", "swift", "--version"],
      commandResult("Apple Swift version 5.10\n"),
    );
    const report = await runDoctor(old);
    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === "swift")).toMatchObject({
      required: true,
      status: "fail",
    });
    expect(report.checks.find((check) => check.id === "swift")?.message).toContain("required");
  });

  test("adds command details only in debug mode", async () => {
    const probe = new FakeDoctorProbe();
    probe.setCommand(
      ["/usr/bin/xcrun", "--find", "notarytool"],
      commandResult("", { exitCode: 1, stderr: "tool lookup failed" }),
    );

    const normal = await runDoctor(probe);
    const debug = await runDoctor(probe, { debug: true });
    const normalCheck = normal.checks.find((check) => check.id === "notarytool");
    const debugCheck = debug.checks.find((check) => check.id === "notarytool");

    expect(normalCheck?.details).toBeUndefined();
    expect(debugCheck?.details).toContain("error: tool lookup failed");
    expect(debug.ok).toBe(normal.ok);
  });

  test("renders stable text status markers", async () => {
    const probe = new FakeDoctorProbe();
    probe.bunVersion = "1.3.13";
    probe.setCommand(["/usr/bin/xcrun", "--find", "stapler"], commandResult("", { exitCode: 1 }));

    const output = renderDoctorText(await runDoctor(probe));

    expect(output).toContain("[pass] macOS: macOS 26.5.2");
    expect(output).toContain("[fail] Bun:");
    expect(output).toContain("[warn] stapler:");
    expect(output).toEndWith("Result: required checks failed\n");
  });
});
