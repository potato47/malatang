export const FIA_CONFIG_VERSION = 1 as const;

export interface FIAAppConfig {
  name: string;
  identifier: string;
  version?: string;
  quitOnLastWindowClosed?: boolean;
}

export interface FIAWindowConfig {
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
}

export interface FIAConfig {
  configVersion: typeof FIA_CONFIG_VERSION;
  app: FIAAppConfig;
  entry?: string;
  window?: FIAWindowConfig;
}

export function defineConfig<const Configuration extends FIAConfig>(
  configuration: Configuration,
): Configuration {
  return configuration;
}
