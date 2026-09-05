import { generateNativeAPI } from "./generate.ts";
import { loadProjectConfig } from "./project-config.ts";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { CLI_VERSION } from "./metadata.ts";
import { validateLocalFramework } from "./local-framework.ts";

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
    let localRoot: string | undefined;
    for (const match of manifest.matchAll(
      /\.package\(\s*(?:name:\s*("(?:[^"\\]|\\.)*"),\s*)?path:\s*("(?:[^"\\]|\\.)*")\s*\)/gu,
    )) {
      const path = JSON.parse(match[2]!) as string;
      const name = match[1] === undefined ? basename(path).toLowerCase() : JSON.parse(match[1]);
      if (name === "fia") {
        localRoot = (await validateLocalFramework(resolve(cwd, "native", path))).root;
        break;
      }
    }
    if (
      !manifest.includes('name: "FIAAppExecutable"') ||
      (localRoot === undefined && !manifest.includes(`exact: "${CLI_VERSION}"`)) ||
      !manifest.includes(".macOS(.v14)") ||
      !manifest.includes("swiftLanguageModes: [.v6]")
    ) {
      throw new Error(
        `native/Package.swift must build FIAAppExecutable for macOS 14 with Swift 6 and pin FIA ${CLI_VERSION} or reference a valid local FIA checkout`,
      );
    }
    checks.push({
      id: "native-package",
      status: "pass",
      message: `FIAAppExecutable uses macOS 14, Swift 6, and ${localRoot === undefined ? `FIA ${CLI_VERSION}` : `local FIA at ${localRoot}`}`,
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
