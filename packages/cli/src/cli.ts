import { runAgentCLI } from "./agent-cli.ts";
import { resolve } from "node:path";
import { intro, text as promptText, confirm, isCancel } from "@clack/prompts";
import { createProject } from "./create.ts";
import { parseCreateOptions } from "./create-options.ts";
import { loadProjectConfig } from "./project-config.ts";
import {
  buildApplication,
  packageDiskImage,
  releaseApplication,
  runApplication,
  runDevelopment,
  defaultRunner,
} from "./application.ts";
import { checkProject } from "./check.ts";
import { applicationTests } from "./validation.ts";
import { doctor } from "./doctor.ts";
import { generateIcon, parseIconArguments } from "./icon.ts";
import { requestSession } from "./session.ts";
import { smokeApplication } from "./smoke.ts";
import { generateUpdateKeys } from "./updates.ts";
import { CLI_VERSION } from "./metadata.ts";

export const help = `FIA ${CLI_VERSION} — macOS applications for humans and agents

fia create [name] [--yes] [--git|--no-git] [--install|--no-install] [--local]
fia agent <args>         Call this project's running development application
fia dev [--open-browser] Vite HMR and supervised Bun restart
fia run                  Build and run a production .app
fia build [--dmg]        Assemble an application; optionally package and test a DMG
fia release [--update]   Notarized installer or signed frontend/backend update
fia check | test         Validate configuration and TypeScript; run Bun tests
fia doctor [--target dev|release] [--json]
fia status | logs | stop [--json]
fia smoke [--json]       Check production launch and orderly shutdown
fia icon <character> [--background #RRGGBB] [--foreground #RRGGBB] [--output directory] [--force]
fia update keygen --output <directory>

Configure your app in fia.config.ts. No Swift project or mode selection is required.
`;
export async function runCLI(args: readonly string[], cwd = process.cwd()): Promise<number> {
  const [command, ...rest] = args;
  try {
    if (!command || ["--help", "-h", "help"].includes(command)) {
      process.stdout.write(help);
      return 0;
    }
    if (["--version", "-v"].includes(command)) {
      console.log(CLI_VERSION);
      return 0;
    }
    const emit = (value: unknown) =>
      console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
    if (command === "create") {
      const options = parseCreateOptions(rest);
      if (!options.yes && process.stdin.isTTY && process.stdout.isTTY) {
        intro("Create a FIA application");
        if (!options.name) {
          const name = await promptText({ message: "Project name", placeholder: "my-app" });
          if (isCancel(name)) return 130;
          options.name = name;
        }
        for (const key of ["install", "git"] as const) {
          if (rest.some((option) => option === "--" + key || option === "--no-" + key)) continue;
          const answer = await confirm({
            message: key === "install" ? "Install dependencies?" : "Initialize Git?",
            initialValue: options[key],
          });
          if (isCancel(answer)) return 130;
          options[key] = answer;
        }
      }
      emit(await createProject(options, cwd));
      return 0;
    }
    if (command === "icon") {
      emit(await generateIcon({ ...parseIconArguments(rest), cwd }));
      return 0;
    }
    if (command === "update") {
      if (rest[0] !== "keygen" || rest[1] !== "--output" || !rest[2] || rest.length !== 3)
        throw new Error("Usage: fia update keygen --output <directory>");
      emit(await generateUpdateKeys(resolve(cwd, rest[2])));
      return 0;
    }
    if (["status", "logs", "stop"].includes(command)) {
      if (rest.some((arg) => arg !== "--json")) throw new Error("Unknown option");
      emit(await requestSession(cwd, command as "status" | "logs" | "stop"));
      return 0;
    }
    if (command === "agent") {
      const config = await loadProjectConfig(cwd);
      return runAgentCLI(
        rest,
        resolve(config.projectRoot, ".fia/dev", config.app.name + ".app"),
        resolve(config.projectRoot, ".fia/dev/data", config.app.identifier),
        true,
      );
    }
    if (command === "doctor") {
      const clean = rest.filter((arg) => arg !== "--json");
      if (
        clean.length &&
        !(clean.length === 2 && clean[0] === "--target" && ["dev", "release"].includes(clean[1]!))
      )
        throw new Error("Usage: fia doctor [--target dev|release] [--json]");
      const result = await doctor(cwd, (clean[1] ?? "dev") as "dev" | "release");
      emit(result);
      return result.ok ? 0 : 1;
    }
    if (command === "check") {
      if (rest.some((arg) => arg !== "--json")) throw new Error("Unknown option");
      const result = await checkProject(cwd);
      emit(result);
      return result.ok ? 0 : 1;
    }
    if (command === "test") {
      if (rest.length) throw new Error("fia test accepts no options");
      await loadProjectConfig(cwd);
      const files = await applicationTests(cwd);
      if (!files.length) {
        emit("No application tests found");
        return 0;
      }
      const result = await defaultRunner([process.execPath, "test", ...files], { cwd });
      process.stdout.write(result.stdout);
      process.stderr.write(result.stderr);
      return result.exitCode;
    }
    if (!["dev", "run", "build", "release", "smoke"].includes(command))
      throw new Error(
        "Unknown command: " +
          command +
          ". Run fia --help; FIA 2 modes and generators have been removed.",
      );
    if (
      rest.some(
        (arg) =>
          !(command === "release" && arg === "--update") &&
          !(command === "build" && arg === "--dmg") &&
          !(command === "smoke" && arg === "--json") &&
          !(command === "dev" && arg === "--open-browser"),
      )
    )
      throw new Error("Unknown option for " + command);
    const config = await loadProjectConfig(cwd);
    switch (command) {
      case "dev":
        await runDevelopment(config, console.log, { openBrowser: rest.includes("--open-browser") });
        break;
      case "run":
        return await runApplication(config);
      case "build": {
        const built = await buildApplication(config);
        emit(rest.includes("--dmg") ? await packageDiskImage(config, built.app) : built);
        break;
      }
      case "release":
        emit(await releaseApplication(config, rest.includes("--update")));
        break;
      case "smoke":
        emit(await smokeApplication(config));
        break;
    }
    return 0;
  } catch (error) {
    console.error("fia: " + (error instanceof Error ? error.message : String(error)));
    return 1;
  }
}
