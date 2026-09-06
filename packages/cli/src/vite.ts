export interface FIAVitePluginOptions {
  readonly nativeOrigin?: string;
  readonly backendMount?: string;
}

interface FIAWebSocketProxy {
  on(
    event: "proxyReqWs",
    listener: (
      proxyRequest: { setHeader(name: string, value: string): void },
      request: { headers: { readonly "user-agent"?: string } },
    ) => void,
  ): void;
}

interface FIAProxyOptions {
  readonly target: string;
  readonly changeOrigin: boolean;
  readonly ws?: boolean;
  readonly headers?: Record<string, string>;
  readonly configure?: (proxy: FIAWebSocketProxy) => void;
}

export interface FIAVitePlugin {
  readonly name: string;
  readonly enforce: "pre";
  config(): {
    server: {
      strictPort: boolean;
      proxy: Record<string, FIAProxyOptions>;
    };
  };
}

export default function fia(options: FIAVitePluginOptions = {}): FIAVitePlugin {
  const origin = options.nativeOrigin ?? process.env.FIA_NATIVE_ORIGIN ?? "http://127.0.0.1:0";
  const backendMount = options.backendMount ?? process.env.FIA_BACKEND_MOUNT ?? "/api";
  const token = process.env.FIA_NATIVE_SESSION;
  const headers = token === undefined ? undefined : { "x-fia-session": token };
  const target = {
    target: origin,
    changeOrigin: true,
    ...(headers === undefined ? {} : { headers }),
  };
  const nativeTarget = {
    ...target,
    ws: true,
    configure(proxy: FIAWebSocketProxy) {
      proxy.on("proxyReqWs", (request, incoming) => {
        request.setHeader(
          "x-fia-client-mode",
          incoming.headers["user-agent"]?.includes("FIA-WKWebView") === true
            ? "application"
            : "browserCompanion",
        );
      });
    },
  };
  return {
    name: "fia",
    enforce: "pre",
    config() {
      return {
        server: {
          strictPort: true,
          proxy: {
            "^/_fia(?:/|$|\\?)": nativeTarget,
            [`^${backendMount.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:/|$|\\?)`]: { ...target, ws: true },
          },
        },
      };
    },
  };
}
