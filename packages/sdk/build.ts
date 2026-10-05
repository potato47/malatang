import * as React from "react";
import * as JSX from "react/jsx-runtime";
import * as JSXDev from "react/jsx-dev-runtime";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import { resolve } from "node:path";
import { mkdir, rename, rm } from "node:fs/promises";
import { uiExports, sharedModules } from "./src/shared-modules";
const names: Record<string, readonly string[]> = Object.fromEntries([
  ["react", Object.keys(React)], ["react/jsx-runtime", Object.keys(JSX)], ["react/jsx-dev-runtime", Object.keys(JSXDev)],
  ["react-dom", Object.keys(ReactDOM)], ["react-dom/client", Object.keys(ReactDOMClient)], ["@semicoder/malatang-sdk/ui", uiExports],
]);
/** Emit a single host-shared UI bundle and page-scoped CSS. Never leave a partial dist. */
export async function buildPlugin(directory: string) {
  const root = resolve(directory), dist = resolve(root, "dist"), temporary = resolve(root, `.malatang-build-${crypto.randomUUID()}`);
  await rm(dist, { recursive: true, force: true });
  await mkdir(temporary);
  try {
    for (const source of ["client.tsx", "backend.ts"]) {
      if (!(await Bun.file(resolve(root, "src", source)).exists())) continue;
      const result = await Bun.build({ entrypoints: [resolve(root, "src", source)], outdir: temporary,
        target: source === "backend.ts" ? "bun" : "browser", format: "esm", jsx: { development: false },
        naming: { entry: "[name].[ext]", asset: "assets/[name]-[hash].[ext]" }, publicPath: "./",
        loader: { ".svg": "file", ".png": "file", ".jpg": "file", ".webp": "file", ".woff": "file", ".woff2": "file" },
        plugins: source === "backend.ts" ? [] : [{ name: "malatang-host-modules", setup(build) {
          build.onResolve({ filter: /^(?:react(?:\/.*)?|react-dom(?:\/.*)?|@semicoder\/malatang-sdk\/ui)$/ }, args => {
            if (!(sharedModules as readonly string[]).includes(args.path)) throw new Error(`Unsupported host runtime import: ${args.path}`);
            return { path: args.path, namespace: "malatang-host" };
          });
          build.onLoad({ filter: /.*/, namespace: "malatang-host" }, args => ({ loader: "js", contents:
            `const runtime = globalThis.__MALATANG_MODULES__?.[${JSON.stringify(args.path)}]; if (!runtime) throw new Error("需要麻辣烫 SDK 0.2 宿主，请重新构建插件"); export default runtime;\n` + names[args.path]!.filter(name => name !== "default" && /^[a-zA-Z_$][\w$]*$/.test(name)).map(name => `export const ${name} = runtime.${name};`).join("\n") }));
        } }],
      });
      if (!result.success) throw new AggregateError(result.logs, result.logs.map(String).join("\n"));
    }
    // The manifest always has a CSS entry, including plugins with no business rules.
    if (!(await Bun.file(resolve(temporary, "client.css")).exists())) await Bun.write(resolve(temporary, "client.css"), "/* No page styles. */\n");
    await rename(temporary, dist);
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
if (import.meta.main) { const { runPluginTool } = await import("./plugin"); process.exitCode = await runPluginTool(["build", ...process.argv.slice(2)]); }
