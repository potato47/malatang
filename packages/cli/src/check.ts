import { generateNativeAPI } from "./generate.ts";
import { loadProjectConfig } from "./project-config.ts";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CLI_VERSION } from "./metadata.ts";

export interface CheckIO {
  stdout(value: string): void;
  stderr(value: string): void;
}

export interface CheckResult {
  readonly schemaVersion: 1;
  readonly frameworkVersion: string;
  readonly ok: boolean;
  readonly checks: readonly {
    readonly id: string;
    readonly status: "pass" | "fail";
    readonly message: string;
  }[];
}

export async function checkProject(cwd: string): Promise<CheckResult> {
  const checks: Array<CheckResult["checks"][number]> = [];
  try {
    await loadProjectConfig(cwd);
    checks.push({ id: "config", status: "pass", message: "fia.toml schema 2 is valid" });
  } catch (error) {
    checks.push({
      id: "config",
      status: "fail",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  try {
    const manifest = await readFile(resolve(cwd, "native/Package.swift"), "utf8");
    if (
      !manifest.includes('name: "FIAAppExecutable"') ||
      !manifest.includes(`exact: "${CLI_VERSION}"`) ||
      !manifest.includes(".macOS(.v14)") ||
      !manifest.includes("swiftLanguageModes: [.v6]")
    ) {
      throw new Error(
        `native/Package.swift must build FIAAppExecutable for macOS 14 with Swift 6 and pin FIA ${CLI_VERSION}`,
      );
    }
    checks.push({
      id: "native-package",
      status: "pass",
      message: `FIAAppExecutable uses macOS 14, Swift 6, and FIA ${CLI_VERSION}`,
    });
  } catch (error) {
    checks.push({
      id: "native-package",
      status: "fail",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  try {
    const generated = await generateNativeAPI({ cwd, check: true });
    if (generated.changed.length === 0) {
      checks.push({ id: "generated", status: "pass", message: "generated Native API is current" });
    } else {
      checks.push({
        id: "generated",
        status: "fail",
        message: `generated files are stale: ${generated.changed.join(", ")}`,
      });
    }
  } catch (error) {
    checks.push({
      id: "generated",
      status: "fail",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  return {
    schemaVersion: 1,
    frameworkVersion: CLI_VERSION,
    ok: checks.every((check) => check.status === "pass"),
    checks,
  };
}

export function renderCheck(result: CheckResult): string {
  return `${result.checks.map((check) => `[${check.status}] ${check.id}: ${check.message}`).join("\n")}\n${result.ok ? "Result: ready" : "Result: checks failed"}\n`;
}
