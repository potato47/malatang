import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  FIA_CONFIG_VERSION,
  type FIAApplicationMode,
  type FIAConfig,
  type FIAWindowCloseBehavior,
} from "./config.ts";

const CONFIG_FILE_NAME = "fia.config.ts";
const DEFAULT_UI = "src/ui/index.html";
const DEFAULT_APP_VERSION = "0.1.0";
const DEFAULT_WINDOW = {
  width: 1024,
  height: 700,
  minWidth: 720,
  minHeight: 480,
} as const;
const DEFAULT_STATUS_BAR_SYMBOL = "circle.grid.2x2.fill";
const SERVER_ID_PATTERN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;

export type ProjectConfigErrorCode =
  | "CONFIG_NOT_FOUND"
  | "CONFIG_IMPORT_FAILED"
  | "CONFIG_INVALID"
  | "CONFIG_UNSUPPORTED_VERSION"
  | "CONFIG_UI_INVALID"
  | "CONFIG_ICON_INVALID"
  | "CONFIG_MCP_INVALID";

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
    readonly mode: FIAApplicationMode;
    readonly icon?: string;
  };
  readonly ui: string;
  readonly window: {
    readonly width: number;
    readonly height: number;
    readonly minWidth: number;
    readonly minHeight: number;
    readonly closeBehavior: FIAWindowCloseBehavior;
    readonly restoreState: boolean;
    readonly alwaysOnTop: boolean;
    readonly visibleOnAllSpaces: boolean;
    readonly visibleOverFullScreen: boolean;
  };
  readonly statusBar: {
    readonly symbol: string;
    readonly tooltip: string;
  };
  readonly mcp?: {
    readonly app?: {
      readonly entry: string;
      readonly watch: readonly string[];
    };
    readonly servers: Readonly<Record<string, {
      readonly executable: string;
      readonly args: readonly string[];
    }>>;
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
  if (value.includes("\0")) invalid(field, "must not contain NUL");
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

function optionalEnum<const Value extends string>(
  object: Record<string, unknown>,
  key: string,
  path: string,
  allowed: readonly Value[],
  fallback: Value,
): Value {
  const value = object[key];
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !allowed.includes(value as Value)) {
    invalid(`${path}.${key}`, `expected one of ${allowed.map((item) => JSON.stringify(item)).join(", ")}`);
  }
  return value as Value;
}

function optionalBoundedString(
  object: Record<string, unknown>,
  key: string,
  path: string,
  fallback: string,
  maximumLength: number,
): string {
  if (object[key] === undefined) return fallback;
  const value = requiredString(object, key, path);
  if (value !== value.trim()) invalid(`${path}.${key}`, "must not contain surrounding whitespace");
  if (value.length > maximumLength) invalid(`${path}.${key}`, `must be at most ${maximumLength} characters`);
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

function resolveProjectPath(
  projectRoot: string,
  value: string,
  field: string,
  code: ProjectConfigErrorCode = "CONFIG_MCP_INVALID",
): string {
  if (isAbsolute(value)) {
    throw new ProjectConfigError(code, `${field}: must be relative to fia.config.ts`, { path: field });
  }
  const path = resolve(projectRoot, value);
  const fromRoot = relative(projectRoot, path);
  if (fromRoot === "" || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new ProjectConfigError(code, `${field}: must stay inside the project directory`, { path: field });
  }
  return path;
}

async function requireProjectPath(
  projectRoot: string,
  value: unknown,
  field: string,
  options: { kind: "file" | "any"; executable?: boolean; code?: ProjectConfigErrorCode } = { kind: "file" },
): Promise<string> {
  const code = options.code ?? "CONFIG_MCP_INVALID";
  if (typeof value !== "string" || value.trim().length === 0 || value.includes("\0")) {
    throw new ProjectConfigError(code, `${field}: expected a non-empty relative path`, { path: field });
  }
  let path: string;
  try {
    path = resolveProjectPath(projectRoot, value, field, code);
    const info = await stat(path);
    if (options.kind === "file" && !info.isFile()) throw new Error("not a file");
    await access(path, constants.R_OK | (options.executable ? constants.X_OK : 0));
    const [physicalRoot, physicalPath] = await Promise.all([realpath(projectRoot), realpath(path)]);
    const fromRoot = relative(physicalRoot, physicalPath);
    if (fromRoot === "" || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
      throw new Error("resolved path is outside project");
    }
  } catch (error) {
    if (error instanceof ProjectConfigError) throw error;
    throw new ProjectConfigError(code, `${field}: path is not accessible inside the project: ${value}`, {
      path: field,
      cause: error,
    });
  }
  return path;
}

function parseArguments(value: unknown, path: string): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) invalid(path, "expected an array of strings");
  return value.map((argument, index) => {
    if (typeof argument !== "string" || argument.includes("\0")) {
      invalid(`${path}.${index}`, "expected a string without NUL");
    }
    return argument;
  });
}

