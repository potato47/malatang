import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { loadProjectConfig } from "./project-config.ts";

export interface IconArguments {
  text: string;
  background: string;
  foreground: string;
  output?: string;
  force: boolean;
}

export function parseIconArguments(args: readonly string[]): IconArguments {
  const values = new Map<string, string>();
  let text: string | undefined;
  let force = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (["--background", "--foreground", "--output"].includes(argument)) {
      if (values.has(argument)) throw new Error(`${argument} may only be specified once`);
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      values.set(argument, value);
    } else if (argument === "--force") {
      if (force) throw new Error("--force may only be specified once");
      force = true;
    } else if (argument.startsWith("-")) throw new Error(`unknown icon option: ${argument}`);
    else if (text !== undefined) throw new Error("icon accepts exactly one character");
    else text = argument;
  }
  if (text === undefined) throw new Error("icon requires one letter, number or Chinese character");
  text = text.normalize("NFC");
  if (
    [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].length !== 1 ||
    !/^[\p{L}\p{N}][\p{L}\p{N}\p{M}]*$/u.test(text) ||
    /[\p{Extended_Pictographic}\u20E3\uFE0E\uFE0F]/u.test(text)
  )
    throw new Error(
      "icon accepts exactly one letter, number or Chinese character; whitespace and emoji are not supported",
    );
  const background = (values.get("--background") ?? "#000000").toUpperCase();
  const foreground = (values.get("--foreground") ?? "#FFFFFF").toUpperCase();
  for (const [name, value] of [
    ["--background", background],
    ["--foreground", foreground],
  ]) {
    if (!/^#[0-9A-F]{6}$/.test(value!)) throw new Error(`${name} must be a #RRGGBB color`);
  }
  if (background === foreground)
    throw new Error("background and foreground must be different colors");
  const output = values.get("--output");
  if (force && output === undefined)
    throw new Error("--force is only used with --output; project icons are updated directly");
  return { text, background, foreground, ...(output === undefined ? {} : { output }), force };
}

// Find edit locations without treating comments or multiline strings as TOML syntax.
function tokens(source: string): { start: number; end: number; value: string }[] {
  const result = [];
  for (let index = 0; index < source.length;) {
    const start = index;
    const char = source[index]!;
    if (char === "#") {
      while (index < source.length && source[index] !== "\n") index++;
      continue;
    }
    if (char === '"' || char === "'") {
      const triple = source.slice(index, index + 3) === char.repeat(3);
      const delimiter = char.repeat(triple ? 3 : 1);
      index += delimiter.length;
      while (index < source.length) {
        if (char === '"' && source[index] === "\\") {
          index += 2;
          continue;
        }
        if (source.startsWith(delimiter, index)) {
          index += delimiter.length;
          if (triple) while (source[index] === char) index++;
          break;
        }
        index++;
      }
    } else index++;
    if (char === "\n" || !/\s/.test(char))
      result.push({ start, end: index, value: source.slice(start, index) });
  }
  return result;
}

export function updateIconConfig(source: string): string {
  const parsed = Bun.TOML.parse(source) as { app?: Record<string, unknown>; schema?: number };
  if (parsed.schema !== 2 || !parsed.app || typeof parsed.app !== "object")
    throw new Error("fia.toml requires schema 2 and an [app] table");
  const target = structuredClone(parsed);
  target.app!.icon = "assets/icon.icns";
  if (isDeepStrictEqual(target, parsed)) return source;
  const valid = (candidate: string): boolean => {
    try {
      return isDeepStrictEqual(Bun.TOML.parse(candidate), target);
    } catch {
      return false;
    }
  };
  const literal = '"assets/icon.icns"';
  const entries = tokens(source);
  for (let index = 0; index < entries.length; index++) {
    const token = entries[index]!;
    const edits: string[] = [];
    if (
      parsed.app.icon !== undefined &&
      (token.value.startsWith('"') || token.value.startsWith("'"))
    ) {
      edits.push(source.slice(0, token.start) + literal + source.slice(token.end));
    } else if (parsed.app.icon === undefined) {
      if (token.value === "\n") {
        const newline = source.includes("\r\n") ? "\r\n" : "\n";
        edits.push(
          source.slice(0, token.end) + `icon = ${literal}${newline}` + source.slice(token.end),
        );
      }
      if (token.value === "}") {
        const previous = entries.slice(0, index).findLast((entry) => entry.value !== "\n")?.value;
        const separator = previous === "{" || previous === "," ? "" : ", ";
        edits.push(
          source.slice(0, token.start) +
            `${separator}icon = ${literal}` +
            source.slice(token.start),
        );
      }
    }
    for (const candidate of edits) if (valid(candidate)) return candidate;
  }
  // Dotted app keys and an [app] header at EOF need an insertion outside the cases above.
  for (const candidate of [`app.icon = ${literal}\n${source}`, `${source}\nicon = ${literal}\n`]) {
    if (valid(candidate)) return candidate;
  }
  throw new Error(
    "Could not update app.icon while preserving fia.toml; use --output and set app.icon manually",
  );
}

export interface IconDependencies {
  platform?: string;
  runner?: (command: readonly string[]) => Promise<void>;
  render?: (options: IconArguments, directory: string) => Promise<void>;
  rename?: typeof rename;
}

