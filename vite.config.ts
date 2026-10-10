import { resolve } from "node:path";
import { buildUIStyles } from "./packages/sdk/styles";
import { defineConfig, type Plugin } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fia from "@semicoder/fia/vite";
export default defineConfig({
  root: "frontend",
  plugins: [sdkStyles(), tailwindcss(), react(), fia()],
  build: { outDir: "dist", emptyOutDir: true },
});

/** SDK CSS is also consumed from an archive, so keep the development artifact current. */
function sdkStyles(): Plugin {
  const source = resolve(import.meta.dirname, "packages/sdk/src");
  let pending: Promise<void> = Promise.resolve();
  const rebuild = () => {
    pending = pending.catch(() => {}).then(buildUIStyles);
    return pending;
  };
  return {
    name: "malatang-sdk-styles",
    buildStart: rebuild,
    configureServer(server) {
      server.watcher.add(source);
      server.watcher.on("change", (path) => {
        if (path.startsWith(source + "/") && /\.(?:tsx?|css)$/.test(path)) {
          void rebuild().catch((error) => server.config.logger.error(String(error)));
        }
      });
    },
  };
}
