import { readFile } from "node:fs/promises";
import type { Plugin, ProxyOptions } from "vite";

/** Development-only proxy. Production HTTP is served directly by Bun. */
export default function fia(): Plugin {
  return {
    name: "fia",
    config() {
      const target = process.env.FIA_BACKEND_ORIGIN;
      const endpoint = process.env.FIA_BACKEND_ENDPOINT_FILE;
      const proxy = (): ProxyOptions => ({
        target,
        ws: true,
        changeOrigin: true,
        configure(_server, options) {
          if (!endpoint) return;
          // The host atomically republishes discovery after each Bun generation.
          options.bypass = async () => {
            const value = JSON.parse(await readFile(endpoint, "utf8")) as { origin: string };
            if (!/^http:\/\/127\.0\.0\.1:\d+$/u.test(value.origin))
              throw new Error("Invalid FIA backend endpoint");
            options.target = value.origin;
          };
        },
      });
      return {
        server: {
          host: "127.0.0.1",
          strictPort: true,
          ...(target
            ? {
                proxy: {
                  "^/api(?:/|$|\\?)": proxy(),
                  "^/_fia(?:/|$|\\?)": proxy(),
                },
              }
            : {}),
        },
      };
    },
  };
}
