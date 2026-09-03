export const FIA_CONFIG_VERSION = 6 as const;

export interface FIAAppConfig {
  name: string;
  identifier: string;
  version?: string;
  icon?: string;
}

export interface FIABackendConfig {
  entry: string;
  watch?: readonly string[];
}

export interface FIAStatusBarConfig {
  symbol?: string;
  tooltip?: string;
}

export interface FIAHostConfig {
  executable: string;
  name: string;
}

export interface FIAHelperConfig {
  executable: string;
  name: string;
}

export interface FIASigningConfig {
  identity: string;
}

export interface FIAReleaseConfig {
  identity: string;
  notarization?: {
    keychainProfile: string;
  };
}

export interface FIAConfig {
  configVersion: typeof FIA_CONFIG_VERSION;
  app: FIAAppConfig;
  backend: FIABackendConfig;
  host?: FIAHostConfig;
  helpers?: readonly FIAHelperConfig[];
  statusBar?: FIAStatusBarConfig;
  signing?: FIASigningConfig;
  release?: FIAReleaseConfig;
}

export function defineConfig<const Configuration extends FIAConfig>(
  configuration: Configuration,
): Configuration {
  return configuration;
}
