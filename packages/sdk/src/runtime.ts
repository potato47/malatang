import { z } from "zod";
import type { BackendPlugin, JSONValue, PluginContext, PluginMethod } from "./types";
export { z };
export type { BackendPlugin, PluginContext } from "./types";

export function defineMethod<T>(description: string, schema: z.ZodType<T>, handler: (input: T, context: PluginContext) => unknown | Promise<unknown>): PluginMethod {
  return {
    description,
    inputSchema: z.toJSONSchema(schema) as JSONValue,
    execute: (input, context) => handler(schema.parse(input), context),
  };
}

export function definePlugin(plugin: BackendPlugin): BackendPlugin { return plugin; }
