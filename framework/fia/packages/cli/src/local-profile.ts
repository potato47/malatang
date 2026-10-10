import { resolve } from "node:path";
import type { ResolvedFIAConfig } from "./project-config.ts";

export type LocalMode = "development" | "preview";

/** Keep the logical identifier/data keys stable; only the macOS bundle identity changes. */
export function localProfile(config: ResolvedFIAConfig, mode: LocalMode) {
  const suffix = mode === "development" ? "dev" : "preview";
  const label = mode === "development" ? "Dev" : "Preview";
  return {
    mode,
    label,
    badge: mode === "development" ? "DEV" : "PREV",
    bundleIdentifier: `${config.app.identifier}.${suffix}`,
    directory: resolve(config.projectRoot, ".fia", suffix),
    dataRoot: resolve(config.projectRoot, ".fia", suffix, "data"),
    config: {
      ...config,
      app: { ...config.app, name: `${config.app.name} ${label}` },
      agent: { ...config.agent, command: `${config.agent.command}-${suffix}` },
      updates: undefined,
    },
  };
}
