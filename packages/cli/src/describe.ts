import { loadProjectConfig } from "./project-config.ts";
import { readNativeAPISchema } from "./generate.ts";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  CLI_VERSION,
  FIA_BACKEND_PROTOCOL_VERSION,
  FIA_NATIVE_PROTOCOL_VERSION,
  FIA_PROJECT_SCHEMA,
} from "./metadata.ts";

export interface ApplicationDescription {
  readonly schemaVersion: 1;
  readonly framework: {
    readonly version: string;
    readonly projectSchema: number;
    readonly nativeProtocol: number;
    readonly backendProtocol: number;
  };
  readonly app: {
    readonly name: string;
    readonly identifier: string;
    readonly version: string;
    readonly build: number;
    readonly activationPolicy: string;
  };
  readonly runtimes: {
    readonly swift: true;
    readonly web: boolean;
    readonly bun: boolean;
    readonly updater: boolean;
  };
  readonly windows: readonly { readonly id: string; readonly type: string }[];
  readonly nativeMethods: readonly string[];
  readonly nativeEvents: readonly string[];
  readonly nativeErrors: readonly { readonly code: string; readonly recoverable: boolean }[];
  readonly permissions: Readonly<Record<string, boolean>>;
}

async function swiftRegistrations(cwd: string): Promise<Array<{ id: string; type: string }>> {
  const root = resolve(cwd, "native/Sources/FIAApp");
  const files: string[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (path.endsWith(".swift") && !path.endsWith(".generated.swift")) files.push(path);
    }
  }
  await walk(root);
  const windows: Array<{ id: string; type: string }> = [];
  for (const file of files.sort()) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(
      /\.register(Web|SwiftUI|AppKit)\(\s*"([A-Za-z0-9._-]+)"/gu,
    )) {
      windows.push({
        id: match[2]!,
        type: match[1] === "Web" ? "web" : match[1] === "SwiftUI" ? "swiftUI" : "appKit",
      });
    }
  }
  return windows.sort((left, right) => left.id.localeCompare(right.id));
}

export async function describeProject(cwd: string): Promise<ApplicationDescription> {
  const [config, api, windows] = await Promise.all([
    loadProjectConfig(cwd),
    readNativeAPISchema(cwd),
    swiftRegistrations(cwd),
  ]);
  return {
    schemaVersion: 1,
    framework: {
      version: CLI_VERSION,
      projectSchema: FIA_PROJECT_SCHEMA,
      nativeProtocol: FIA_NATIVE_PROTOCOL_VERSION,
      backendProtocol: FIA_BACKEND_PROTOCOL_VERSION,
    },
    app: {
      name: config.app.name,
      identifier: config.app.identifier,
      version: config.app.version,
      build: config.app.build,
      activationPolicy: config.app.activationPolicy,
    },
    runtimes: {
      swift: true,
      web: config.web.enabled,
      bun: config.backend.enabled,
      updater: config.updater !== undefined,
    },
    windows,
    nativeMethods: [
      "application.info",
      "application.quit",
      "clipboard.readText",
      "clipboard.writeText",
      "dialogs.openFiles",
      "dialogs.saveFile",
      "globalShortcuts.set",
      "keychain.delete",
      "keychain.get",
      "keychain.set",
      "native.capabilities",
      "notifications.deliver",
      "notifications.requestAuthorization",
      "resources.dispose",
      "screen.captureRegion",
      "screen.requestAuthorization",
      "screens.list",
      "system.openURL",
      "system.reveal",
      "windows.close",
      "windows.createWeb",
      "windows.focus",
      "windows.hide",
      "windows.open",
      "windows.state",
      ...api.methods.map((method) => method.name),
      ...(config.updater === undefined ? [] : ["updater.check"]),
    ].sort(),
    nativeEvents: [
      "globalShortcuts.pressed",
      "windows.changed",
      ...(config.updater === undefined ? [] : ["updater.stateChanged"]),
      ...api.events.map((event) => event.name),
    ].sort(),
    nativeErrors: api.errors.map((error) => ({ code: error.code, recoverable: error.recoverable })),
    permissions: config.native.permissions,
  };
}
