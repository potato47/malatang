export const FIA_CONFIG_VERSION = 3 as const;

export type FIAApplicationMode = "dock" | "statusBar" | "hybrid";
export type FIAWindowCloseBehavior = "quit" | "hide";

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

export interface FIAMcpAppConfig {
  entry: string;
  watch?: readonly string[];
}

export interface FIAMcpExecutableConfig {
  executable: string;
  args?: readonly string[];
}

export interface FIAMcpConfig {
  app?: FIAMcpAppConfig;
  servers?: Readonly<Record<string, FIAMcpExecutableConfig>>;
}

export interface FIAConfig {
  configVersion: typeof FIA_CONFIG_VERSION;
  app: FIAAppConfig;
  ui?: string;
  window?: FIAWindowConfig;
  statusBar?: FIAStatusBarConfig;
  mcp?: FIAMcpConfig;
}

export function defineConfig<const Configuration extends FIAConfig>(
  configuration: Configuration,
): Configuration {
  return configuration;
}
