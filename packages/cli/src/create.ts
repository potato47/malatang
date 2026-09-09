import { cp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CLI_VERSION } from "./metadata.ts";
import type { CreateOptions } from "./create-options.ts";

export async function createProject(options: CreateOptions, cwd = process.cwd()) {
  const name = options.name;
  if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name))
    throw new Error("Project name must be lowercase kebab-case");
  const root = resolve(cwd, name);
  await mkdir(root); // Never replace an existing project.
  try {
    await mkdir(resolve(root, "backend"));
    await mkdir(resolve(root, "frontend"));
    await mkdir(resolve(root, "assets"));
    const localPackage = await realpath(resolve(import.meta.dir, ".."));
    const spec = options.local ? "file:" + localPackage : CLI_VERSION;
    const title = name
      .split("-")
      .map((part) => part[0]!.toUpperCase() + part.slice(1))
      .join(" ");
    const files: Record<string, string> = {
      "package.json": JSON.stringify(
        {
          name,
          version: "0.1.0",
          private: true,
          type: "module",
          scripts: {
            dev: "fia dev",
            run: "fia run",
            build: "fia build",
            release: "fia release",
            check: "fia check",
            test: "fia test",
          },
          dependencies: { "@semicoder/fia": spec, react: "^19.2.7", "react-dom": "^19.2.7" },
          devDependencies: {
            "@types/bun": "1.4.0",
            "@types/react": "19.2.17",
            "@types/react-dom": "19.2.3",
            typescript: "7.0.2",
            vite: "^7.1.3",
            "@vitejs/plugin-react": "^5.0.0",
          },
        },
        null,
        2,
      ),
      "fia.config.ts":
        'import { defineConfig } from "@semicoder/fia/config";\n\nexport default defineConfig({\n  app: { name: ' +
        JSON.stringify(title) +
        ", identifier: " +
        JSON.stringify("com.example." + name) +
        ', version: "0.1.0", build: 1, icon: "assets/icon.icns" },\n});\n',
      "backend/index.ts":
        'import { defineBackend } from "@semicoder/fia/backend";\n\nexport default defineBackend({\n  http: { routes: { "/hello": { GET: () => Response.json({ message: "Hello from Bun" }) } } },\n  async start({ native }) {\n    await native.windows.setTitlebar({ id: "main", items: [\n      { type: "text", id: "status", label: "Ready" },\n      { type: "button", id: "copy", label: "Copy", symbol: "doc.on.doc" },\n    ] });\n    native.on("windows.titlebarAction", (value) => {\n      const event = value as { windowId: string; itemId: string };\n      if (event.itemId === "copy") void native.clipboard.writeText({ text: "Hello from FIA" });\n    });\n  },\n});\n',
      "vite.config.ts":
        'import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\nimport fia from "@semicoder/fia/vite";\n\nexport default defineConfig({ root: "frontend", plugins: [react(), fia()], build: { outDir: "dist", emptyOutDir: true } });\n',
      "tsconfig.json": JSON.stringify(
        {
          compilerOptions: {
            strict: true,
            skipLibCheck: true,
            target: "ES2023",
            module: "Preserve",
            moduleResolution: "Bundler",
            jsx: "react-jsx",
            noEmit: true,
            allowImportingTsExtensions: true,
            lib: ["ESNext", "DOM"],
            types: ["bun", "vite/client"],
          },
          include: ["frontend", "backend", "fia.config.ts", "vite.config.ts"],
        },
        null,
        2,
      ),
      "frontend/index.html":
        '<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' +
        title +
        '</title></head><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>\n',
      "frontend/main.tsx":
        'import React, { useEffect } from "react";\nimport { createRoot } from "react-dom/client";\nimport { native } from "@semicoder/fia/client";\nimport App from "./App";\nimport "./style.css";\n\nfunction Root() {\n  useEffect(() => { void native.ready(); }, []);\n  return <App />;\n}\ncreateRoot(document.getElementById("root")!).render(<Root />);\n',
      "frontend/App.tsx":
        'import React, { useEffect, useState } from "react";\nimport { native } from "@semicoder/fia/client";\n\nexport default function App() {\n  const [message, setMessage] = useState("Connecting…");\n  useEffect(() => { fetch("/api/hello").then(r => r.json()).then(data => setMessage(data.message)).catch(() => setMessage("Backend unavailable")); }, []);\n  return <main><span>FIA</span><h1>Build something useful.</h1><p>{message}</p><button onClick={() => void native.dialogs.openFiles({ multiple: false })}>Open a file</button></main>;\n}\n',
      "frontend/style.css":
        ":root{font:16px system-ui;color-scheme:light dark}body{margin:0}main{max-width:720px;margin:15vh auto;padding:32px}span{font-weight:700;letter-spacing:.2em}h1{font-size:44px}button{font:inherit;padding:10px 18px;border:1px solid #8888;border-radius:8px;cursor:pointer}\n",
      ".gitignore":
        "node_modules/\n.fia/\ndist/\nfrontend/dist/\n.DS_Store\n.env*\n*private*.pem\n",
      "README.md":
        "# " +
        title +
        "\n\nbun install\nbun run dev\n\nEdit frontend/ for the UI and backend/ for business logic. Configure packaging in fia.config.ts. The Swift host and Bun runtime are precompiled; no Swift tools are needed.\n\nUse bun run build for a local .app; configure Developer ID signing before bun run release. See the FIA framework documentation for signed code updates.\n",
      "AGENTS.md":
        "# FIA application\n\nUse frontend/ for React and backend/ for Bun. Native capabilities are available through @semicoder/fia/client or backend context.native. Do not add Swift targets, transport bridges or alternative application modes. Run bun run check and bun run build before delivery. Use native.ready() after the first frontend mount; updates depend on this health signal. Keep persistent data under context.app.dataDirectory.\n",
    };
    for (const [path, content] of Object.entries(files))
      await writeFile(resolve(root, path), content);
    for (const file of ["icon.png", "icon.icns"])
      await cp(
        resolve(import.meta.dir, "../templates/assets", file),
        resolve(root, "assets", file),
      );
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
  for (const command of [
    ...(options.install ? [[process.execPath, "install"]] : []),
    ...(options.git ? [["git", "init"]] : []),
  ]) {
    const child = Bun.spawn(command, {
      cwd: root,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    if ((await child.exited) !== 0)
      throw new Error("Project created at " + root + "; command failed: " + command.join(" "));
  }
  return { projectRoot: root };
}
