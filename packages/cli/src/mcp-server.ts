import { McpServer, Server, type McpRequestContext } from "@modelcontextprotocol/server";

const FIA_MCP_FACTORY = Symbol.for("@semicoder/fia/mcp-server-factory");

export type FIAMcpServer = McpServer | Server;
export type FIAMcpServerFactory = ((context: McpRequestContext) => FIAMcpServer) & {
  readonly [FIA_MCP_FACTORY]: true;
};

export function defineMcpServer(
  factory: (context: McpRequestContext) => FIAMcpServer,
): FIAMcpServerFactory {
  if (typeof factory !== "function") {
    throw new TypeError("defineMcpServer expects a synchronous MCP server factory");
  }
  Object.defineProperty(factory, FIA_MCP_FACTORY, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: true,
  });
  return factory as FIAMcpServerFactory;
}

export function isDefinedMcpServer(value: unknown): value is FIAMcpServerFactory {
  return (
    typeof value === "function" && (value as Partial<FIAMcpServerFactory>)[FIA_MCP_FACTORY] === true
  );
}

export { McpServer, Server };
export type { McpRequestContext };
export { serveStdio } from "@modelcontextprotocol/server/stdio";
