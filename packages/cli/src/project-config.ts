import { constants } from "node:fs";
import { access, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { FIA_PROJECT_SCHEMA } from "./metadata.ts";

const CONFIG_FILE_NAME = "fia.toml";
const PERMISSIONS = [
  "application",
  "windows",
  "dialogs",
  "clipboard",
  "keychain",
  "screens",
  "screenCapture",
  "notifications",
  "system",
  "globalShortcuts",
] as const;

export type NativePermission = (typeof PERMISSIONS)[number];
export type ProjectTemplate = "native" | "web" | "hybrid";
export type ActivationPolicy = "regular" | "accessory";
export type UpdateChannel = "stable" | "beta";
export type UpdateUI = "native" | "custom";

export type ProjectConfigErrorCode =
  | "CONFIG_NOT_FOUND"
  | "CONFIG_PARSE_FAILED"
  | "CONFIG_INVALID"
  | "CONFIG_UNSUPPORTED_VERSION"
  | "CONFIG_PATH_INVALID";

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
  readonly schema: typeof FIA_PROJECT_SCHEMA;
  readonly projectRoot: string;
  readonly configPath: string;
  readonly app: {
    readonly name: string;
    readonly identifier: string;
    readonly version: string;
    readonly build: number;
    readonly minimumMacOS: string;
    readonly activationPolicy: ActivationPolicy;
    readonly icon?: string;
  };
  readonly web: { readonly enabled: boolean; readonly root: string; readonly dist: string };
  readonly backend: {
    readonly enabled: boolean;
    readonly runtime: "bun";
    readonly mount: string;
    readonly entry?: string;
    readonly watch: readonly string[];
  };
  readonly statusItem?: { readonly symbol: string; readonly tooltip: string };
  readonly native: { readonly permissions: Readonly<Record<NativePermission, boolean>> };
  readonly updater?: {
    readonly publicKey: string;
    readonly channel: UpdateChannel;
    readonly ui: UpdateUI;
    readonly feeds: Readonly<Partial<Record<UpdateChannel, string>>>;
  };
  readonly signing?: {
    readonly developmentIdentity?: string;
    readonly releaseIdentity?: string;
    readonly notarizationProfile?: string;
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
  if (!isPlainObject(value)) invalid(path, "expected a table");
  return value;
}

function optionalObject(value: unknown, path: string): Record<string, unknown> {
  return value === undefined ? {} : objectAt(value, path);
}

function exactKeys(
  object: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  const accepted = new Set(allowed);
  const unknown = Object.keys(object).find((key) => !accepted.has(key));
  if (unknown !== undefined)
    invalid(path === "config" ? unknown : `${path}.${unknown}`, "unknown field");
}

function requiredString(object: Record<string, unknown>, key: string, path: string): string {
  const value = object[key];
  const field = `${path}.${key}`;
  if (typeof value !== "string")
    invalid(field, value === undefined ? "is required" : "expected a string");
  if (value.trim().length === 0 || value !== value.trim())
    invalid(field, "must be a non-empty trimmed string");
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

function oneOf<const Value extends string>(
  value: unknown,
  allowed: readonly Value[],
  path: string,
  fallback: Value,
): Value {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !allowed.includes(value as Value)) {
    invalid(path, `expected one of ${allowed.join(", ")}`);
  }
  return value as Value;
}

async function projectPath(
  projectRoot: string,
  value: unknown,
  path: string,
  options: { mustExist: boolean; file?: boolean },
): Promise<string> {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.includes("\0") ||
    isAbsolute(value)
  ) {
    throw new ProjectConfigError(
      "CONFIG_PATH_INVALID",
      `${path}: expected a relative project path`,
      { path },
    );
  }
  const output = resolve(projectRoot, value);
  const fromRoot = relative(projectRoot, output);
  if (
    fromRoot === "" ||
    fromRoot === ".." ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  ) {
    throw new ProjectConfigError("CONFIG_PATH_INVALID", `${path}: must stay inside the project`, {
      path,
    });
  }
  if (!options.mustExist) return output;
  try {
    const information = await stat(output);
    if (options.file === true && !information.isFile()) throw new Error("not a file");
    await access(output, constants.R_OK);
    const [physicalRoot, physicalPath] = await Promise.all([
      realpath(projectRoot),
      realpath(output),
    ]);
    const physicalRelative = relative(physicalRoot, physicalPath);
    if (
      physicalRelative === "" ||
      physicalRelative === ".." ||
      physicalRelative.startsWith(`..${sep}`) ||
      isAbsolute(physicalRelative)
    ) {
      throw new Error("resolved outside project");
    }
  } catch (error) {
    throw new ProjectConfigError(
      "CONFIG_PATH_INVALID",
      `${path}: path is not readable inside the project`,
      {
        path,
        cause: error,
      },
    );
  }
  return output;
}

