// Generated from the application's API contract.

export namespace Method0InputTypes {
export interface Method0Input {}

}
export namespace Method0OutputTypes {
export interface Method0Output {
  theme: "system" | "light" | "dark";
}

}
export namespace Method1InputTypes {
export interface Method1Input {
  theme: "system" | "light" | "dark";
}

}
export namespace Method1OutputTypes {
export interface Method1Output {
  theme: "system" | "light" | "dark";
}

}
export namespace Method2InputTypes {
export interface Method2Input {}

}
export namespace Method2OutputTypes {
export interface Method2Output {
  available: boolean;
  activeProfileId: string | null;
  profiles: {
    id: string;
    label: string;
    email: string | null;
    connected: boolean;
    sharing: boolean;
    welcomeSeen: boolean;
    incomplete: boolean;
    removalBlockedReason: string | null;
  }[];
  attempt: {
    id: string;
    profileId: string | null;
    stage: "waiting" | "exchanging" | "completed" | "failed" | "cancelled";
    message: string;
  } | null;
  message: string;
}

}
export namespace Method3InputTypes {
export interface Method3Input {
  profileId?: string;
  consent?: boolean;
}

}
export namespace Method3OutputTypes {
export interface Method3Output {
  available: boolean;
  activeProfileId: string | null;
  profiles: {
    id: string;
    label: string;
    email: string | null;
    connected: boolean;
    sharing: boolean;
    welcomeSeen: boolean;
    incomplete: boolean;
    removalBlockedReason: string | null;
  }[];
  attempt: {
    id: string;
    profileId: string | null;
    stage: "waiting" | "exchanging" | "completed" | "failed" | "cancelled";
    message: string;
  } | null;
  message: string;
}

}
export namespace Method4InputTypes {
export interface Method4Input {
  id: string;
}

}
export namespace Method4OutputTypes {
export interface Method4Output {
  available: boolean;
  activeProfileId: string | null;
  profiles: {
    id: string;
    label: string;
    email: string | null;
    connected: boolean;
    sharing: boolean;
    welcomeSeen: boolean;
    incomplete: boolean;
    removalBlockedReason: string | null;
  }[];
  attempt: {
    id: string;
    profileId: string | null;
    stage: "waiting" | "exchanging" | "completed" | "failed" | "cancelled";
    message: string;
  } | null;
  message: string;
}

}
export namespace Method5InputTypes {
export interface Method5Input {
  profileId: string;
}

}
export namespace Method5OutputTypes {
export interface Method5Output {
  available: boolean;
  activeProfileId: string | null;
  profiles: {
    id: string;
    label: string;
    email: string | null;
    connected: boolean;
    sharing: boolean;
    welcomeSeen: boolean;
    incomplete: boolean;
    removalBlockedReason: string | null;
  }[];
  attempt: {
    id: string;
    profileId: string | null;
    stage: "waiting" | "exchanging" | "completed" | "failed" | "cancelled";
    message: string;
  } | null;
  message: string;
}

}
export namespace Method6InputTypes {
export interface Method6Input {
  profileId: string;
  label: string;
}

}
export namespace Method6OutputTypes {
export interface Method6Output {
  available: boolean;
  activeProfileId: string | null;
  profiles: {
    id: string;
    label: string;
    email: string | null;
    connected: boolean;
    sharing: boolean;
    welcomeSeen: boolean;
    incomplete: boolean;
    removalBlockedReason: string | null;
  }[];
  attempt: {
    id: string;
    profileId: string | null;
    stage: "waiting" | "exchanging" | "completed" | "failed" | "cancelled";
    message: string;
  } | null;
  message: string;
}

}
export namespace Method7InputTypes {
export interface Method7Input {
  /**
   * @minItems 1
   * @maxItems 10
   */
  profileIds:
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string]
    | [string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string];
}

}
export namespace Method7OutputTypes {
export interface Method7Output {
  available: boolean;
  activeProfileId: string | null;
  profiles: {
    id: string;
    label: string;
    email: string | null;
    connected: boolean;
    sharing: boolean;
    welcomeSeen: boolean;
    incomplete: boolean;
    removalBlockedReason: string | null;
  }[];
  attempt: {
    id: string;
    profileId: string | null;
    stage: "waiting" | "exchanging" | "completed" | "failed" | "cancelled";
    message: string;
  } | null;
  message: string;
}

}
export namespace Method8InputTypes {
export interface Method8Input {
  profileId: string;
}

}
export namespace Method8OutputTypes {
export interface Method8Output {
  available: boolean;
  activeProfileId: string | null;
  profiles: {
    id: string;
    label: string;
    email: string | null;
    connected: boolean;
    sharing: boolean;
    welcomeSeen: boolean;
    incomplete: boolean;
    removalBlockedReason: string | null;
  }[];
  attempt: {
    id: string;
    profileId: string | null;
    stage: "waiting" | "exchanging" | "completed" | "failed" | "cancelled";
    message: string;
  } | null;
  message: string;
}

}
export namespace Method9InputTypes {
export interface Method9Input {
  profileId: string;
}

}
export namespace Method9OutputTypes {
export interface Method9Output {
  available: boolean;
  activeProfileId: string | null;
  profiles: {
    id: string;
    label: string;
    email: string | null;
    connected: boolean;
    sharing: boolean;
    welcomeSeen: boolean;
    incomplete: boolean;
    removalBlockedReason: string | null;
  }[];
  attempt: {
    id: string;
    profileId: string | null;
    stage: "waiting" | "exchanging" | "completed" | "failed" | "cancelled";
    message: string;
  } | null;
  message: string;
}

}
export namespace Method10InputTypes {
export interface Method10Input {
  profileId: string;
}

}
export namespace Method10OutputTypes {
export type Method10Output = {
  id: string;
  name: string;
}[];

}
export namespace Method11InputTypes {
export interface Method11Input {
  profileId: string;
  modelId: string;
}

}
export namespace Method11OutputTypes {
export interface Method11Output {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseURL: string;
  kind: "openai-compatible" | "pi" | "chatgpt";
  configured: boolean;
  preset: string | null;
  hasApiKey: boolean;
  chatgptProfileId?: string;
  options: {
    [k: string]: string;
  };
}

}
export namespace Method12InputTypes {
export interface Method12Input {}

}
export namespace Method12OutputTypes {
export type Method12Output = null;

}
export namespace Method13InputTypes {
export interface Method13Input {}

}
export namespace Method13OutputTypes {
export type Method13Output = {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseURL: string;
  kind: "openai-compatible" | "pi" | "chatgpt";
  configured: boolean;
  preset: string | null;
  hasApiKey: boolean;
  chatgptProfileId?: string;
  options: {
    [k: string]: string;
  };
}[];

}
export namespace Method14InputTypes {
export interface Method14Input {}

}
export namespace Method14OutputTypes {
export type Method14Output = {
  id: string;
  name: string;
  modelCount: number;
  apiKeySupported: boolean;
  keyLabel: string;
  notice: string;
  fields: {
    key: string;
    label: string;
    placeholder: string;
    required: boolean;
  }[];
}[];

}
export namespace Method15InputTypes {
export interface Method15Input {
  providerId: string;
}

}
export namespace Method15OutputTypes {
export type Method15Output = {
  id: string;
  name: string;
  api: string;
  baseURL: string;
  contextWindow: number;
  reasoning: boolean;
}[];

}
export namespace Method16InputTypes {
export interface Method16Input {
  id?: string;
  name: string;
  provider: string;
  model: string;
  baseURL: string;
  apiKey?: string;
  clearApiKey?: boolean;
  preset?: string | null;
  options?: {
    [k: string]: string;
  };
}

}
export namespace Method16OutputTypes {
export interface Method16Output {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseURL: string;
  kind: "openai-compatible" | "pi" | "chatgpt";
  configured: boolean;
  preset: string | null;
  hasApiKey: boolean;
  chatgptProfileId?: string;
  options: {
    [k: string]: string;
  };
}

}
export namespace Method17InputTypes {
export interface Method17Input {
  id: string;
}

}
export namespace Method17OutputTypes {
export type Method17Output = null;

}
export namespace Method18InputTypes {
export interface Method18Input {
  pluginId: string;
  modelId: string;
  prompt: string;
  system?: string;
  title?: string;
}

}
export namespace Method18OutputTypes {
export interface Method18Output {
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

}
export namespace Method19InputTypes {
export interface Method19Input {
  pluginId: string;
}

}
export namespace Method19OutputTypes {
export type Method19Output = {
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
}[];

}
export namespace Method20InputTypes {
export interface Method20Input {
  pluginId: string;
  runId: string;
}

}
export namespace Method20OutputTypes {
export interface Method20Output {
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

}
export namespace Method21InputTypes {
export interface Method21Input {
  pluginId: string;
  runId: string;
}

}
export namespace Method21OutputTypes {
export interface Method21Output {
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

}
export namespace Method22InputTypes {
export interface Method22Input {}

}
export namespace Method22OutputTypes {
export type _Schema0 =
  | string
  | number
  | boolean
  | null
  | _Schema0[]
  | {
      [k: string]: _Schema0;
    };
export type Method22Output = {
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
  keepAlive: boolean;
  methods: {
    name: string;
    description: string;
    inputSchema: _Schema0;
  }[];
}[];

}
export namespace Method23InputTypes {
export type _Schema0 =
  | string
  | number
  | boolean
  | null
  | _Schema0[]
  | {
      [k: string]: _Schema0;
    };

export interface Method23Input {
  pluginId: string;
  method: string;
  input: _Schema0;
}

}
export namespace Method23OutputTypes {
export type Method23Output =
  | string
  | number
  | boolean
  | null
  | Method23Output[]
  | {
      [k: string]: Method23Output;
    };

}
export namespace Method24InputTypes {
export interface Method24Input {
  source: string;
}

}
export namespace Method24OutputTypes {
export interface Method24Output {
  id: string;
  source: string;
  status: "installing" | "completed" | "failed";
  message: string;
  pluginId: string | null;
  createdAt: number;
}

}
export namespace Method25InputTypes {
export interface Method25Input {}

}
export namespace Method25OutputTypes {
export interface Method25Output {
  id: string;
  source: string;
  status: "installing" | "completed" | "failed";
  message: string;
  pluginId: string | null;
  createdAt: number;
}

}
export namespace Method26InputTypes {
export interface Method26Input {}

}
export namespace Method26OutputTypes {
export type Method26Output = {
  id: string;
  source: string;
  status: "installing" | "completed" | "failed";
  message: string;
  pluginId: string | null;
  createdAt: number;
}[];

}
export namespace Method27InputTypes {
export interface Method27Input {
  pluginId: string;
  enabled: boolean;
}

}
export namespace Method27OutputTypes {
export type _Schema0 =
  | string
  | number
  | boolean
  | null
  | _Schema0[]
  | {
      [k: string]: _Schema0;
    };

export interface Method27Output {
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
  keepAlive: boolean;
  methods: {
    name: string;
    description: string;
    inputSchema: _Schema0;
  }[];
}

}
export namespace Method28InputTypes {
export interface Method28Input {
  pluginId: string;
}

}
export namespace Method28OutputTypes {
export type Method28Output = null;

}
export namespace Method29InputTypes {
export interface Method29Input {
  pluginId: string;
  key: string;
}

}
export namespace Method29OutputTypes {
export type Method29Output =
  | string
  | number
  | boolean
  | null
  | Method29Output[]
  | {
      [k: string]: Method29Output;
    };

}
export namespace Method30InputTypes {
export type _Schema0 =
  | string
  | number
  | boolean
  | null
  | _Schema0[]
  | {
      [k: string]: _Schema0;
    };

export interface Method30Input {
  pluginId: string;
  key: string;
  value: _Schema0;
}

}
export namespace Method30OutputTypes {
export type Method30Output = null;

}
export namespace Method31InputTypes {
export interface Method31Input {
  pluginId: string;
  key: string;
}

}
export namespace Method31OutputTypes {
export type Method31Output = null;

}
export namespace Event32Types {
export interface Event32 {
  theme: "system" | "light" | "dark";
}

}
export namespace Event33Types {
export interface Event33 {
  pluginId: string;
  runId: string;
  revision: number;
  status: "running" | "completed" | "cancelled" | "failed";
}

}
export namespace Event34Types {
export interface Event34 {
  revision: number;
}

}
export namespace Event35Types {
export interface Event35 {
  revision: number;
}

}
export namespace Event36Types {
export interface Event36 {
  revision: number;
}

}
export interface FIAApplication {
call(method: "appearance.get", input: Method0InputTypes.Method0Input, options?: {signal?: AbortSignal; timeoutMs?: number}): Promise<Method0OutputTypes.Method0Output>;
call(method: "appearance.set", input: Method1InputTypes.Method1Input, options?: {signal?: AbortSignal; timeoutMs?: number}): Promise<Method1OutputTypes.Method1Output>;
call(method: "chatgpt.status", input: Method2InputTypes.Method2Input, options?: {signal?: AbortSignal; timeoutMs?: number}): Promise<Method2OutputTypes.Method2Output>;
call(method: "chatgpt.signIn", input: Method3InputTypes.Method3Input, options?: {signal?: AbortSignal; timeoutMs?: number}): Promise<Method3OutputTypes.Method3Output>;
call(method: "chatgpt.cancel", input: Method4InputTypes.Method4Input, options?: {signal?: AbortSignal; timeoutMs?: number}): Promise<Method4OutputTypes.Method4Output>;
call(method: "chatgpt.select", input: Method5InputTypes.Method5Input, options?: {signal?: AbortSignal; timeoutMs?: number}): Promise<Method5OutputTypes.Method5Output>;
call(method: "chatgpt.rename", input: Method6InputTypes.Method6Input, options?: {signal?: AbortSignal; timeoutMs?: number}): Promise<Method6OutputTypes.Method6Output>;
call(method: "chatgpt.remove", input: Method7InputTypes.Method7Input, options?: {signal?: AbortSignal; timeoutMs?: number}): Promise<Method7OutputTypes.Method7Output>;
call(method: "chatgpt.signOut", input: Method8InputTypes.Method8Input, options?: {signal?: AbortSignal; timeoutMs?: number}): Promise<Method8OutputTypes.Method8Output>;
call(method: "chatgpt.acknowledge", input: Method9InputTypes.Method9Input, options?: {signal?: AbortSignal; timeoutMs?: number}): Promise<Method9OutputTypes.Method9Output>;
call(method: "chatgpt.catalog", input: Method10InputTypes.Method10Input, options?: {signal?: AbortSignal; timeoutMs?: number}): Promise<Method10OutputTypes.Method10Output>;
call(method: "chatgpt.addModel", input: Method11InputTypes.Method11Input, options?: {signal?: AbortSignal; timeoutMs?: number}): Promise<Method11OutputTypes.Method11Output>;
call(method: "chatgpt.manageUsage", input: Method12InputTypes.Method12Input, options?: {signal?: AbortSignal; timeoutMs?: number}): Promise<Method12OutputTypes.Method12Output>;
call(method: "models.list", input: Method13InputTypes.Method13Input, options?: {signal?: AbortSignal; timeoutMs?: number}): Promise<Method13OutputTypes.Method13Output>;
call(method: "models.providers", input: Method14InputTypes.Method14Input, options?: {signal?: AbortSignal; timeoutMs?: number}): Promise<Method14OutputTypes.Method14Output>;
call(method: "models.catalog", input: Method15InputTypes.Method15Input, options?: {signal?: AbortSignal; timeoutMs?: number}): Promise<Method15OutputTypes.Method15Output>;
call(method: "models.save", input: Method16InputTypes.Method16Input, options?: {signal?: AbortSignal; timeoutMs?: number}): Promise<Method16OutputTypes.Method16Output>;
call(method: "models.remove", input: Method17InputTypes.Method17Input, options?: {signal?: AbortSignal; timeoutMs?: number}): Promise<Method17OutputTypes.Method17Output>;
call(method: "models.generate", input: Method18InputTypes.Method18Input, options?: {signal?: AbortSignal; timeoutMs?: number}): Promise<Method18OutputTypes.Method18Output>;
call(method: "runs.list", input: Method19InputTypes.Method19Input, options?: {signal?: AbortSignal; timeoutMs?: number}): Promise<Method19OutputTypes.Method19Output>;
call(method: "runs.get", input: Method20InputTypes.Method20Input, options?: {signal?: AbortSignal; timeoutMs?: number}): Promise<Method20OutputTypes.Method20Output>;
call(method: "runs.cancel", input: Method21InputTypes.Method21Input, options?: {signal?: AbortSignal; timeoutMs?: number}): Promise<Method21OutputTypes.Method21Output>;
call(method: "plugins.list", input: Method22InputTypes.Method22Input, options?: {signal?: AbortSignal; timeoutMs?: number}): Promise<Method22OutputTypes.Method22Output>;
call(method: "plugins.invoke", input: Method23InputTypes.Method23Input, options?: {signal?: AbortSignal; timeoutMs?: number}): Promise<Method23OutputTypes.Method23Output>;
call(method: "plugins.install", input: Method24InputTypes.Method24Input, options?: {signal?: AbortSignal; timeoutMs?: number}): Promise<Method24OutputTypes.Method24Output>;
call(method: "plugins.installExample", input: Method25InputTypes.Method25Input, options?: {signal?: AbortSignal; timeoutMs?: number}): Promise<Method25OutputTypes.Method25Output>;
call(method: "plugins.jobs", input: Method26InputTypes.Method26Input, options?: {signal?: AbortSignal; timeoutMs?: number}): Promise<Method26OutputTypes.Method26Output>;
call(method: "plugins.setEnabled", input: Method27InputTypes.Method27Input, options?: {signal?: AbortSignal; timeoutMs?: number}): Promise<Method27OutputTypes.Method27Output>;
call(method: "plugins.uninstall", input: Method28InputTypes.Method28Input, options?: {signal?: AbortSignal; timeoutMs?: number}): Promise<Method28OutputTypes.Method28Output>;
call(method: "kv.get", input: Method29InputTypes.Method29Input, options?: {signal?: AbortSignal; timeoutMs?: number}): Promise<Method29OutputTypes.Method29Output>;
call(method: "kv.set", input: Method30InputTypes.Method30Input, options?: {signal?: AbortSignal; timeoutMs?: number}): Promise<Method30OutputTypes.Method30Output>;
call(method: "kv.delete", input: Method31InputTypes.Method31Input, options?: {signal?: AbortSignal; timeoutMs?: number}): Promise<Method31OutputTypes.Method31Output>;
on(event: "appearance.changed", listener: (payload: Event32Types.Event32) => void, options?: {match?: Readonly<Record<string, string | number | boolean | null>>}): () => void;
on(event: "runs.changed", listener: (payload: Event33Types.Event33) => void, options?: {match?: Readonly<Record<string, string | number | boolean | null>>}): () => void;
on(event: "plugins.changed", listener: (payload: Event34Types.Event34) => void, options?: {match?: Readonly<Record<string, string | number | boolean | null>>}): () => void;
on(event: "chatgpt.changed", listener: (payload: Event35Types.Event35) => void, options?: {match?: Readonly<Record<string, string | number | boolean | null>>}): () => void;
on(event: "models.changed", listener: (payload: Event36Types.Event36) => void, options?: {match?: Readonly<Record<string, string | number | boolean | null>>}): () => void;
onReconnect(listener: () => void): () => void;
close(): void;
}
declare global { const app: FIAApplication; function help(name?: string): string; }
