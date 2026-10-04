import { mkdir, rename, chmod } from "node:fs/promises";
import { join } from "node:path";
import { z } from "@semicoder/fia/api";
import { run, themeMode } from "../shared/api";
import type { JSONValue } from "@semicoder/malatang-sdk/types";
import { migratePresetModel } from "./model-migrations";

const stateSchema = z.object({
  version: z.literal(1),
  theme: themeMode.default("system"),
  models: z.array(z.object({ id: z.string(), name: z.string(), provider: z.string(), model: z.string(), baseURL: z.string(), apiKey: z.string(), preset: z.string().nullable().default(null), chatgptProfileId: z.string().optional(), options: z.record(z.string(), z.string()).default({}) })),
  plugins: z.array(z.object({ id: z.string(), root: z.string(), installation: z.string(), source: z.string() })),
  disabled: z.array(z.string()),
  kv: z.record(z.string(), z.record(z.string(), z.json())),
  runs: z.array(run),
});
export type State = z.infer<typeof stateSchema>;
export type ModelConfig = State["models"][number];

/** One serial writer: persist an immutable candidate before making it visible. */
export class Store {
  private state: State = { version: 1, theme: "system", models: [], plugins: [], disabled: [], kv: {}, runs: [] };
  private queue: Promise<unknown> = Promise.resolve();
  constructor(readonly directory: string) {}
  get value(): Readonly<State> { return this.state; }
  async open() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const file = Bun.file(join(this.directory, "platform.json"));
    if (await file.exists()) this.state = stateSchema.parse(await file.json());
    await this.update(state => {
      for (const model of state.models) migratePresetModel(model);
      for (const item of state.runs) if (item.status === "running") {
        item.status = "failed";
        item.error = "应用已重新启动，此次运行已中断。可以重新发起。";
        item.updatedAt = Date.now();
        item.revision++;
      }
    });
  }
  update<T>(change: (candidate: State) => T): Promise<T> {
    const result = this.queue.then(async () => {
      const candidate = structuredClone(this.state);
      const result = change(candidate);
      const path = join(this.directory, "platform.json");
      await Bun.write(path + ".tmp", JSON.stringify(candidate));
      await chmod(path + ".tmp", 0o600);
      await rename(path + ".tmp", path);
      this.state = candidate;
      return result;
    });
    this.queue = result.catch(() => {});
    return result;
  }
  get(pluginId: string, key: string): JSONValue | null { const items = Object.hasOwn(this.state.kv, pluginId) ? this.state.kv[pluginId] : undefined; return items && Object.hasOwn(items, key) ? structuredClone(items[key]!) : null; }
  async set(pluginId: string, key: string, value: JSONValue) {
    if (Buffer.byteLength(JSON.stringify(value)) > 64 * 1024) throw new Error("单个存储值不能超过 64 KiB");
    await this.update(state => {
      const items = Object.hasOwn(state.kv, pluginId) ? state.kv[pluginId]! : {};
      Object.defineProperty(items, key, { value, writable: true, configurable: true, enumerable: true });
      Object.defineProperty(state.kv, pluginId, { value: items, writable: true, configurable: true, enumerable: true });
    });
  }
  async delete(pluginId: string, key: string) {
    await this.update(state => { if (Object.hasOwn(state.kv, pluginId)) delete state.kv[pluginId][key]; });
  }
}