function httpsURL(value: unknown, path: string): string {
  if (typeof value !== "string") invalid(path, "expected an HTTPS URL");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    invalid(path, "expected an HTTPS URL");
  }
  if (url.protocol !== "https:" || url.username.length > 0 || url.password.length > 0) {
    invalid(path, "expected an HTTPS URL without credentials");
  }
  return url.href;
}

function signingIdentity(value: unknown, path: string, releaseOnly: boolean): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length === 0 ||
    value.length > 512
  ) {
    invalid(path, "expected a non-empty trimmed signing identity");
  }
  const pattern = releaseOnly
    ? /^Developer ID Application: .+$/u
    : /^(?:Apple Development|Developer ID Application): .+$/u;
  if (!pattern.test(value)) {
    invalid(
      path,
      releaseOnly
        ? "expected a Developer ID Application identity"
        : "expected an Apple Development or Developer ID Application identity",
    );
  }
  return value;
}

export async function resolveProjectConfig(
  value: unknown,
  projectDirectory: string,
  configPath = resolve(projectDirectory, CONFIG_FILE_NAME),
): Promise<ResolvedFIAConfig> {
  const projectRoot = resolve(projectDirectory);
  const root = objectAt(value, "config");
  exactKeys(
    root,
    ["schema", "app", "web", "backend", "statusItem", "native", "updater", "signing"],
    "config",
  );
  if (root.schema !== FIA_PROJECT_SCHEMA) {
    if (typeof root.schema === "number" && Number.isInteger(root.schema)) {
      throw new ProjectConfigError(
        "CONFIG_UNSUPPORTED_VERSION",
        `schema: unsupported version ${root.schema}; expected ${FIA_PROJECT_SCHEMA}`,
        { path: "schema" },
      );
    }
    invalid("schema", `expected the number ${FIA_PROJECT_SCHEMA}`);
  }

  const app = objectAt(root.app, "app");
  exactKeys(
    app,
    ["name", "identifier", "version", "build", "icon", "minimumMacOS", "activationPolicy"],
    "app",
  );
  const name = requiredString(app, "name", "app");
  if (name === "." || name === ".." || /[/:]/u.test(name))
    invalid("app.name", "must be a safe macOS application name");
  const identifier = requiredString(app, "identifier", "app");
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*(\.[A-Za-z0-9][A-Za-z0-9-]*)+$/u.test(identifier)) {
    invalid("app.identifier", "expected a reverse-DNS bundle identifier");
  }
  const version = optionalString(app, "version", "app", "0.1.0");
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version))
    invalid("app.version", "expected semantic version X.Y.Z");
  const buildValue = app.build ?? 1;
  if (typeof buildValue !== "number" || !Number.isSafeInteger(buildValue) || buildValue < 1) {
    invalid("app.build", "expected a positive integer");
  }
  const minimumMacOS = optionalString(app, "minimumMacOS", "app", "14.0");
  const minimumMajor = Number.parseInt(minimumMacOS.split(".")[0] ?? "", 10);
  if (!/^\d+\.\d+$/u.test(minimumMacOS) || minimumMajor < 14)
    invalid("app.minimumMacOS", "expected macOS 14.0 or newer");
  const activationPolicy = oneOf(
    app.activationPolicy,
    ["regular", "accessory"] as const,
    "app.activationPolicy",
    "regular",
  );
  const icon =
    app.icon === undefined
      ? undefined
      : await projectPath(projectRoot, app.icon, "app.icon", { mustExist: true, file: true });
  if (icon !== undefined && !icon.toLowerCase().endsWith(".icns"))
    invalid("app.icon", "expected an .icns file");

  const webValue = optionalObject(root.web, "web");
  exactKeys(webValue, ["enabled", "root", "dist"], "web");
  const webEnabled = optionalBoolean(webValue, "enabled", "web", true);
  const webRoot = await projectPath(
    projectRoot,
    optionalString(webValue, "root", "web", "frontend"),
    "web.root",
    { mustExist: webEnabled },
  );
  const webDist = await projectPath(
    projectRoot,
    optionalString(webValue, "dist", "web", "frontend/dist"),
    "web.dist",
    { mustExist: false },
  );

  const backendValue = optionalObject(root.backend, "backend");
  exactKeys(backendValue, ["enabled", "runtime", "entry", "watch", "mount"], "backend");
  const backendEnabled = optionalBoolean(backendValue, "enabled", "backend", false);
  const backendRuntime = oneOf(backendValue.runtime, ["bun"] as const, "backend.runtime", "bun");
  const mount = optionalString(backendValue, "mount", "backend", "/api");
  if (!/^\/[A-Za-z0-9._~/-]*$/u.test(mount) || mount === "/" || mount.startsWith("/_fia")) {
    invalid("backend.mount", "expected an absolute non-framework path prefix");
  }
  const entry = backendEnabled
    ? await projectPath(projectRoot, backendValue.entry, "backend.entry", {
        mustExist: true,
        file: true,
      })
    : undefined;
  let watch: readonly string[] = [];
  if (backendEnabled) {
    const watchValue = backendValue.watch ?? ["backend"];
    if (!Array.isArray(watchValue) || watchValue.length === 0)
      invalid("backend.watch", "expected a non-empty path array");
    watch = await Promise.all(
      watchValue.map((item, index) =>
        projectPath(projectRoot, item, `backend.watch.${index}`, { mustExist: true }),
      ),
    );
  }

  let statusItem: ResolvedFIAConfig["statusItem"];
  if (root.statusItem !== undefined) {
    const value = objectAt(root.statusItem, "statusItem");
    exactKeys(value, ["symbol", "tooltip"], "statusItem");
    statusItem = {
      symbol: optionalString(value, "symbol", "statusItem", "circle.grid.2x2.fill"),
      tooltip: optionalString(value, "tooltip", "statusItem", name),
    };
  }

  const nativeValue = optionalObject(root.native, "native");
  exactKeys(nativeValue, ["permissions"], "native");
  const permissionsValue = optionalObject(nativeValue.permissions, "native.permissions");
  exactKeys(permissionsValue, PERMISSIONS, "native.permissions");
  const permissions = Object.fromEntries(
    PERMISSIONS.map((permission) => [
      permission,
      permission === "application" || permission === "windows"
        ? optionalBoolean(permissionsValue, permission, "native.permissions", true)
        : optionalBoolean(permissionsValue, permission, "native.permissions", false),
    ]),
  ) as Record<NativePermission, boolean>;

  let updater: ResolvedFIAConfig["updater"];
  if (root.updater !== undefined) {
    const value = objectAt(root.updater, "updater");
    exactKeys(value, ["publicKey", "channel", "ui", "feeds"], "updater");
    const publicKey = requiredString(value, "publicKey", "updater");
    let publicKeyBytes: Uint8Array;
    try {
      publicKeyBytes = Buffer.from(publicKey, "base64");
    } catch {
      invalid("updater.publicKey", "expected a base64 Ed25519 public key");
    }
    if (
      publicKeyBytes.byteLength !== 32 ||
      Buffer.from(publicKeyBytes).toString("base64") !== publicKey
    ) {
      invalid(
        "updater.publicKey",
        "expected a canonical base64-encoded 32-byte Ed25519 public key",
      );
    }
    const channel = oneOf(value.channel, ["stable", "beta"] as const, "updater.channel", "stable");
    const ui = oneOf(value.ui, ["native", "custom"] as const, "updater.ui", "native");
    const feedsValue = objectAt(value.feeds, "updater.feeds");
    exactKeys(feedsValue, ["stable", "beta"], "updater.feeds");
    const feeds: Partial<Record<UpdateChannel, string>> = {};
    if (feedsValue.stable !== undefined)
      feeds.stable = httpsURL(feedsValue.stable, "updater.feeds.stable");
    if (feedsValue.beta !== undefined) feeds.beta = httpsURL(feedsValue.beta, "updater.feeds.beta");
    if (feeds[channel] === undefined)
      invalid(`updater.feeds.${channel}`, "a feed is required for the selected channel");
    updater = { publicKey, channel, ui, feeds };
  }

  let signing: ResolvedFIAConfig["signing"];
  if (root.signing !== undefined) {
    const value = objectAt(root.signing, "signing");
    exactKeys(value, ["developmentIdentity", "releaseIdentity", "notarizationProfile"], "signing");
    const developmentIdentity =
      value.developmentIdentity === undefined
        ? undefined
        : signingIdentity(value.developmentIdentity, "signing.developmentIdentity", false);
    const releaseIdentity =
      value.releaseIdentity === undefined
        ? undefined
        : signingIdentity(value.releaseIdentity, "signing.releaseIdentity", true);
    const notarizationProfile =
      value.notarizationProfile === undefined
        ? undefined
        : requiredString(value, "notarizationProfile", "signing");
    signing = {
      ...(developmentIdentity === undefined ? {} : { developmentIdentity }),
      ...(releaseIdentity === undefined ? {} : { releaseIdentity }),
      ...(notarizationProfile === undefined ? {} : { notarizationProfile }),
    };
  }

  return {
    schema: FIA_PROJECT_SCHEMA,
    projectRoot,
    configPath,
    app: {
      name,
      identifier,
      version,
      build: buildValue,
      minimumMacOS,
      activationPolicy,
      ...(icon === undefined ? {} : { icon }),
    },
    web: { enabled: webEnabled, root: webRoot, dist: webDist },
    backend: {
      enabled: backendEnabled,
      runtime: backendRuntime,
      mount,
      ...(entry === undefined ? {} : { entry }),
      watch,
    },
    ...(statusItem === undefined ? {} : { statusItem }),
    native: { permissions },
    ...(updater === undefined ? {} : { updater }),
    ...(signing === undefined ? {} : { signing }),
  };
}

export async function loadProjectConfig(
  projectDirectory = process.cwd(),
): Promise<ResolvedFIAConfig> {
  const projectRoot = resolve(projectDirectory);
  const configPath = resolve(projectRoot, CONFIG_FILE_NAME);
  let source: string;
  try {
    source = await readFile(configPath, "utf8");
  } catch (error) {
    throw new ProjectConfigError(
      "CONFIG_NOT_FOUND",
      `${CONFIG_FILE_NAME}: file was not found or is not readable`,
      { path: CONFIG_FILE_NAME, cause: error },
    );
  }
  let value: unknown;
  try {
    value = Bun.TOML.parse(source);
  } catch (error) {
    throw new ProjectConfigError("CONFIG_PARSE_FAILED", `${CONFIG_FILE_NAME}: invalid TOML`, {
      path: CONFIG_FILE_NAME,
      cause: error,
    });
  }
  return await resolveProjectConfig(value, projectRoot, configPath);
}
