import { z } from "zod";
import type { BackendRouteContext } from "./backend.ts";
export { z };
import { assertJSON, type EventOptions } from "./api-values.ts";
export { assertJSON } from "./api-values.ts";
export type { EventOptions, JSONScalar } from "./api-values.ts";

/** Request and response JSON envelopes each have a 1 MiB UTF-8 limit. Use pagination for large results. */
export interface APIMethod {
  description: string;
  input: z.ZodType;
  output: z.ZodType;
  examples?: readonly { input: unknown; output?: unknown }[];
}
/** Each encoded event frame is limited to 1 MiB; delivery is live-only, without replay. */
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
    options?: EventOptions,
  ): () => void;
  onReconnect(listener: () => void): () => void;
  close(): void;
}
export interface InvocationContext<
  C extends APIContract = APIContract,
> extends BackendRouteContext<C> {
  source: "ui" | "cli" | "script";
  requestId: string;
  sessionId: string;
  signal: AbortSignal;
}
export interface APIEmitter<C extends APIContract = APIContract> {
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
export interface APIImplementation<C extends APIContract = APIContract> {
  contract: C;
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
): APIImplementation<C> {
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
  const schema = (value: z.ZodType, path: string, io: "input" | "output" = "output") => {
    try {
      return z.toJSONSchema(value, { io, unrepresentable: "throw" });
    } catch (error) {
      throw new TypeError(
        `Invalid API schema at ${path}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  };
  return {
    protocolVersion: 1,
    methods: Object.fromEntries(
      Object.entries(contract.methods).map(([key, method]) => {
        name(key, method.description);
        const input = schema(method.input, `methods.${key}.input`, "input");
        const output = schema(method.output, `methods.${key}.output`);
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
            payload: schema(event.payload, `events.${key}.payload`),
          },
        ];
      }),
    ),
  };
}
