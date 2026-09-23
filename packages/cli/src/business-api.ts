import { z } from "zod";
import type { BackendRouteContext } from "./backend.ts";
export { z };

export interface APIMethod {
  description: string;
  input: z.ZodType;
  output: z.ZodType;
  examples?: readonly { input: unknown; output?: unknown }[];
}
export interface APIEvent {
  description: string;
  payload: z.ZodType;
}
export interface APIContract {
  methods: Record<string, APIMethod>;
  events: Record<string, APIEvent>;
}
export interface APISchema {
  protocolVersion: 1;
  methods: Record<
    string,
    {
      description: string;
      input: Record<string, unknown>;
      output: Record<string, unknown>;
      examples?: APIMethod["examples"];
    }
  >;
  events: Record<string, { description: string; payload: Record<string, unknown> }>;
}
export interface CallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}
export interface APIClient<C extends APIContract = APIContract> {
  call<K extends keyof C["methods"] & string>(
    method: K,
    input: z.input<C["methods"][K]["input"]>,
    options?: CallOptions,
  ): Promise<z.output<C["methods"][K]["output"]>>;
  on<K extends keyof C["events"] & string>(
    event: K,
    listener: (payload: z.output<C["events"][K]["payload"]>) => void,
  ): () => void;
  onReconnect(listener: () => void): () => void;
  close(): void;
}
export interface InvocationContext<
  C extends APIContract = APIContract,
> extends BackendRouteContext {
  source: "ui" | "cli" | "script";
  requestId: string;
  sessionId: string;
  signal: AbortSignal;
  emit<K extends keyof C["events"] & string>(
    event: K,
    payload: z.input<C["events"][K]["payload"]>,
  ): void;
}
export type APIHandlers<C extends APIContract> = {
  [K in keyof C["methods"]]: (
    input: z.output<C["methods"][K]["input"]>,
    context: InvocationContext<C>,
  ) => z.input<C["methods"][K]["output"]> | Promise<z.input<C["methods"][K]["output"]>>;
};
export interface APIImplementation {
  contract: APIContract;
  handlers: Record<string, (input: never, context: InvocationContext) => unknown>;
}
export function defineAPI<
  const M extends Record<string, APIMethod>,
  const E extends Record<string, APIEvent> = Record<never, never>,
>(definition: { methods: M; events?: E }): { methods: M; events: E } {
  const contract = { ...definition, events: definition.events ?? ({} as E) };
  describeAPI(contract);
  return contract;
}
export function implementAPI<C extends APIContract>(
  contract: C,
  handlers: APIHandlers<C>,
): APIImplementation {
  for (const name of new Set([...Object.keys(contract.methods), ...Object.keys(handlers)])) {
    if (!Object.hasOwn(contract.methods, name) || typeof handlers[name] !== "function")
      throw new TypeError("API handler mismatch: " + name);
  }
  return { contract, handlers: handlers as APIImplementation["handlers"] };
}
export function describeAPI(contract: APIContract): APISchema {
  const name = (key: string, description: string) => {
    if (
      !/^[a-zA-Z][a-zA-Z0-9]*(?:[._-][a-zA-Z0-9]+)*$/u.test(key) ||
      key.length > 128 ||
      !description?.trim()
    )
      throw new TypeError("API names and descriptions are required: " + key);
  };
  return {
    protocolVersion: 1,
    methods: Object.fromEntries(
      Object.entries(contract.methods).map(([key, method]) => {
        name(key, method.description);
        const input = z.toJSONSchema(method.input, { io: "input", unrepresentable: "throw" });
        const output = z.toJSONSchema(method.output, { unrepresentable: "throw" });
        for (const example of method.examples ?? []) {
          assertJSON(example);
          method.input.parse(example.input);
          if (Object.hasOwn(example, "output")) method.output.parse(example.output);
        }
        return [
          key,
          {
            description: method.description,
            input,
            output,
            ...(method.examples ? { examples: method.examples } : {}),
          },
        ];
      }),
    ),
    events: Object.fromEntries(
      Object.entries(contract.events).map(([key, event]) => {
        name(key, event.description);
        return [
          key,
          {
            description: event.description,
            payload: z.toJSONSchema(event.payload, { unrepresentable: "throw" }),
          },
        ];
      }),
    ),
  };
}
export function assertJSON(value: unknown, seen = new Set<object>()): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  )
    return;
  if (typeof value !== "object" || seen.has(value))
    throw new TypeError("API values must be JSON serializable");
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    throw new TypeError("API values must be plain JSON");
  seen.add(value);
  for (const child of Array.isArray(value) ? value : Object.values(value)) assertJSON(child, seen);
  seen.delete(value);
}
