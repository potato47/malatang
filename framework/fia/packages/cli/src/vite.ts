import { injectBrowserRuntime } from "./browser-assets.ts";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import type { Plugin, ProxyOptions } from "vite";

/** Development-only proxy. Production HTTP is served directly by Bun. */
export default function fia(): Plugin {
  return {
    name: "fia",
    transformIndexHtml: { order: "pre", handler: injectBrowserRuntime },
    async config(config, environment) {
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
      // file: installs can replace the SDK without changing the lockfile. Include
      // its actual contents in Vite's optimizer hash and browser module URLs.
      const require = createRequire(resolve(config.root ?? process.cwd(), "package.json"));
      const revision = createHash("sha256");
      if (environment.command === "serve") {
        const client = require.resolve("@semicoder/fia/client");
        // api has an import-only export, so resolve its sibling build artifact
        // instead of selecting the CommonJS condition with require.resolve.
        for (const entry of [client, resolve(dirname(client), "business-api.js")])
          revision.update(await readFile(entry));
      }
      return {
        ...(environment.command === "serve"
          ? {
              optimizeDeps: {
                esbuildOptions: {
                  define: { __FIA_SDK_REVISION__: JSON.stringify(revision.digest("hex")) },
                },
              },
            }
          : {}),
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
