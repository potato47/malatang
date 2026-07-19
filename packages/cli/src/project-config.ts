import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { FIA_CONFIG_VERSION, type FIAConfig } from "./config.ts";

const CONFIG_FILE_NAME = "fia.config.ts";
const DEFAULT_ENTRY = "src/server.ts";
const DEFAULT_APP_VERSION = "0.1.0";
const DEFAULT_WINDOW = {
  width: 1024,
  height: 700,
  minWidth: 720,
  minHeight: 480,
} as const;

export type ProjectConfigErrorCode =
  | "CONFIG_NOT_FOUND"
  | "CONFIG_IMPORT_FAILED"
  | "CONFIG_INVALID"
  | "CONFIG_UNSUPPORTED_VERSION"
  | "CONFIG_ENTRY_INVALID";

export class ProjectConfigError extends Error {
  readonly code: ProjectConfigErrorCode;
  readonly path?: string;

  constructor(code: ProjectConfigErrorCode, message: string, options: { path?: string; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = "ProjectConfigError";
    this.code = code;
    this.path = options.path;
  }
}

export interface ResolvedFIAConfig {
  readonly configVersion: typeof FIA_CONFIG_VERSION;
  readonly projectRoot: string;
  readonly configPath: string;
  readonly app: {
    readonly name: string;
    readonly identifier: string;
    readonly version: string;
    readonly quitOnLastWindowClosed: boolean;
  };
  readonly entry: string;
  readonly window: {
    readonly width: number;
    readonly height: number;
    readonly minWidth: number;
    readonly minHeight: number;
  };
}

function invalid(path: string, message: string): never {
  throw new ProjectConfigError("CONFIG_INVALID", `${path}: ${message}`, { path });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function objectAt(value: unknown, path: string): Record<string, unknown> {
  if (!isPlainObject(value)) invalid(path, "expected an object");
  return value;
}

function exactKeys(object: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const allowedKeys = new Set(allowed);
  const unknown = Object.keys(object).find((key) => !allowedKeys.has(key));
  if (unknown !== undefined) invalid(path === "config" ? unknown : `${path}.${unknown}`, "unknown field");
}

function requiredString(object: Record<string, unknown>, key: string, path: string): string {
  const value = object[key];
  const field = `${path}.${key}`;
  if (typeof value !== "string") invalid(field, value === undefined ? "is required" : "expected a string");
  if (value.trim().length === 0) invalid(field, "must not be empty");
  return value;
}

function optionalString(
  object: Record<string, unknown>,
  key: string,
  path: string,
  fallback: string,
): string {
  if (object[key] === undefined) return fallback;
  return requiredString(object, key, path);
}

function optionalBoolean(
  object: Record<string, unknown>,
  key: string,
  path: string,
  fallback: boolean,
): boolean {
  const value = object[key];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") invalid(`${path}.${key}`, "expected a boolean");
  return value;
}

function optionalDimension(
  object: Record<string, unknown>,
  key: string,
  path: string,
  fallback: number,
): number {
  const value = object[key];
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    invalid(`${path}.${key}`, "expected a finite number greater than zero");
  }
  return value;
}

function resolveEntry(projectRoot: string, value: string): string {
  if (isAbsolute(value)) {
    throw new ProjectConfigError("CONFIG_ENTRY_INVALID", "entry: must be relative to fia.config.ts", {
      path: "entry",
    });
  }
  const entry = resolve(projectRoot, value);
  const fromRoot = relative(projectRoot, entry);
  if (fromRoot === "" || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new ProjectConfigError("CONFIG_ENTRY_INVALID", "entry: must stay inside the project directory", {
      path: "entry",
    });
  }
  return entry;
}

export async function resolveProjectConfig(
  value: unknown,
  projectDirectory: string,
  configPath = resolve(projectDirectory, CONFIG_FILE_NAME),
): Promise<ResolvedFIAConfig> {
  const projectRoot = resolve(projectDirectory);
  const root = objectAt(value, "config");
  exactKeys(root, ["configVersion", "app", "entry", "window"], "config");

  if (root.configVersion === undefined) invalid("configVersion", "is required");
  if (root.configVersion !== FIA_CONFIG_VERSION) {
    if (typeof root.configVersion === "number" && Number.isInteger(root.configVersion)) {
      throw new ProjectConfigError(
        "CONFIG_UNSUPPORTED_VERSION",
        `configVersion: unsupported version ${root.configVersion}; expected ${FIA_CONFIG_VERSION}`,
        { path: "configVersion" },
      );
    }
    invalid("configVersion", `expected the number ${FIA_CONFIG_VERSION}`);
  }

  const app = objectAt(root.app, "app");
  exactKeys(app, ["name", "identifier", "version", "quitOnLastWindowClosed"], "app");
  const name = requiredString(app, "name", "app");
  const identifier = requiredString(app, "identifier", "app");
  const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9-]*(\.[A-Za-z0-9][A-Za-z0-9-]*)+$/;
  if (!identifierPattern.test(identifier)) invalid("app.identifier", "expected a reverse-DNS bundle identifier");
  const version = optionalString(app, "version", "app", DEFAULT_APP_VERSION);
  if (!/^\d+\.\d+\.\d+$/.test(version)) invalid("app.version", "expected a numeric X.Y.Z version");
  const quitOnLastWindowClosed = optionalBoolean(app, "quitOnLastWindowClosed", "app", true);

