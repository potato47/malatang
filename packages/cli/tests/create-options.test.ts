import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runCLI } from "../src/cli.ts";
import {
  parseCreateArguments,
  type CreatePrompts,
  type CreateTerminal,
} from "../src/create-options.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const terminal = { stdinTTY: true, stdoutTTY: true, ci: false };
async function fixture() {
  const cwd = await mkdtemp(resolve(tmpdir(), "fia-wizard-"));
  roots.push(cwd);
  const questions: string[] = [],
    commands: string[][] = [],
    output: string[] = [];
  const prompts: CreatePrompts = {
    name: async (validate) => {
      questions.push("name");
      expect(await validate("Bad Name")).toContain("kebab-case");
      expect(await validate("existing")).toContain("target already exists");
      expect(await validate("my-app")).toBeUndefined();
      return "my-app";
    },
    template: async () => {
      questions.push("template");
      return "hybrid";
    },
    confirm: async (field, initialValue) => {
      questions.push(field);
      expect(initialValue).toBe(field === "install");
      return true;
    },
  };
  await mkdir(resolve(cwd, "existing"));
  const run = (
    args: string[],
    overrides: { createTerminal?: CreateTerminal; createPrompts?: CreatePrompts } = {},
  ) =>
    runCLI(["create", ...args], {
      workingDirectory: cwd,
      io: { stdout: (s) => output.push(s), stderr: (s) => output.push(s) },
      createTerminal: terminal,
      createPrompts: prompts,
      create: {
        runner: async (command) => {
          commands.push([...command]);
          return 0;
        },
      },
      ...overrides,
    });
  return { cwd, questions, commands, output, prompts, run };
}

test("complete wizard validates names and creates chosen project", async () => {
  const f = await fixture();
  expect(await f.run([])).toBe(0);
  expect(f.questions).toEqual(["name", "template", "backend", "initializeGit", "install"]);
  expect(f.commands).toEqual([
    [process.execPath, "install"],
    ["git", "init"],
  ]);
  expect(await Bun.file(resolve(f.cwd, "my-app/backend/index.ts")).exists()).toBe(true);
  expect(
    await Bun.file(resolve(f.cwd, "my-app/native/Sources/FIAApp/ContentView.swift")).exists(),
  ).toBe(true);
});

for (const template of ["web", "native", "hybrid"] as const) {
  for (const backend of [false, true]) {
    test(`wizard generates ${template}, backend=${backend}`, async () => {
      const f = await fixture();
      expect(
        await f.run(["my-app"], {
          createPrompts: {
            ...f.prompts,
            template: async () => template,
            confirm: async (field) => (field === "backend" ? backend : false),
          },
        }),
      ).toBe(0);
      expect(await Bun.file(resolve(f.cwd, "my-app/frontend/App.tsx")).exists()).toBe(
        template !== "native",
      );
      expect(await Bun.file(resolve(f.cwd, "my-app/backend/index.ts")).exists()).toBe(backend);
      expect(f.commands).toEqual([]);
    });
  }
}

test("explicit options skip questions; flags may precede the name", async () => {
  const f = await fixture();
  expect(
    await f.run(["--template", "native", "my-app", "--no-backend", "--no-git", "--install"]),
  ).toBe(0);
  expect(f.questions).toEqual([]);
  expect(f.commands).toEqual([[process.execPath, "install"]]);
});

test("partial options only prompt for missing choices", async () => {
  const f = await fixture();
  expect(await f.run(["my-app", "--no-install", "--git"])).toBe(0);
  expect(f.questions).toEqual(["template", "backend"]);
  expect(f.commands).toEqual([["git", "init"]]);
});

for (const mode of ["yes", "short-yes", "stdin", "stdout", "ci"]) {
  test(`${mode} uses defaults without prompts and requires a name`, async () => {
    const f = await fixture();
    const flags = mode === "yes" ? ["--yes"] : mode === "short-yes" ? ["-y"] : [];
    const createTerminal = {
      stdinTTY: mode !== "stdin",
      stdoutTTY: mode !== "stdout",
      ci: mode === "ci",
    };
    expect(await f.run(flags, { createTerminal })).toBe(2);
    expect(await f.run(["my-app", ...flags], { createTerminal })).toBe(0);
    expect(f.questions).toEqual([]);
    expect(f.commands).toEqual([[process.execPath, "install"]]);
    expect(await Bun.file(resolve(f.cwd, "my-app/frontend/App.tsx")).exists()).toBe(true);
    expect(await Bun.file(resolve(f.cwd, "my-app/backend/index.ts")).exists()).toBe(false);
  });
}

for (const step of ["name", "template", "backend", "initializeGit", "install"]) {
  test(`cancel at ${step} leaves no files or processes`, async () => {
    const f = await fixture();
    const cancelled = Symbol("cancel");
    expect(
      await f.run([], {
        createPrompts: {
          name: async () => (step === "name" ? cancelled : "my-app"),
          template: async () => (step === "template" ? cancelled : "web"),
          confirm: async (field) => (field === step ? cancelled : true),
        },
      }),
    ).toBe(130);
    expect(await readdir(f.cwd)).toEqual(["existing"]);
    expect(f.commands).toEqual([]);
    expect(f.output.join("")).toContain("cancelled");
  });
}

test("invalid explicit targets fail before questions", async () => {
  const f = await fixture();
  for (const name of ["Bad Name", "existing", "../escape", "bad--name"])
    expect(await f.run([name])).toBe(1);
  expect(f.questions).toEqual([]);
  expect(f.commands).toEqual([]);
});

test("invalid and conflicting arguments fail before prompts", async () => {
  const f = await fixture();
  for (const args of [
    ["--git", "--no-git"],
    ["--install", "--no-install"],
    ["--backend", "bun", "--no-backend"],
    ["-y", "--yes"],
    ["--template"],
    ["--backend", "node"],
    ["--template", "unknown"],
    ["--unknown"],
    ["extra-name"],
    ...["--git", "--no-git", "--install", "--no-install", "--no-backend", "--local"].map((flag) => [
      flag,
      flag,
    ]),
    ["--template", "web", "--template", "native"],
    ["--backend", "bun", "--backend", "bun"],
  ])
    expect(await f.run(["my-app", ...args])).toBe(2);
  expect(f.questions).toEqual([]);
  expect(f.commands).toEqual([]);
  expect(parseCreateArguments(["my-app", "--local", "--yes"]).local).toBe(true);
});
