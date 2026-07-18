import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import packageMetadata from "../package.json";
import { CLI_VERSION } from "../src/metadata.ts";

const packageRoot = resolve(import.meta.dir, "..");
const executable = resolve(packageRoot, "bin/fia");

async function run(arguments_: readonly string[]): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const child = Bun.spawn([process.execPath, executable, ...arguments_], {
    cwd: packageRoot,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("published CLI shape", () => {
  test("keeps package metadata and runtime version aligned", () => {
    expect(packageMetadata.name).toBe("@fia/cli");
    expect(packageMetadata.version).toBe(CLI_VERSION);
    expect(packageMetadata.bin).toEqual({ fia: "bin/fia" });
    expect(packageMetadata.publishConfig).toEqual({ access: "public" });
  });

  test("runs the built bin for version and JSON diagnostics", async () => {
    expect(await Bun.file(resolve(packageRoot, "dist/index.js")).exists()).toBe(true);

    const version = await run(["--version"]);
    const doctor = await run(["doctor", "--json"]);

    expect(version).toEqual({ exitCode: 0, stdout: "fia 0.1.0\n", stderr: "" });
    expect(doctor.exitCode).toBe(0);
    expect(doctor.stderr).toBe("");
    expect(JSON.parse(doctor.stdout)).toMatchObject({
      schemaVersion: 1,
      cli: { name: "@fia/cli", version: "0.1.0" },
      ok: true,
    });
  });
});
