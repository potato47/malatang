import * as prompts from "@clack/prompts";
import { validateProjectTarget } from "./create.ts";
import type { ProjectTemplate } from "./project-config.ts";

export interface CreateArguments {
  name?: string;
  template?: ProjectTemplate;
  backend?: boolean;
  initializeGit?: boolean;
  install?: boolean;
  local: boolean;
  yes: boolean;
}

export interface CreateTerminal {
  stdinTTY: boolean;
  stdoutTTY: boolean;
  ci: boolean;
}

export interface CreatePrompts {
  name(validate: (value: string) => Promise<string | undefined>): Promise<string | symbol>;
  template(): Promise<ProjectTemplate | symbol>;
  confirm(
    field: "backend" | "initializeGit" | "install",
    initialValue: boolean,
  ): Promise<boolean | symbol>;
}

export class CreateCancelled extends Error {}

export const defaultCreatePrompts: CreatePrompts = {
  name: async (validate) => {
    while (true) {
      const value = await prompts.text({
        message: "Project name",
        placeholder: "my-app",
        validate: (value) => (value ? undefined : "Project name is required"),
      });
      if (prompts.isCancel(value)) return value;
      const error = await validate(value);
      if (error === undefined) return value;
      prompts.log.error(error);
    }
  },
  template: () =>
    prompts.select<ProjectTemplate>({
      message: "Choose a template",
      initialValue: "web",
      options: [
        { value: "web", label: "Web", hint: "React + Vite main window" },
        { value: "native", label: "Native", hint: "SwiftUI application" },
        { value: "hybrid", label: "Hybrid", hint: "SwiftUI and Web windows" },
      ],
    }),
  confirm: (field, initialValue) =>
    prompts.confirm({
      message: {
        backend: "Enable Bun Backend?",
        initializeGit: "Initialize a Git repository?",
        install: "Install dependencies with Bun?",
      }[field],
      initialValue,
    }),
};

export function parseCreateArguments(args: readonly string[]): CreateArguments {
  const result: CreateArguments = { local: false, yes: false };
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (!argument.startsWith("-")) {
      if (result.name !== undefined) throw new Error(`unexpected create argument: ${argument}`);
      result.name = argument;
      continue;
    }
    const option = argument === "-y" ? "--yes" : argument;
    if (
      ![
        "--template",
        "--backend",
        "--no-backend",
        "--git",
        "--no-git",
        "--install",
        "--no-install",
        "--local",
        "--yes",
      ].includes(option)
    )
      throw new Error(`unknown create option: ${argument}`);
    if (seen.has(option)) throw new Error(`create ${option} may only be specified once`);
    seen.add(option);
    if (option === "--template" || option === "--backend") {
      const value = args[++index];
      if (value === undefined || value.startsWith("-"))
        throw new Error(`${option} requires a value`);
      if (option === "--template") {
        if (value !== "web" && value !== "native" && value !== "hybrid")
          throw new Error(`invalid template: ${value}`);
        result.template = value;
      } else {
        if (value !== "bun") throw new Error(`unsupported Backend runtime: ${value}`);
        result.backend = true;
      }
    } else if (option === "--no-backend") result.backend = false;
    else if (option === "--git" || option === "--no-git") result.initializeGit = option === "--git";
    else if (option === "--install" || option === "--no-install")
      result.install = option === "--install";
    else if (option === "--local") result.local = true;
    else result.yes = true;
  }
  for (const [positive, negative] of [
    ["--backend", "--no-backend"],
    ["--git", "--no-git"],
    ["--install", "--no-install"],
  ] as const) {
    if (seen.has(positive) && seen.has(negative))
      throw new Error(`${positive} conflicts with ${negative}`);
  }
  return result;
}

export function shouldPromptCreate(args: CreateArguments, terminal: CreateTerminal): boolean {
  return !args.yes && terminal.stdinTTY && terminal.stdoutTTY && !terminal.ci;
}

function answer<T>(value: T | symbol): T {
  if (typeof value === "symbol") throw new CreateCancelled();
  return value;
}

export async function resolveCreateOptions(
  args: CreateArguments,
  cwd: string,
  interactive: boolean,
  prompt: CreatePrompts = defaultCreatePrompts,
) {
  let name = args.name;
  if (name === undefined) {
    if (!interactive) throw new Error("create requires a project name");
    name = answer(
      await prompt.name(async (value) => {
        try {
          await validateProjectTarget(value, cwd);
        } catch (error) {
          return error instanceof Error ? error.message : "Invalid project name";
        }
      }),
    );
  }
  await validateProjectTarget(name, cwd);
  const template = args.template ?? (interactive ? answer(await prompt.template()) : "web");
  const backend =
    args.backend ?? (interactive ? answer(await prompt.confirm("backend", false)) : false);
  const initializeGit =
    args.initializeGit ??
    (interactive ? answer(await prompt.confirm("initializeGit", false)) : false);
  const install =
    args.install ?? (interactive ? answer(await prompt.confirm("install", true)) : true);
  return { name, template, backend, initializeGit, install, local: args.local };
}
