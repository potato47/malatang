import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import cliPackage from "../package.json";
import { createProject } from "../src/create.ts";
import { parseCreateOptions } from "../src/create-options.ts";
import { loadProjectConfig, validateConfig } from "../src/project-config.ts";
import { verifyAssets, releaseFiles, hash, type CodeRelease } from "../src/artifacts.ts";
import { generateUpdateKeys, signRelease, verifyRelease } from "../src/updates.ts";
import { parseIconArguments } from "../src/icon.ts";
import { generateAgentArtifacts } from "../src/agent-artifacts.ts";

test("skill generation uses only the contract and produces standalone checked types", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "fia-skill-"));
  try {
    await mkdir(resolve(root, "shared"));
    await mkdir(resolve(root, "backend"));
    await writeFile(
      resolve(root, "backend/index.ts"),
      'throw new Error("Backend must not load when documenting the API")',
    );
    await writeFile(
      resolve(root, "shared/api.ts"),
      `import { defineAPI, z } from ${JSON.stringify(resolve(import.meta.dir, "../src/business-api.ts"))};
export default defineAPI({ methods: {
  "counter.get": {description: "Read", input: z.strictObject({}).meta({title: "SharedName"}), output: z.number().meta({title: "SharedName"})},
  "counter.add": {description: "Add", input: z.strictObject({by: z.number()}), output: z.number()},
}, events: {changed: {description: "Changed", payload: z.number()}} });`,
    );
    const config = validateConfig(
      {
        app: { name: "Skill Test", identifier: "test.skill", build: 2, version: "1.1.0" },
        agent: { command: "skill-test", description: "Test skill" },
      },
      root,
    );
    await generateAgentArtifacts(config, resolve(root, "artifacts"));
    const directory = resolve(root, "artifacts/skill-test");
    expect(await readFile(resolve(directory, "SKILL.md"), "utf8")).toContain('build: "2"');
    expect(
      JSON.parse(await readFile(resolve(directory, "schema.json"), "utf8")).methods["counter.add"],
    ).toBeDefined();
    await writeFile(
      resolve(root, "workflow.ts"),
      `import "./artifacts/skill-test/agent";
const result: Promise<number> = app.call("counter.get", {});
app.on("changed", n => { const value: number = n; });
// @ts-expect-error invalid method
app.call("private.internal", {});
// @ts-expect-error invalid input
app.call("counter.add", {by: "wrong"});
export {};`,
    );
    const child = Bun.spawn(
      [
        process.execPath,
        resolve(Bun.resolveSync("typescript/package.json", import.meta.dir), "../bin/tsc"),
        "--noEmit",
        "--strict",
        "--target",
        "ES2022",
        "--moduleResolution",
        "bundler",
        "--module",
        "esnext",
        resolve(root, "workflow.ts"),
      ],
      { cwd: root, stdout: "pipe", stderr: "pipe" },
    );
    const stdout = await new Response(child.stdout).text();
    const stderr = await new Response(child.stderr).text();
    expect(stdout + stderr).toBe("");
    expect(await child.exited).toBe(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("one template generates no Swift, TOML, mode switches or app codegen", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "fia-create-"));
  try {
    const { projectRoot } = await createProject(
      { name: "hello", git: false, install: false, local: false, yes: true },
      root,
    );
    const entries = Array.from(new Bun.Glob("**/*").scanSync({ cwd: projectRoot }));
    expect(entries.some((name) => /swift|fia\.toml|fia\.lock|native-api/u.test(name))).toBe(false);
    expect(entries).toContain("backend/index.ts");
    expect(entries).toContain("fia.config.ts");
    expect(await readFile(resolve(projectRoot, "frontend/main.tsx"), "utf8")).toContain(
      "native.ready()",
    );
    expect(
      JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8")).dependencies[
        "@semicoder/fia"
      ],
    ).toBe(cliPackage.version);
    await expect(
      createProject({ name: "hello", git: false, install: false, local: false, yes: true }, root),
    ).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  expect(() => parseCreateOptions(["hello", "--template", "native"])).toThrow();
  expect(() => parseCreateOptions(["hello", "--no-backend"])).toThrow();
});
test("config validates immutable identity and rejects retired concepts", () => {
  const app = { name: "Hello", identifier: "com.example.hello", version: "1.0.0", build: 1 };
  const agent = { command: "hello", description: "Hello app" };
  expect(validateConfig({ app, agent }, "/tmp").backend.entry).toBe("backend/index.ts");
  expect(() => validateConfig({ app, agent, backend: { enabled: false } }, "/tmp")).toThrow();
  expect(() => validateConfig({ app, agent, native: { mode: "managed" } }, "/tmp")).toThrow();
  expect(() =>
    validateConfig({ app, agent, backend: { entry: "../escape.ts" } }, "/tmp"),
  ).toThrow();
  expect(() =>
    validateConfig(
      { app, agent, updates: { url: "http://localhost/latest.json", publicKey: "x" } },
      "/tmp",
    ),
  ).toThrow();
});
test("config reload observes edits to imported configuration", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "fia-config-"));
  try {
    await mkdir(resolve(root, "frontend"));
    await mkdir(resolve(root, "backend"));
    await mkdir(resolve(root, "shared"));
    await writeFile(resolve(root, "shared/api.ts"), "export default {}");
    await writeFile(resolve(root, "backend/index.ts"), "export default {}");
    await writeFile(
      resolve(root, "fia.config.ts"),
      'import build from "./build.ts"; export default {agent:{command:"hello",description:"Hello"},app:{name:"Hello",identifier:"com.example.hello",version:"1.0.0",build}}',
    );
    await writeFile(resolve(root, "build.ts"), "export default 1");
    expect((await loadProjectConfig(root)).app.build).toBe(1);
    await writeFile(resolve(root, "build.ts"), "export default 2");
    expect((await loadProjectConfig(root)).app.build).toBe(2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("signed release interoperates with raw Ed25519 keys and rejects tampering", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "fia-sign-"));
  try {
    const keys = await generateUpdateKeys(directory);
    const pem = await readFile(keys.privateKeyFile, "utf8");
    const release: CodeRelease = {
      schema: 1,
      identifier: "com.example.app",
      version: "1.1.0",
      build: 2,
      runtimeId: "a".repeat(64),
      baseURL: "https://example.com/releases/2/",
      files: [],
    };
    const signed = signRelease(release, pem, keys.publicKey);
    expect(verifyRelease(signed, keys.publicKey)).toEqual(release);
    expect(() =>
      verifyRelease(
        {
          ...signed,
          payload: Buffer.from(JSON.stringify({ ...release, build: 3 })).toString("base64"),
        },
        keys.publicKey,
      ),
    ).toThrow();
    expect(() => signRelease(release, pem, "wrong")).toThrow();
    await expect(generateUpdateKeys(directory)).rejects.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("precompiled runtimes fail closed, and release files reject native executables", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "fia-artifact-"));
  try {
    await expect(verifyAssets(directory)).rejects.toThrow("No Swift fallback");
    await mkdir(resolve(directory, "backend"));
    await mkdir(resolve(directory, "web"));
    await writeFile(resolve(directory, "backend/index.js"), "console.log('hi')");
    await writeFile(resolve(directory, "web/index.html"), "hello");
    const files = await releaseFiles(directory);
    expect(files).toHaveLength(2);
    expect(files[0]!.sha256).toBe(hash("console.log('hi')"));
    await writeFile(resolve(directory, "backend/native.node"), Buffer.from("cffaedfe", "hex"));
    await expect(releaseFiles(directory)).rejects.toThrow("Native binaries");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("icon input retains Unicode and color validation", () => {
  expect(parseIconArguments(["中"]).text).toBe("中");
  expect(() => parseIconArguments(["hello"])).toThrow();
  expect(() => parseIconArguments(["F", "--background", "red"])).toThrow();
});
