import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createProject } from "../src/create.ts";
import { generateNativeAPI } from "../src/generate.ts";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

describe("generated source contract", () => {
  test("pins the matching FIA Swift package and generates deterministically", async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), "fia-template-v2-"));
    roots.push(cwd);
    const root = await createProject({
      name: "contract-app",
      cwd,
      install: false,
      initializeGit: false,
      template: "hybrid",
      backend: false,
      io: { stdout() {} },
      dependencies: { cliPackageSpec: "2.0.0", swiftPackageURL: "https://example.dev/fia.git" },
    });
    expect(await readFile(resolve(root, "native/Package.swift"), "utf8")).toContain(
      '.package(url: "https://example.dev/fia.git", exact: "2.0.0")',
    );
    const packageJSON = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as {
      devDependencies: Record<string, string>;
    };
    expect(packageJSON.devDependencies["@semicoder/fia"]).toBe("2.0.0");
    expect((await generateNativeAPI({ cwd: root, check: true })).changed).toEqual([]);
    expect((await generateNativeAPI({ cwd: root })).changed).toEqual([]);
  });

  test("generates a typed contract and detects drift on either output", async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), "fia-template-contract-v2-"));
    roots.push(cwd);
    const root = await createProject({
      name: "typed-contract",
      cwd,
      install: false,
      initializeGit: false,
      template: "web",
      backend: false,
      io: { stdout() {} },
    });
    await writeFile(
      resolve(root, "native-api/api.fia.json"),
      `${JSON.stringify(
        {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          schemaVersion: 1,
          namespace: "AppNativeAPI",
          $defs: {
            Greeting: {
              type: "object",
              properties: { "display-name": { type: "string" }, count: { type: "integer" } },
              required: ["display-name"],
            },
          },
          methods: [
            {
              name: "greeting.make",
              input: { $ref: "#/$defs/Greeting" },
              output: { type: "string" },
              errors: ["unavailable"],
            },
          ],
          errors: [{ code: "unavailable", recoverable: true }],
          events: [{ name: "greeting.changed", payload: { $ref: "#/$defs/Greeting" } }],
        },
        null,
        2,
      )}\n`,
    );
    await generateNativeAPI({ cwd: root });
    const swift = resolve(root, "native/Sources/FIAApp/Generated/NativeAPI.generated.swift");
    const typescript = resolve(root, "generated/native-api.ts");
    const generatedSwift = await readFile(swift, "utf8");
    expect(generatedSwift).toContain('case displayName = "display-name"');
    expect(generatedSwift).toContain("AppNativeAPIProtocol: NativeMethodProvider");
    const generatedTypeScript = await readFile(typescript, "utf8");
    expect(generatedTypeScript).toContain("options?: NativeCallOptions");
    expect(generatedTypeScript).toContain("createAppNativeAPI(transport: NativeTransport)");
    expect(generatedTypeScript).toContain("onAppNativeAPIEvent");
    expect(generatedTypeScript).toContain('readonly "greeting.changed": Greeting');
    expect((await generateNativeAPI({ cwd: root, check: true })).changed).toEqual([]);
    await writeFile(swift, "// stale Swift\n");
    expect((await generateNativeAPI({ cwd: root, check: true })).changed).toEqual([
      "native/Sources/FIAApp/Generated/NativeAPI.generated.swift",
    ]);
    await generateNativeAPI({ cwd: root });
    await writeFile(typescript, "// stale TypeScript\n");
    expect((await generateNativeAPI({ cwd: root, check: true })).changed).toEqual([
      "generated/native-api.ts",
    ]);
  });
});
