import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  FIA_CONFIG_VERSION,
  type FIAApplicationMode,
  type FIAConfig,
  type FIAWindowCloseBehavior,
} from "./config.ts";

const CONFIG_FILE_NAME = "fia.config.ts";
const DEFAULT_ENTRY = "src/server.ts";
const DEFAULT_UI = "src/ui/index.html";
const DEFAULT_APP_VERSION = "0.1.0";
const DEFAULT_WINDOW = {
  width: 1024,
  height: 700,
  minWidth: 720,
  minHeight: 480,
} as const;
const DEFAULT_STATUS_BAR_SYMBOL = "circle.grid.2x2.fill";

export type ProjectConfigErrorCode =
  | "CONFIG_NOT_FOUND"
  | "CONFIG_IMPORT_FAILED"
  | "CONFIG_INVALID"
  | "CONFIG_UNSUPPORTED_VERSION"
  | "CONFIG_ENTRY_INVALID"
  | "CONFIG_UI_INVALID"
  | "CONFIG_ICON_INVALID"
  | "CONFIG_SWIFT_INVALID";

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
  readonly runtime: "bun" | "none" | "swift";
  readonly swift?: {
    readonly package: string;
    readonly product: string;
  };
  readonly entry?: string;
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
  if (value.includes("\0") || value.length > maximumLength) {
    invalid(`${path}.${key}`, `must be at most ${maximumLength} characters and contain no NUL`);
  }
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

function resolveProjectFile(
  projectRoot: string,
  value: string,
  field: "entry" | "ui" | "app.icon" | "swift.package",
  code: "CONFIG_ENTRY_INVALID" | "CONFIG_UI_INVALID" | "CONFIG_ICON_INVALID" | "CONFIG_SWIFT_INVALID",
): string {
  if (isAbsolute(value)) {
    throw new ProjectConfigError(code, `${field}: must be relative to fia.config.ts`, {
      path: field,
    });
  }
  const file = resolve(projectRoot, value);
  const fromRoot = relative(projectRoot, file);
  if (fromRoot === "" || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new ProjectConfigError(code, `${field}: must stay inside the project directory`, {
      path: field,
    });
  }
  return file;
}

async function requireReadableProjectFile(
  projectRoot: string,
  value: string,
  field: "entry" | "ui" | "app.icon",
  code: "CONFIG_ENTRY_INVALID" | "CONFIG_UI_INVALID" | "CONFIG_ICON_INVALID",
): Promise<string> {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ProjectConfigError(code, `${field}: expected a non-empty relative path`, { path: field });
  }
  const file = resolveProjectFile(projectRoot, value, field, code);
  try {
    const fileStat = await stat(file);
    if (!fileStat.isFile()) throw new Error("not a file");
    await access(file, constants.R_OK);
    const [physicalRoot, physicalFile] = await Promise.all([realpath(projectRoot), realpath(file)]);
    const physicalRelative = relative(physicalRoot, physicalFile);
    if (
      physicalRelative === "" ||
      physicalRelative === ".." ||
      physicalRelative.startsWith(`..${sep}`) ||
      isAbsolute(physicalRelative)
    ) {
      throw new ProjectConfigError(code, `${field}: resolved file must stay inside the project directory`, {
        path: field,
      });
    }
  } catch (error) {
    if (error instanceof ProjectConfigError) throw error;
    throw new ProjectConfigError(code, `${field}: file is not readable: ${value}`, {
      path: field,
      cause: error,
    });
  }
  return file;
}

