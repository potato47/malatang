export const FIA_CONFIG_VERSION = 2 as const;

export type FIAApplicationMode = "dock" | "statusBar" | "hybrid";
export type FIAWindowCloseBehavior = "quit" | "hide";
export type FIARuntimeMode = "bun" | "none" | "swift";

export interface FIASwiftConfig {
  package: string;
  product: string;
}

export interface FIAAppConfig {
  name: string;
  identifier: string;
  version?: string;
  mode?: FIAApplicationMode;
  icon?: string;
}

export interface FIAWindowConfig {
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  closeBehavior?: FIAWindowCloseBehavior;
  restoreState?: boolean;
  alwaysOnTop?: boolean;
  visibleOnAllSpaces?: boolean;
  visibleOverFullScreen?: boolean;
}

export interface FIAStatusBarConfig {
  symbol?: string;
  tooltip?: string;
}

export interface FIAConfig {
  configVersion: typeof FIA_CONFIG_VERSION;
  app: FIAAppConfig;
  runtime?: FIARuntimeMode;
  swift?: FIASwiftConfig;
  entry?: string;
  ui?: string;
  window?: FIAWindowConfig;
  statusBar?: FIAStatusBarConfig;
}

export function defineConfig<const Configuration extends FIAConfig>(
  configuration: Configuration,
): Configuration {
  return configuration;
}