async function run(command: readonly string[]): Promise<void> {
  const child = Bun.spawn([...command], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [status, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  if (status !== 0) throw new Error(`${command[0]} failed (${status}): ${stderr.trim()}`);
}

async function renderIcon(
  options: IconArguments,
  directory: string,
  runner: NonNullable<IconDependencies["runner"]>,
): Promise<void> {
  try {
    await access("/usr/bin/iconutil", constants.X_OK);
    await runner(["/usr/bin/xcrun", "--find", "swift"]);
  } catch (error) {
    throw new Error(
      "fia icon requires the macOS Swift toolchain and iconutil. Install Xcode Command Line Tools with xcode-select --install.",
      { cause: error },
    );
  }
  const script = resolve(import.meta.dir, "../templates/tools/render-icon.swift");
  await access(script).catch(() => {
    throw new Error("Icon renderer is missing from the FIA installation; reinstall @semicoder/fia");
  });
  await runner([
    "/usr/bin/xcrun",
    "swift",
    "-module-cache-path",
    resolve(directory, "module-cache"),
    script,
    options.text,
    options.background,
    options.foreground,
    directory,
  ]);
  await runner([
    "/usr/bin/iconutil",
    "--convert",
    "icns",
    "--output",
    resolve(directory, "icon.icns"),
    resolve(directory, "icon.iconset"),
  ]);
  // Decode the container before publishing files. The renderer also decodes each PNG.
  await runner([
    "/usr/bin/iconutil",
    "--convert",
    "iconset",
    "--output",
    resolve(directory, "verify.iconset"),
    resolve(directory, "icon.icns"),
  ]);
}

async function fileState(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function generateIcon(
  options: IconArguments & { cwd: string; dependencies?: IconDependencies },
): Promise<{ outputs: string[]; project: boolean }> {
  const dependencies = options.dependencies ?? {};
  if ((dependencies.platform ?? process.platform) !== "darwin")
    throw new Error("fia icon is only supported on macOS");
  const project = options.output === undefined;
  const output = resolve(options.cwd, options.output ?? "assets");
  const configPath = resolve(options.cwd, "fia.toml");
  let configSource: string | undefined;
  let config: string | undefined;
  if (project) {
    await loadProjectConfig(options.cwd);
    configSource = await readFile(configPath, "utf8");
    config = updateIconConfig(configSource);
  }
  const outputs = [resolve(output, "icon.png"), resolve(output, "icon.icns")];
  const destinations = [...outputs, ...(project ? [configPath] : [])];
  const directoryState = await fileState(output);
  if (directoryState && (!directoryState.isDirectory() || directoryState.isSymbolicLink()))
    throw new Error(`Icon output must be a real directory: ${output}`);
  for (const path of destinations) {
    const state = await fileState(path);
    if (state && !state.isFile())
      throw new Error(`Refusing to replace a non-regular file: ${path}`);
    if (state && !project && !options.force)
      throw new Error(`File already exists: ${path}; use --force to replace exported icons`);
  }
  const temporary = await mkdtemp(resolve(tmpdir(), "fia-icon-"));
  const stages: {
    directory: string;
    path: string;
    old: boolean;
    installed: boolean;
    backedUp: boolean;
  }[] = [];
  let preserveBackups = false;
  let createdOutput = false;
  try {
    await (
      dependencies.render ??
      ((args, directory) => renderIcon(args, directory, dependencies.runner ?? run))
    )(options, temporary);
    const png = await readFile(resolve(temporary, "icon.png"));
    const icns = await readFile(resolve(temporary, "icon.icns"));
    if (
      png.length < 33 ||
      png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
      png.readUInt32BE(16) !== 1024 ||
      png.readUInt32BE(20) !== 1024
    )
      throw new Error("Renderer produced an invalid 1024×1024 PNG");
    if (
      icns.length < 8 ||
      icns.subarray(0, 4).toString() !== "icns" ||
      icns.readUInt32BE(4) !== icns.length
    )
      throw new Error("Renderer produced an invalid ICNS");
    if (project && (await readFile(configPath, "utf8")) !== configSource)
      throw new Error("fia.toml changed while generating the icon; retry the command");
    const content = [png, icns, ...(config === undefined ? [] : [Buffer.from(config)])];
    await mkdir(output, { recursive: true });
    createdOutput = directoryState === undefined;
    for (let index = 0; index < destinations.length; index++) {
      const path = destinations[index]!;
      const state = await fileState(path);
      if (state && (!state.isFile() || (!project && !options.force)))
        throw new Error(`Output changed while generating: ${path}`);
      const directory = await mkdtemp(resolve(dirname(path), ".fia-icon-"));
      stages.push({ directory, path, old: state !== undefined, installed: false, backedUp: false });
      await writeFile(resolve(directory, "new"), content[index]!, {
        mode: state ? state.mode & 0o777 : 0o644,
      });
    }
    const move = dependencies.rename ?? rename;
    for (const stage of stages) {
      if (stage.old) {
        await move(stage.path, resolve(stage.directory, "old"));
        stage.backedUp = true;
      }
      await move(resolve(stage.directory, "new"), stage.path);
      stage.installed = true;
    }
    return { outputs, project };
  } catch (error) {
    const failures: unknown[] = [];
    for (const stage of stages.toReversed()) {
      try {
        if (stage.installed) await rm(stage.path);
        if (stage.backedUp) await rename(resolve(stage.directory, "old"), stage.path);
      } catch (failure) {
        failures.push(failure);
      }
    }
    if (failures.length) {
      preserveBackups = true;
      throw new AggregateError(
        [error, ...failures],
        `Icon update failed and could not fully restore files. Backups retained in: ${stages.map((stage) => stage.directory).join(", ")}`,
      );
    }
    throw error;
  } finally {
    await rm(temporary, { recursive: true, force: true });
    if (!preserveBackups)
      for (const stage of stages) await rm(stage.directory, { recursive: true, force: true });
    if (createdOutput)
      await rmdir(output).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOTEMPTY" && error.code !== "ENOENT") throw error;
      });
  }
}
