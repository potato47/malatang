import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { parseReleaseArguments } from "../../../tools/publish-npm.ts";
import { nextMinorVersion, requireIncreasingVersion } from "../../../tools/version-npm.ts";

const repository = resolve(import.meta.dir, "../../..");
const versionedPaths = [
  "package.json",
  "packages/cli/package.json",
  "packages/cli/src/metadata.ts",
  "Sources/FIACore/FIAVersion.swift",
  "bun.lock",
];

test("release accepts an optional version and dry-run flag", () => {
  expect(parseReleaseArguments([])).toEqual({ help: false, dryRun: false, version: undefined });
  for (const args of [
    ["1.2.3", "--dry-run"],
    ["--dry-run", "1.2.3"],
  ])
    expect(parseReleaseArguments(args)).toEqual({ help: false, dryRun: true, version: "1.2.3" });
  expect(parseReleaseArguments(["--help"]).help).toBe(true);
  expect(() => parseReleaseArguments(["1.2.3", "1.3.0"])).toThrow();
  expect(() => parseReleaseArguments(["--unknown"])).toThrow();
});

test("default release increments minor and resets patch and prerelease", () => {
  expect(nextMinorVersion("0.14.0")).toBe("0.15.0");
  expect(nextMinorVersion("1.9.7-beta.2")).toBe("1.10.0");
  for (const target of ["0.14.0", "0.13.9", "garbage", "01.15.0"])
    expect(() => requireIncreasingVersion("0.14.0", target)).toThrow();
  expect(() => requireIncreasingVersion("0.14.0", "0.15.0-beta.1")).not.toThrow();
});

// Run the real release/version scripts in a disposable repository; replace only
// subprocess execution so tests never build runtimes or contact npm.
for (const scenario of [
  "publish",
  "explicit",
  "dry-run",
  "failed",
  "dirty",
  "prepare",
  "prepare-explicit",
  "prepare-invalid",
] as const) {
  test(`release workflow: ${scenario}`, async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "fia-release-"));
    try {
      for (const path of [...versionedPaths, "tools/publish-npm.ts", "tools/version-npm.ts"]) {
        await mkdir(dirname(resolve(directory, path)), { recursive: true });
        await cp(resolve(repository, path), resolve(directory, path));
      }
      const before = await Promise.all(
        versionedPaths.map((path) => readFile(resolve(directory, path), "utf8")),
      );
      const current = JSON.parse(before[0]!).version as string;
      const target =
        scenario === "explicit" || scenario === "prepare-explicit"
          ? "99.0.1"
          : nextMinorVersion(current);
      await writeFile(
        resolve(directory, "tools/shared.ts"),
        `
import { appendFile, readFile } from "node:fs/promises";
export const repositoryRoot = ${JSON.stringify(directory)};
export function requireBunVersion() {}
export async function run(command: string[]) {
  await appendFile(repositoryRoot + "/commands.jsonl", JSON.stringify(command) + "\\n");
  return command[0] === "git" && ${JSON.stringify(scenario)} === "dirty" ? " M README.md" : "";
}
export async function runInteractive(command: string[]) {
  const pkg = JSON.parse(await readFile(repositoryRoot + "/packages/cli/package.json", "utf8"));
  if (pkg.version !== ${JSON.stringify(target)}) throw new Error("build saw stale version");
  await run(command);
  if (${JSON.stringify(scenario)} === "failed") throw new Error("simulated build failure");
}
`,
      );
      const prepare = scenario.startsWith("prepare");
      const args =
        scenario === "prepare-invalid"
          ? [current]
          : scenario === "explicit" || scenario === "prepare-explicit"
            ? [target]
            : scenario === "dry-run"
              ? ["--dry-run"]
              : [];
      const child = Bun.spawn(
        [process.execPath, prepare ? "tools/version-npm.ts" : "tools/publish-npm.ts", ...args],
        {
          cwd: directory,
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(exitCode, stderr).toBe(
        scenario === "failed" || scenario === "dirty" || scenario === "prepare-invalid" ? 1 : 0,
      );
      const after = await Promise.all(
        versionedPaths.map((path) => readFile(resolve(directory, path), "utf8")),
      );
      if (scenario === "prepare-invalid") {
        expect(after).toEqual(before);
        expect(await Bun.file(resolve(directory, "commands.jsonl")).exists()).toBe(false);
        return;
      }
      const commands = (await readFile(resolve(directory, "commands.jsonl"), "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as string[]);
      const publishes = commands.filter((command) => command[0] === "npm");
      if (prepare) {
        for (const contents of after) expect(contents).toContain(target);
        expect(commands).toEqual([[process.execPath, "install", "--lockfile-only"]]);
        expect(publishes).toHaveLength(0);
        expect(stdout).toContain(`tagging v${target}`);
      } else if (scenario === "publish" || scenario === "explicit") {
        for (const contents of after) expect(contents).toContain(target);
        expect(publishes).toHaveLength(2);
        expect(publishes[0]).toContain("--dry-run");
        expect(publishes[1]).not.toContain("--dry-run");
        expect(stdout).toContain(`published @semicoder/fia@${target}`);
      } else {
        expect(after).toEqual(before);
        expect(publishes).toHaveLength(scenario === "dry-run" ? 1 : 0);
        if (scenario === "dry-run") expect(publishes[0]).toContain("--dry-run");
        if (scenario === "dirty") expect(commands).toHaveLength(1);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
