import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { FIA_CONFIG_VERSION, type FIAConfig } from "./config.ts";

const CONFIG_FILE_NAME = "fia.config.ts";
const DEFAULT_APP_VERSION = "0.1.0";
const DEFAULT_STATUS_BAR_SYMBOL = "circle.grid.2x2.fill";

export type ProjectConfigErrorCode =
  | "CONFIG_NOT_FOUND"
  | "CONFIG_IMPORT_FAILED"
  | "CONFIG_INVALID"
  | "CONFIG_UNSUPPORTED_VERSION"
  | "CONFIG_ICON_INVALID"
  | "CONFIG_BACKEND_INVALID";

export class ProjectConfigError extends Error {
  readonly code: ProjectConfigErrorCode;
  readonly path?: string;

  constructor(
    code: ProjectConfigErrorCode,
    message: string,
    options: { path?: string; cause?: unknown } = {},
  ) {
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
    readonly icon?: string;
  };
  readonly backend: {
    readonly entry: string;
    readonly watch: readonly string[];
  };
  readonly statusBar: {
    readonly symbol: string;
    readonly tooltip: string;
  };
  readonly signing?: {
    readonly identity: string;
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

function exactKeys(
  object: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  const allowedKeys = new Set(allowed);
  const unknown = Object.keys(object).find((key) => !allowedKeys.has(key));
  if (unknown !== undefined)
    invalid(path === "config" ? unknown : `${path}.${unknown}`, "unknown field");
}

function requiredString(object: Record<string, unknown>, key: string, path: string): string {
  const value = object[key];
  const field = `${path}.${key}`;
  if (typeof value !== "string")
    invalid(field, value === undefined ? "is required" : "expected a string");
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
  return object[key] === undefined ? fallback : requiredString(object, key, path);
}

async function requireProjectPath(
  projectRoot: string,
  value: unknown,
  field: string,
  options: { kind: "file" | "any"; code?: ProjectConfigErrorCode },
): Promise<string> {
  const code = options.code ?? "CONFIG_BACKEND_INVALID";
  if (typeof value !== "string" || value.trim().length === 0 || value.includes("\0")) {
    throw new ProjectConfigError(code, `${field}: expected a non-empty relative path`, {
      path: field,
    });
  }
  if (isAbsolute(value)) {
    throw new ProjectConfigError(code, `${field}: must be relative to fia.config.ts`, {
      path: field,
    });
  }
  const path = resolve(projectRoot, value);
  const fromRoot = relative(projectRoot, path);
  if (
    fromRoot === "" ||
    fromRoot === ".." ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  ) {
    throw new ProjectConfigError(code, `${field}: must stay inside the project directory`, {
      path: field,
    });
  }
  try {
    const info = await stat(path);
    if (options.kind === "file" && !info.isFile()) throw new Error("not a file");
    await access(path, constants.R_OK);
    const [physicalRoot, physicalPath] = await Promise.all([realpath(projectRoot), realpath(path)]);
    const physicalRelative = relative(physicalRoot, physicalPath);
    if (
      physicalRelative === "" ||
      physicalRelative === ".." ||
      physicalRelative.startsWith(`..${sep}`) ||
      isAbsolute(physicalRelative)
    ) {
      throw new Error("resolved path is outside project");
    }
  } catch (error) {
    throw new ProjectConfigError(
      code,
      `${field}: path is not accessible inside the project: ${value}`,
      {
        path: field,
        cause: error,
      },
    );
  }
  return path;
}

export async function resolveProjectConfig(
  value: unknown,
  projectDirectory: string,
  configPath = resolve(projectDirectory, CONFIG_FILE_NAME),
): Promise<ResolvedFIAConfig> {
  const projectRoot = resolve(projectDirectory);
  const root = objectAt(value, "config");
  exactKeys(root, ["configVersion", "app", "backend", "statusBar", "signing"], "config");
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
  exactKeys(app, ["name", "identifier", "version", "icon"], "app");
  const name = requiredString(app, "name", "app");
  if (
    name !== name.trim() ||
    name === "." ||
    name === ".." ||
    /[/:]/u.test(name) ||
    name.includes(String.fromCharCode(0))
  ) {
    invalid(
      "app.name",
      "must be a safe macOS application name without surrounding whitespace, '/', ':', or NUL",
    );
  }
  const identifier = requiredString(app, "identifier", "app");
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*(\.[A-Za-z0-9][A-Za-z0-9-]*)+$/.test(identifier)) {
    invalid("app.identifier", "expected a reverse-DNS bundle identifier");
  }
  const version = optionalString(app, "version", "app", DEFAULT_APP_VERSION);
  if (!/^\d+\.\d+\.\d+$/.test(version)) invalid("app.version", "expected a numeric X.Y.Z version");
  let icon: string | undefined;
  if (app.icon !== undefined) {
    icon = await requireProjectPath(projectRoot, app.icon, "app.icon", {
      kind: "file",
      code: "CONFIG_ICON_INVALID",
    });
    if (extname(icon).toLowerCase() !== ".icns") {
      throw new ProjectConfigError("CONFIG_ICON_INVALID", "app.icon: expected an ICNS file", {
        path: "app.icon",
      });
    }
  }

  const backend = objectAt(root.backend, "backend");
  exactKeys(backend, ["entry", "watch"], "backend");
  const entry = await requireProjectPath(projectRoot, backend.entry, "backend.entry", {
    kind: "file",
  });
  let watch: readonly string[];
  if (backend.watch === undefined) {
    watch = [dirname(entry)];
  } else {
    if (!Array.isArray(backend.watch) || backend.watch.length === 0) {
      invalid("backend.watch", "expected a non-empty array of project paths");
    }
    watch = await Promise.all(
      backend.watch.map((item, index) =>
        requireProjectPath(projectRoot, item, `backend.watch.${index}`, { kind: "any" }),
      ),
    );
  }

  const statusBar = root.statusBar === undefined ? {} : objectAt(root.statusBar, "statusBar");
  exactKeys(statusBar, ["symbol", "tooltip"], "statusBar");
  const symbol = optionalString(statusBar, "symbol", "statusBar", DEFAULT_STATUS_BAR_SYMBOL);
  const tooltip = optionalString(statusBar, "tooltip", "statusBar", name);
  if (symbol.length > 128) invalid("statusBar.symbol", "must be at most 128 characters");
  if (tooltip.length > 512) invalid("statusBar.tooltip", "must be at most 512 characters");

  let signing: ResolvedFIAConfig["signing"];
  if (root.signing !== undefined) {
    const value = objectAt(root.signing, "signing");
    exactKeys(value, ["identity"], "signing");
    const identity = requiredString(value, "identity", "signing");
    if (identity !== identity.trim()) {
      invalid("signing.identity", "must not have surrounding whitespace");
    }
    if (identity.length > 512) invalid("signing.identity", "must be at most 512 characters");
    if (!/^(?:Apple Development|Developer ID Application): .+$/u.test(identity)) {
      invalid(
        "signing.identity",
        "must be an Apple Development or Developer ID Application identity name",
      );
    }
    signing = { identity };
  }

  return {
    configVersion: FIA_CONFIG_VERSION,
    projectRoot,
    configPath,
    app: { name, identifier, version, ...(icon === undefined ? {} : { icon }) },
    backend: { entry, watch },
    statusBar: { symbol, tooltip },
    ...(signing === undefined ? {} : { signing }),
  };
}

export async function loadProjectConfig(
  projectDirectory = process.cwd(),
): Promise<ResolvedFIAConfig> {
  const projectRoot = resolve(projectDirectory);
  const configPath = resolve(projectRoot, CONFIG_FILE_NAME);
  try {
    const info = await stat(configPath);
    if (!info.isFile()) throw new Error("not a file");
    await access(configPath, constants.R_OK);
  } catch (error) {
    throw new ProjectConfigError(
      "CONFIG_NOT_FOUND",
      `${CONFIG_FILE_NAME}: file was not found or is not readable`,
      {
        cause: error,
      },
    );
  }
  let imported: { default?: FIAConfig };
  try {
    const url = pathToFileURL(configPath);
    url.searchParams.set("fia", crypto.randomUUID());
    imported = (await import(url.href)) as { default?: FIAConfig };
  } catch (error) {
    throw new ProjectConfigError(
      "CONFIG_IMPORT_FAILED",
      `${CONFIG_FILE_NAME}: could not be imported`,
      {
        cause: error,
      },
    );
  }
  if (!("default" in imported)) invalid("config", "fia.config.ts must have a default export");
  return await resolveProjectConfig(imported.default, projectRoot, configPath);
}