async function resolveMcp(
  root: Record<string, unknown>,
  projectRoot: string,
): Promise<ResolvedFIAConfig["mcp"]> {
  if (root.mcp === undefined) return undefined;
  const mcp = objectAt(root.mcp, "mcp");
  exactKeys(mcp, ["app", "servers"], "mcp");

  let app: { entry: string; watch: readonly string[] } | undefined;
  if (mcp.app !== undefined) {
    const source = objectAt(mcp.app, "mcp.app");
    exactKeys(source, ["entry", "watch"], "mcp.app");
    const entry = await requireProjectPath(projectRoot, source.entry, "mcp.app.entry", { kind: "file" });
    let watch: readonly string[];
    if (source.watch === undefined) {
      watch = [dirname(entry)];
    } else {
      if (!Array.isArray(source.watch) || source.watch.length === 0) {
        invalid("mcp.app.watch", "expected a non-empty array of project paths");
      }
      watch = await Promise.all(source.watch.map((value, index) =>
        requireProjectPath(projectRoot, value, `mcp.app.watch.${index}`, { kind: "any" })
      ));
    }
    app = { entry, watch };
  }

  const servers: Record<string, { executable: string; args: readonly string[] }> = {};
  if (mcp.servers !== undefined) {
    const values = objectAt(mcp.servers, "mcp.servers");
    for (const [id, raw] of Object.entries(values)) {
      const path = `mcp.servers.${id}`;
      if (!SERVER_ID_PATTERN.test(id) || id.includes("..")) {
        invalid(path, "server ID must contain only lowercase letters, digits, dots, and hyphens");
      }
      if (id === "app" || id === "fia.native" || id.startsWith("fia.")) {
        invalid(path, `${JSON.stringify(id)} is a reserved server ID`);
      }
      const server = objectAt(raw, path);
      exactKeys(server, ["executable", "args"], path);
      servers[id] = {
        executable: await requireProjectPath(projectRoot, server.executable, `${path}.executable`, {
          kind: "file",
          executable: true,
        }),
        args: parseArguments(server.args, `${path}.args`),
      };
    }
  }

  if (app === undefined && Object.keys(servers).length === 0) {
    invalid("mcp", "must configure app or at least one executable server");
  }
  return { ...(app === undefined ? {} : { app }), servers };
}

