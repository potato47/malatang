import { afterEach, describe, expect, test } from "bun:test";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runCLI } from "../src/cli.ts";
import { createProject } from "../src/create.ts";
import {
  generateIcon,
  parseIconArguments,
  updateIconConfig,
  type IconDependencies,
} from "../src/icon.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function directory() {
  const root = await mkdtemp(resolve(tmpdir(), "fia-icon-test-"));
  roots.push(root);
  return root;
}
const assets = resolve(import.meta.dir, "../templates/v2/common/assets");
const fixtureRenderer: NonNullable<IconDependencies["render"]> = async (_options, output) => {
  await copyFile(resolve(assets, "icon.png"), resolve(output, "icon.png"));
  await copyFile(resolve(assets, "icon.icns"), resolve(output, "icon.icns"));
};
const dependencies: IconDependencies = { platform: "darwin", render: fixtureRenderer };
async function project() {
  return await createProject({
    name: "icon-app",
    cwd: await directory(),
    install: false,
    initializeGit: false,
    template: "native",
    io: { stdout() {} },
  });
}

describe("icon arguments", () => {
  test("accepts Unicode graphemes and normalizes combining letters", () => {
    for (const text of ["F", "1", "中", "国", "𠮷", "é", "e\u0301"]) {
      expect(parseIconArguments([text]).text).toBe(text.normalize("NFC"));
    }
    expect(parseIconArguments(["F"])).toEqual({
      text: "F",
      background: "#000000",
      foreground: "#FFFFFF",
      force: false,
    });
    expect(
      parseIconArguments(["7", "--background", "#abcDEF", "--output", "my icons", "--force"])
        .background,
    ).toBe("#ABCDEF");
  });
  test("rejects invalid characters, colors and options", () => {
    for (const args of [
      [],
      [""],
      [" "],
      ["AB"],
      ["中", "国"],
      ["\n"],
      ["A\u200D"],
      ["😀"],
      ["1️⃣"],
      ["©"],
      ["F", "--background", "red"],
      ["F", "--foreground", "#000000"],
      ["F", "--background"],
      ["F", "--output"],
      ["F", "--output", ""],
      ["F", "--force"],
      ["F", "--font", "Arial"],
      ["F", "--output", "a", "--output", "b"],
      ["F", "--force", "--force"],
    ]) {
      expect(() => parseIconArguments(args)).toThrow();
    }
  });
  test("CLI advertises icon and reports usage errors", async () => {
    const stdout: string[] = [],
      stderr: string[] = [];
    const io = {
      stdout: (text: string) => stdout.push(text),
      stderr: (text: string) => stderr.push(text),
    };
    expect(await runCLI([], { io })).toBe(0);
    expect(stdout.join("")).toContain("fia icon");
    expect(await runCLI(["icon", "--help"], { io })).toBe(0);
    expect(stdout.join("")).toContain("overwritten");
    expect(await runCLI(["icon", "AB"], { io })).toBe(2);
    expect(stderr.join("")).toContain("exactly one");
  });
});

describe("lossless icon configuration", () => {
  test("replaces only app.icon while retaining comments, quoting and multiline content", () => {
    const source = `schema = 2\n# icon = "old.icns"\n[app] # keep\nname = """Demo\nicon = 'fake.icns'\n"""\n'icon' = '''old.icns''' # retain\n[web]\nroot = 'old.icns'\n`;
    expect(updateIconConfig(source)).toBe(
      source.replace("'''old.icns''' # retain", '"assets/icon.icns" # retain'),
    );
  });
  test("adds or replaces the field in quoted, dotted and inline app tables", () => {
    for (const source of [
      'schema = 2\n["app"] # keep\nname = "Demo"\n[web]\nenabled = false\n',
      'schema = 2\napp.name = "Demo"\n',
      'schema = 2\napp = { name = "Demo" }\n',
      'schema = 2\napp = { name = "Demo", icon = "old.icns" }\n',
      'schema = 2\napp.icon = "old.icns"\n',
      "schema = 2\n[app]",
      'schema = 2\r\n[app]\r\nname = "Demo"\r\n',
    ]) {
      const result = updateIconConfig(source);
      const before = Bun.TOML.parse(source) as { app: { icon?: string } };
      before.app.icon = "assets/icon.icns";
      expect(Bun.TOML.parse(result)).toEqual(before);
      if (source.includes("# keep")) expect(result).toContain("# keep");
      if (source.includes("\r\n")) expect(result.replaceAll("\r\n", "")).not.toContain("\n");
    }
  });
  test("leaves an already correct config byte-identical", () => {
    const source = "schema = 2\n[app]\nicon = 'assets/icon.icns' # custom comment\n";
    expect(updateIconConfig(source)).toBe(source);
  });
});

