/** Context passed to an application command's default-exported async function. */
export interface FIACommandContext {
  args: string[];
  cwd: string;
  /** Backend asset root: project root in development, bundled backend in production. */
  assetsDirectory: string;
}

/** Build settings only. Window behavior belongs in the Bun backend. */
export interface FIAConfig {
  app: { name: string; identifier: string; version: string; build: number; icon?: string };
  api?: { entry?: string };
  agent: {
    command: string;
    description: string;
    instructions?: string;
    commands?: Readonly<Record<string, { description: string; entry: string }>>;
  };
  backend?: { entry?: string; assets?: readonly string[] };
  web?: { root?: string; dist?: string };
  permissions?: Readonly<Record<string, string>>;
  statusItem?: { symbol: string; tooltip?: string };
  updates?: { url: string; publicKey: string; downloadURL?: string };
  signing?: {
    developmentIdentity?: string;
    releaseIdentity?: string;
    notarizationProfile?: string;
  };
}

export function defineConfig(config: FIAConfig): FIAConfig {
  return config;
}
