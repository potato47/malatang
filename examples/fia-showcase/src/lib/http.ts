import { FIAHostError, type FIARouteContext, type FIAServer } from "@semicoder/fia/backend";
import type { APIErrorPayload } from "../shared/contracts";

export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export async function jsonBody<T>(request: Request): Promise<T> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new AppError("INVALID_CONTENT_TYPE", "请求必须使用 application/json", 415);
  }
  try {
    return (await request.json()) as T;
  } catch {
    throw new AppError("INVALID_JSON", "请求内容不是有效的 JSON");
  }
}

export function requiredString(value: unknown, label: string, max = 2_048): string {
  if (typeof value !== "string") throw new AppError("INVALID_ARGUMENT", `${label} 必须是字符串`);
  const result = value.trim();
  if (result.length === 0 || result.length > max) {
    throw new AppError("INVALID_ARGUMENT", `${label} 长度必须在 1 到 ${max} 之间`);
  }
  return result;
}

export function optionalString(value: unknown, label: string, max = 2_048): string | undefined {
  return value === undefined || value === null ? undefined : requiredString(value, label, max);
}

export function json(value: unknown, init?: ResponseInit): Response {
  return Response.json(value, init);
}

export function errorResponse(error: unknown): Response {
  if (error instanceof AppError) {
    return Response.json(
      {
        error: { code: error.code, message: error.message, details: error.details },
      } satisfies APIErrorPayload,
      { status: error.status },
    );
  }
  if (error instanceof FIAHostError) {
    const status =
      error.code === "PERMISSION_DENIED"
        ? 403
        : error.code === "NOT_FOUND"
          ? 404
          : error.code === "CONFLICT"
            ? 409
            : 400;
    console.error(`Host API ${error.code}: ${error.message}`, error.details);
    const messages: Record<string, string> = {
      PERMISSION_DENIED: "系统权限不足，请在能力中心检查授权",
      NOT_FOUND: "请求的原生资源不存在或已失效",
      CONFLICT: "系统资源冲突，请关闭冲突应用或稍后重试",
      CANCELLED: "操作已取消",
      TIMEOUT: "系统操作超时，请重试",
      INVALID_ARGUMENT: "原生操作参数无效",
      UNSAFE_STATE: "应用当前状态不允许执行此操作",
    };
    return Response.json(
      {
        error: { code: error.code, message: messages[error.code] ?? "原生操作失败，请重试" },
      } satisfies APIErrorPayload,
      { status },
    );
  }
  console.error("Unhandled API error", error);
  return Response.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "内部操作失败，请重试；诊断信息已写入 Backend 日志",
      },
    } satisfies APIErrorPayload,
    { status: 500 },
  );
}

type APIHandler<WebSocketData, Path extends string> = (
  request: Bun.BunRequest<Path>,
  server: FIAServer<WebSocketData>,
  context: FIARouteContext,
) => Response | Promise<Response>;

export function api<WebSocketData = unknown, Path extends string = string>(
  handler: APIHandler<WebSocketData, Path>,
): APIHandler<WebSocketData, Path> {
  return async (request, server, context): Promise<Response> => {
    try {
      return await handler(request, server, context);
    } catch (error) {
      return errorResponse(error);
    }
  };
}
