import * as React from "react";
import * as JSX from "react/jsx-runtime";
import { resolve } from "node:path";
import { mkdir, rm } from "node:fs/promises";

/** Builds a self-contained plugin; React is supplied by the host, never duplicated. */
export async function buildPlugin(directory: string) {
  const root = resolve(directory);
  await rm(resolve(root, "dist"), { recursive: true, force: true });
  await mkdir(resolve(root, "dist"), { recursive: true });
  const sources = ["client.tsx", "backend.ts"];
  for (const source of sources) {
    if (!(await Bun.file(resolve(root, "src", source)).exists())) continue;
    const result = await Bun.build({
      entrypoints: [resolve(root, "src", source)],
      outdir: resolve(root, "dist"),
      target: source === "backend.ts" ? "bun" : "browser",
      format: "esm",
      jsx: { development: false },
      naming: source === "backend.ts" ? "backend.js" : "client.js",
      plugins: source === "backend.ts" ? [] : [{ name: "malatang-shared-react", setup(build) {
        build.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, args => ({ path: args.path, namespace: "malatang-host" }));
        build.onLoad({ filter: /.*/, namespace: "malatang-host" }, args => {
          const isJSX = args.path !== "react";
          const key = isJSX ? "__MALATANG_JSX__" : "__MALATANG_REACT__";
          const exports = Object.keys(isJSX ? JSX : React).filter(name => name !== "default" && /^[a-zA-Z_$][\w$]*$/.test(name));
          return { loader: "js", contents: `const runtime = globalThis.${key}; if (!runtime) throw new Error("Malatang UI runtime is missing"); export default runtime;\n` + exports.map(name => `export const ${name} = runtime.${name};`).join("\n") };
        });
      } }],
    });
    if (!result.success) throw new AggregateError(result.logs, `Plugin build failed: ${root}`);
  }
}

if (import.meta.main) await buildPlugin(process.argv[2] ?? ".");