describe("icon generation transaction", () => {
  test("exports outside a project and requires force to overwrite", async () => {
    const cwd = await directory();
    const args = { ...parseIconArguments(["中", "--output", "my icons"]), cwd, dependencies };
    expect((await generateIcon(args)).project).toBe(false);
    expect(await readdir(cwd)).toEqual(["my icons"]);
    const png = await readFile(resolve(cwd, "my icons/icon.png"));
    await expect(generateIcon(args)).rejects.toThrow("--force");
    await generateIcon({ ...args, force: true });
    expect(await readFile(resolve(cwd, "my icons/icon.png"))).toEqual(png);
    expect((await readdir(resolve(cwd, "my icons"))).sort()).toEqual(["icon.icns", "icon.png"]);
  });
  test("updates a project and keeps an earlier custom icon and TOML comments", async () => {
    const cwd = await project();
    const configPath = resolve(cwd, "fia.toml");
    await copyFile(resolve(cwd, "assets/icon.icns"), resolve(cwd, "assets/custom.icns"));
    const source = (await readFile(configPath, "utf8")).replace(
      'icon = "assets/icon.icns"',
      'icon = "assets/custom.icns" # custom',
    );
    await writeFile(configPath, source);
    const stdout: string[] = [];
    expect(
      await runCLI(["icon", "国"], {
        workingDirectory: cwd,
        icon: dependencies,
        io: { stdout: (text) => stdout.push(text), stderr() {} },
      }),
    ).toBe(0);
    expect(await readFile(configPath, "utf8")).toBe(
      source.replace('"assets/custom.icns"', '"assets/icon.icns"'),
    );
    expect(await Bun.file(resolve(cwd, "assets/custom.icns")).exists()).toBe(true);
    expect(stdout.join("")).toContain("Restart fia dev");
  });
  test("requires a project unless output is explicit", async () => {
    await expect(
      generateIcon({ ...parseIconArguments(["F"]), cwd: await directory(), dependencies }),
    ).rejects.toThrow("fia.toml");
  });
  test("rejects unsupported platforms and missing tools before writing files", async () => {
    const cwd = await directory();
    const args = { ...parseIconArguments(["F", "--output", "out"]), cwd };
    await expect(generateIcon({ ...args, dependencies: { platform: "linux" } })).rejects.toThrow(
      "macOS",
    );
    await expect(
      generateIcon({
        ...args,
        dependencies: {
          platform: "darwin",
          runner: async () => {
            throw new Error("missing Swift");
          },
        },
      }),
    ).rejects.toThrow("xcode-select --install");
    expect(await readdir(cwd)).toEqual([]);
  });
  test("rejects symlinks without changing their targets", async () => {
    const cwd = await directory();
    await mkdir(resolve(cwd, "out"));
    await writeFile(resolve(cwd, "original"), "keep");
    await symlink(resolve(cwd, "original"), resolve(cwd, "out/icon.png"));
    await expect(
      generateIcon({
        ...parseIconArguments(["F", "--output", "out", "--force"]),
        cwd,
        dependencies,
      }),
    ).rejects.toThrow("non-regular");
    expect(await readFile(resolve(cwd, "original"), "utf8")).toBe("keep");
  });
  test("rejects corrupt renderer output and leaves files unchanged", async () => {
    const cwd = await project();
    const original = await readFile(resolve(cwd, "assets/icon.png"));
    await expect(
      generateIcon({
        ...parseIconArguments(["F"]),
        cwd,
        dependencies: {
          ...dependencies,
          render: async (args, output) => {
            await fixtureRenderer(args, output);
            await writeFile(resolve(output, "icon.png"), "invalid");
          },
        },
      }),
    ).rejects.toThrow("invalid 1024");
    expect(await readFile(resolve(cwd, "assets/icon.png"))).toEqual(original);
  });
  test("restores all original files when installing the last file fails", async () => {
    const cwd = await project();
    const paths = ["assets/icon.png", "assets/icon.icns", "fia.toml"].map((path) =>
      resolve(cwd, path),
    );
    await writeFile(paths[0]!, "previous PNG");
    await writeFile(paths[1]!, "previous ICNS");
    const original = await Promise.all(paths.map((path) => readFile(path)));
    await expect(
      generateIcon({
        ...parseIconArguments(["F"]),
        cwd,
        dependencies: {
          ...dependencies,
          rename: async (from, to) => {
            if (String(from).endsWith("/new") && to === paths[2])
              throw new Error("simulated disk failure");
            await rename(from, to);
          },
        },
      }),
    ).rejects.toThrow("simulated disk failure");
    expect(await Promise.all(paths.map((path) => readFile(path)))).toEqual(original);
    expect((await readdir(cwd)).some((name) => name.startsWith(".fia-icon-"))).toBe(false);
    expect(
      (await readdir(resolve(cwd, "assets"))).some((name) => name.startsWith(".fia-icon-")),
    ).toBe(false);
  });
  test("removes partially installed new exports on failure", async () => {
    const cwd = await directory();
    await expect(
      generateIcon({
        ...parseIconArguments(["F", "--output", "out"]),
        cwd,
        dependencies: {
          ...dependencies,
          rename: async (from, to) => {
            if (String(to).endsWith("icon.icns")) throw new Error("disk failure");
            await rename(from, to);
          },
        },
      }),
    ).rejects.toThrow("disk failure");
    expect(await readdir(cwd)).toEqual([]);
  });
  test("does not overwrite concurrent config edits", async () => {
    const cwd = await project();
    const configPath = resolve(cwd, "fia.toml");
    const updated = (await readFile(configPath, "utf8")) + "\n# edited while rendering\n";
    await expect(
      generateIcon({
        ...parseIconArguments(["F"]),
        cwd,
        dependencies: {
          ...dependencies,
          render: async (args, output) => {
            await fixtureRenderer(args, output);
            await writeFile(configPath, updated);
          },
        },
      }),
    ).rejects.toThrow("changed while generating");
    expect(await readFile(configPath, "utf8")).toBe(updated);
  });
});
