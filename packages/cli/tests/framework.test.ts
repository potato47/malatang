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
  expect(validateConfig({ app }, "/tmp").backend.entry).toBe("backend/index.ts");
  expect(() => validateConfig({ app, backend: { enabled: false } }, "/tmp")).toThrow();
  expect(() => validateConfig({ app, native: { mode: "managed" } }, "/tmp")).toThrow();
  expect(() => validateConfig({ app, backend: { entry: "../escape.ts" } }, "/tmp")).toThrow();
  expect(() =>
    validateConfig(
      { app, updates: { url: "http://localhost/latest.json", publicKey: "x" } },
      "/tmp",
    ),
  ).toThrow();
});
test("config reload observes edits to imported configuration", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "fia-config-"));
  try {
    await mkdir(resolve(root, "frontend"));
    await mkdir(resolve(root, "backend"));
    await writeFile(resolve(root, "backend/index.ts"), "export default {}");
    await writeFile(
      resolve(root, "fia.config.ts"),
      'import build from "./build.ts"; export default {app:{name:"Hello",identifier:"com.example.hello",version:"1.0.0",build}}',
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