async function requireSwiftPackage(projectRoot: string, value: unknown): Promise<string> {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ProjectConfigError("CONFIG_SWIFT_INVALID", "swift.package: expected a non-empty relative path", {
      path: "swift.package",
    });
  }
  const packageDirectory = resolveProjectFile(
    projectRoot,
    value,
    "swift.package",
    "CONFIG_SWIFT_INVALID",
  );
  try {
    const packageStat = await stat(packageDirectory);
    if (!packageStat.isDirectory()) throw new Error("not a directory");
    await access(resolve(packageDirectory, "Package.swift"), constants.R_OK);
    const [physicalRoot, physicalPackage] = await Promise.all([realpath(projectRoot), realpath(packageDirectory)]);
    const physicalRelative = relative(physicalRoot, physicalPackage);
    if (
      physicalRelative === "" ||
      physicalRelative === ".." ||
      physicalRelative.startsWith(`..${sep}`) ||
      isAbsolute(physicalRelative)
    ) {
      throw new Error("outside project");
    }
  } catch (error) {
    throw new ProjectConfigError(
      "CONFIG_SWIFT_INVALID",
      `swift.package: expected a project directory containing Package.swift: ${value}`,
      { path: "swift.package", cause: error },
    );
  }
  return packageDirectory;
}

export async function resolveProjectConfig(
  value: unknown,
  projectDirectory: string,
  configPath = resolve(projectDirectory, CONFIG_FILE_NAME),
): Promise<ResolvedFIAConfig> {
  const projectRoot = resolve(projectDirectory);
  const root = objectAt(value, "config");
  exactKeys(root, ["configVersion", "app", "runtime", "swift", "entry", "ui", "window", "statusBar"], "config");

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
    icon = await requireReadableProjectFile(
      projectRoot,
      app.icon as string,
      "app.icon",
      "CONFIG_ICON_INVALID",
    );
    if (extname(icon).toLowerCase() !== ".icns") {
      throw new ProjectConfigError("CONFIG_ICON_INVALID", "app.icon: expected an ICNS file", {
        path: "app.icon",
      });
    }
  }

  const runtime = optionalEnum(root, "runtime", "config", ["bun", "none", "swift"], "bun");
  let swift: { package: string; product: string } | undefined;
  if (runtime === "swift") {
    const swiftValue = objectAt(root.swift, "swift");
    exactKeys(swiftValue, ["package", "product"], "swift");
    const packageDirectory = await requireSwiftPackage(projectRoot, swiftValue.package);
    const product = requiredString(swiftValue, "product", "swift");
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(product)) {
      throw new ProjectConfigError(
        "CONFIG_SWIFT_INVALID",
        "swift.product: expected a safe Swift executable product name",
        { path: "swift.product" },
      );
    }
    swift = { package: packageDirectory, product };
  } else if (root.swift !== undefined) {
    invalid("swift", "is only allowed when runtime is \"swift\"");
  }
  const entryValue = root.entry === undefined ? DEFAULT_ENTRY : root.entry;
  const uiValue = root.ui === undefined ? DEFAULT_UI : root.ui;
  if (runtime !== "bun" && root.entry !== undefined) {
    invalid("entry", `must be omitted when runtime is ${JSON.stringify(runtime)}`);
  }
  const entry = runtime === "bun"
    ? await requireReadableProjectFile(projectRoot, entryValue as string, "entry", "CONFIG_ENTRY_INVALID")
    : undefined;
  const ui = await requireReadableProjectFile(projectRoot, uiValue as string, "ui", "CONFIG_UI_INVALID");
  if (extname(ui).toLowerCase() !== ".html") {
    throw new ProjectConfigError("CONFIG_UI_INVALID", "ui: expected an HTML entry file", { path: "ui" });
  }

  const window = root.window === undefined ? {} : objectAt(root.window, "window");
  exactKeys(window, [
    "width",
    "height",
    "minWidth",
    "minHeight",
    "closeBehavior",
    "restoreState",
    "alwaysOnTop",
    "visibleOnAllSpaces",
    "visibleOverFullScreen",
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

  return {
    configVersion: FIA_CONFIG_VERSION,
    projectRoot,
    configPath,
    app: { name, identifier, version, mode, ...(icon === undefined ? {} : { icon }) },
    runtime,
    ...(swift === undefined ? {} : { swift }),
    ...(entry === undefined ? {} : { entry }),
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
