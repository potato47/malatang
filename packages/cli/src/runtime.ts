const FIA_APPLICATION_MARKER = Symbol.for("dev.fia.application");

export interface FIABackendContext {
  readonly dataDirectory: string;
  readonly requestID: string;
  readonly signal: AbortSignal;
  emit(name: string, payload: unknown): Promise<void>;
}

export type FIABackendMethod = (
  input: any,
  context: FIABackendContext,
) => unknown | Promise<unknown>;

export interface FIABackendDefinition {
  readonly methods: Readonly<Record<string, FIABackendMethod>>;
}

export class BackendApplicationError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "BackendApplicationError";
    this.code = code;
    this.details = details;
  }
}

export type FIARouteHandler<WebSocketData = undefined> = (
  request: Bun.BunRequest<string>,
  server: Bun.Server<WebSocketData>,
) => Response | void | undefined | Promise<Response | void | undefined>;

export type FIARoute<WebSocketData = undefined> =
  | Response
  | FIARouteHandler<WebSocketData>
  | Partial<Record<Bun.Serve.HTTPMethod, Response | FIARouteHandler<WebSocketData>>>;

export interface FIAApplication<WebSocketData = undefined> {
  readonly backend?: FIABackendDefinition;
  readonly routes?: Readonly<Record<string, FIARoute<WebSocketData>>>;
  readonly fetch?: FIARouteHandler<WebSocketData>;
  readonly websocket?: Bun.WebSocketHandler<WebSocketData>;
}

export type DefinedFIAApplication<WebSocketData = undefined> = FIAApplication<WebSocketData> & {
  readonly [FIA_APPLICATION_MARKER]: true;
};

export function defineApp<const Application extends FIAApplication>(
  application: Application,
): Application & DefinedFIAApplication {
  if (typeof application !== "object" || application === null || Array.isArray(application)) {
    throw new TypeError("defineApp expects an application object");
  }
  Object.defineProperty(application, FIA_APPLICATION_MARKER, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
  return application as Application & DefinedFIAApplication;
}

export function isFIAApplication(value: unknown): value is DefinedFIAApplication {
  return typeof value === "object"
    && value !== null
    && (value as Record<PropertyKey, unknown>)[FIA_APPLICATION_MARKER] === true;
}
