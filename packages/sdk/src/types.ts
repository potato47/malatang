export type JSONValue = null | boolean | number | string | JSONValue[] | { [key: string]: JSONValue };

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseURL: string;
  kind: "demo" | "openai-compatible";
  configured: boolean;
}

export interface ModelRequest {
  modelId: string;
  prompt: string;
  system?: string;
  title?: string;
}

export interface ModelRun {
  id: string;
  pluginId: string;
  modelId: string;
  title: string;
  input: string;
  output: string;
  status: "running" | "completed" | "cancelled" | "failed";
  error: string | null;
  createdAt: number;
  updatedAt: number;
  revision: number;
  demo: boolean;
}

export interface PluginManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  sdkVersion: "0.1";
  frontend: string;
  backend?: string;
  styles?: string;
}

export interface PluginInfo {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  version: string;
  packageName: string;
  source: string;
  builtin: boolean;
  enabled: boolean;
  status: "active" | "disabled" | "error";
  error: string | null;
  clientURL: string;
  styleURL: string | null;
  methods: { name: string; description: string; inputSchema: JSONValue }[];
}

export interface InstallJob {
  id: string;
  source: string;
  status: "installing" | "completed" | "failed";
  message: string;
  pluginId: string | null;
  createdAt: number;
}

export interface PluginContext {
  readonly pluginId: string;
  models: { list(): ModelInfo[]; start(input: ModelRequest): Promise<ModelRun> };
  kv: { get(key: string): JSONValue | null; set(key: string, value: JSONValue): Promise<void>; delete(key: string): Promise<void> };
}

export interface PluginMethod {
  description: string;
  inputSchema: JSONValue;
  execute(input: unknown, context: PluginContext): unknown | Promise<unknown>;
}

export interface BackendPlugin {
  methods: Record<string, PluginMethod>;
  activate?(context: PluginContext): void | Promise<void>;
  dispose?(): void | Promise<void>;
}

export interface HostBridge {
  call(method: string, input: unknown): Promise<unknown>;
  on(event: string, listener: (payload: unknown) => void): () => void;
  onReconnect(listener: () => void): () => void;
}