  const entryValue = root.entry === undefined ? DEFAULT_ENTRY : root.entry;
  if (typeof entryValue !== "string" || entryValue.trim().length === 0) {
    invalid("entry", "expected a non-empty relative path");
  }
  const entry = resolveEntry(projectRoot, entryValue);
  try {
    const entryStat = await stat(entry);
    if (!entryStat.isFile()) throw new Error("not a file");
    await access(entry, constants.R_OK);
    const [physicalRoot, physicalEntry] = await Promise.all([realpath(projectRoot), realpath(entry)]);
    const physicalRelative = relative(physicalRoot, physicalEntry);
    if (
      physicalRelative === "" ||
      physicalRelative === ".." ||
      physicalRelative.startsWith(`..${sep}`) ||
      isAbsolute(physicalRelative)
    ) {
      throw new ProjectConfigError("CONFIG_ENTRY_INVALID", "entry: resolved file must stay inside the project directory", {
        path: "entry",
      });
    }
  } catch (error) {
    if (error instanceof ProjectConfigError) throw error;
    throw new ProjectConfigError("CONFIG_ENTRY_INVALID", `entry: file is not readable: ${entryValue}`, {
      path: "entry",
      cause: error,
    });
  }

  const window = root.window === undefined ? {} : objectAt(root.window, "window");
  exactKeys(window, ["width", "height", "minWidth", "minHeight"], "window");
  const width = optionalDimension(window, "width", "window", DEFAULT_WINDOW.width);
  const height = optionalDimension(window, "height", "window", DEFAULT_WINDOW.height);
  const minWidth = optionalDimension(window, "minWidth", "window", DEFAULT_WINDOW.minWidth);
  const minHeight = optionalDimension(window, "minHeight", "window", DEFAULT_WINDOW.minHeight);
  if (width < minWidth) invalid("window.width", "must be greater than or equal to window.minWidth");
  if (height < minHeight) invalid("window.height", "must be greater than or equal to window.minHeight");

  return {
    configVersion: FIA_CONFIG_VERSION,
    projectRoot,
    configPath,
    app: { name, identifier, version, quitOnLastWindowClosed },
    entry,
    window: { width, height, minWidth, minHeight },
  };
}

export async function loadProjectConfig(projectDirectory = process.cwd()): Promise<ResolvedFIAConfig> {
  const projectRoot = resolve(projectDirectory);
  const configPath = resolve(projectRoot, CONFIG_FILE_NAME);
  try {
    const configStat = await stat(configPath);
    if (!configStat.isFile()) throw new Error("not a file");
    await access(configPath, constants.R_OK);
  } catch (error) {
    throw new ProjectConfigError("CONFIG_NOT_FOUND", `${CONFIG_FILE_NAME}: file was not found or is not readable`, {
      cause: error,
    });
  }

  let imported: { default?: FIAConfig };
  try {
    const url = pathToFileURL(configPath);
    url.searchParams.set("fia", crypto.randomUUID());
    imported = await import(url.href) as { default?: FIAConfig };
  } catch (error) {
    throw new ProjectConfigError("CONFIG_IMPORT_FAILED", `${CONFIG_FILE_NAME}: could not be imported`, {
      cause: error,
    });
  }
  if (!("default" in imported)) invalid("config", "fia.config.ts must have a default export");
  return await resolveProjectConfig(imported.default, projectRoot, configPath);
}
