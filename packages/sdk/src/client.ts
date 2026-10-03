import type { HostBridge, JSONValue, ModelInfo, ModelRequest, ModelRun } from "./types";

export function createPluginClient(pluginId: string) {
  const bridge = (globalThis as typeof globalThis & { __MALATANG_BRIDGE__?: HostBridge }).__MALATANG_BRIDGE__;
  if (!bridge) throw new Error("This plugin must be opened in Malatang.");
  const call = <T>(method: string, input: unknown) => bridge.call(method, input) as Promise<T>;
  return {
    models: {
      list: () => call<ModelInfo[]>("models.list", {}),
      start: (input: ModelRequest) => call<ModelRun>("models.generate", { pluginId, ...input }),
    },
    runs: {
      list: () => call<ModelRun[]>("runs.list", { pluginId }),
      get: (runId: string) => call<ModelRun>("runs.get", { pluginId, runId }),
      cancel: (runId: string) => call<ModelRun>("runs.cancel", { pluginId, runId }),
      onChange: (listener: () => void) => bridge.on("runs.changed", (payload) => {
        if ((payload as { pluginId: string }).pluginId === pluginId) listener();
      }),
    },
    kv: {
      get: (key: string) => call<JSONValue | null>("kv.get", { pluginId, key }),
      set: (key: string, value: JSONValue) => call<null>("kv.set", { pluginId, key, value }),
      delete: (key: string) => call<null>("kv.delete", { pluginId, key }),
    },
    invoke: <T = JSONValue>(method: string, input: unknown) => call<T>("plugins.invoke", { pluginId, method, input }),
    onReconnect: bridge.onReconnect,
  };
}