export async function resolveProjectConfig(
  value: unknown,
  projectDirectory: string,
  configPath = resolve(projectDirectory, CONFIG_FILE_NAME),
): Promise<ResolvedFIAConfig> {
  const projectRoot = resolve(projectDirectory);
  const root = objectAt(value, "config");
  exactKeys(root, ["configVersion", "app", "ui", "window", "statusBar", "mcp"], "config");

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
  exactKeys(app, ["name", "identifier", "version", "mode", "icon"], "app");
  const name = requiredString(app, "name", "app");
  if (name !== name.trim() || name === "." || name === ".." || /[\0/:]/.test(name)) {
    invalid("app.name", "must be a safe macOS application name without surrounding whitespace, '/', ':', or NUL");
  }
  const identifier = requiredString(app, "identifier", "app");
  const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9-]*(\.[A-Za-z0-9][A-Za-z0-9-]*)+$/;
  if (!identifierPattern.test(identifier)) invalid("app.identifier", "expected a reverse-DNS bundle identifier");
  const version = optionalString(app, "version", "app", DEFAULT_APP_VERSION);
  if (!/^\d+\.\d+\.\d+$/.test(version)) invalid("app.version", "expected a numeric X.Y.Z version");
  const mode = optionalEnum(app, "mode", "app", ["dock", "statusBar", "hybrid"], "dock");
  let icon: string | undefined;
  if (app.icon !== undefined) {
    icon = await requireProjectPath(projectRoot, app.icon, "app.icon", {
      kind: "file",
      code: "CONFIG_ICON_INVALID",
    });
    if (extname(icon).toLowerCase() !== ".icns") {
      throw new ProjectConfigError("CONFIG_ICON_INVALID", "app.icon: expected an ICNS file", { path: "app.icon" });
    }
  }

  const uiValue = root.ui === undefined ? DEFAULT_UI : root.ui;
  const ui = await requireProjectPath(projectRoot, uiValue, "ui", { kind: "file", code: "CONFIG_UI_INVALID" });
  if (extname(ui).toLowerCase() !== ".html") {
    throw new ProjectConfigError("CONFIG_UI_INVALID", "ui: expected an HTML entry file", { path: "ui" });
  }

  const window = root.window === undefined ? {} : objectAt(root.window, "window");
  exactKeys(window, [
    "width", "height", "minWidth", "minHeight", "closeBehavior", "restoreState", "alwaysOnTop",
    "visibleOnAllSpaces", "visibleOverFullScreen",
  ], "window");
  const width = optionalDimension(window, "width", "window", DEFAULT_WINDOW.width);
  const height = optionalDimension(window, "height", "window", DEFAULT_WINDOW.height);
  const minWidth = optionalDimension(window, "minWidth", "window", DEFAULT_WINDOW.minWidth);
  const minHeight = optionalDimension(window, "minHeight", "window", DEFAULT_WINDOW.minHeight);
  if (width < minWidth) invalid("window.width", "must be greater than or equal to window.minWidth");
  if (height < minHeight) invalid("window.height", "must be greater than or equal to window.minHeight");
  const closeBehavior = optionalEnum(
    window,
    "closeBehavior",
    "window",
    ["quit", "hide"],
    mode === "dock" ? "quit" : "hide",
  );
  const restoreState = optionalBoolean(window, "restoreState", "window", true);
  const alwaysOnTop = optionalBoolean(window, "alwaysOnTop", "window", false);
  const visibleOnAllSpaces = optionalBoolean(window, "visibleOnAllSpaces", "window", false);
  const visibleOverFullScreen = optionalBoolean(window, "visibleOverFullScreen", "window", false);

  const statusBar = root.statusBar === undefined ? {} : objectAt(root.statusBar, "statusBar");
  exactKeys(statusBar, ["symbol", "tooltip"], "statusBar");
  const symbol = optionalBoundedString(statusBar, "symbol", "statusBar", DEFAULT_STATUS_BAR_SYMBOL, 128);
  const tooltip = optionalBoundedString(statusBar, "tooltip", "statusBar", name, 512);
  const mcp = await resolveMcp(root, projectRoot);

  return {
    configVersion: FIA_CONFIG_VERSION,
    projectRoot,
    configPath,
    app: { name, identifier, version, mode, ...(icon === undefined ? {} : { icon }) },
    ui,
    window: {
      width,
      height,
      minWidth,
      minHeight,
      closeBehavior,
      restoreState,
      alwaysOnTop,
      visibleOnAllSpaces,
      visibleOverFullScreen,
    },
    statusBar: { symbol, tooltip },
    ...(mcp === undefined ? {} : { mcp }),
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
