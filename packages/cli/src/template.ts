export function projectFiles(name: string, title: string, spec: string): Record<string, string> {
  const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
  return {
    "package.json": json({
      name,
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: {
        dev: "fia dev",
        agent: "fia agent",
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
    }),
    "fia.config.ts": `import { defineConfig } from "@semicoder/fia/config";
export default defineConfig({
  app: { name: ${JSON.stringify(title)}, identifier: ${JSON.stringify("com.example." + name)}, version: "0.1.0", build: 1, icon: "assets/icon.icns" },
  agent: { command: ${JSON.stringify(name)}, description: "Read and increment a shared counter from the desktop or an agent.", instructions: "agent/instructions.md" },
  statusItem: { symbol: "number.circle", tooltip: ${JSON.stringify(title)} },
});
`,
    "shared/api.ts": `import { defineAPI, z } from "@semicoder/fia/api";
const counter = z.strictObject({ value: z.number().int() });
export default defineAPI({
  methods: {
    "counter.get": { description: "Read the current shared counter.", input: z.strictObject({}), output: counter },
    "counter.increment": { description: "Add an integer to the shared counter.", input: z.strictObject({ by: z.number().int() }), output: counter, examples: [{ input: { by: 1 } }] },
  },
  events: { "counter.changed": { description: "The counter has been saved.", payload: counter } },
});
`,
    "backend/index.ts": `import { defineBackend, implementAPI } from "@semicoder/fia/backend";
import { rename } from "node:fs/promises";
import { resolve } from "node:path";
import api from "../shared/api";

let value = 0;
let queue = Promise.resolve();
export default defineBackend({
  api: implementAPI(api, {
    "counter.get": () => ({ value }),
    "counter.increment": (input, context) => {
      const result = queue.then(async () => {
        context.signal.throwIfAborted();
        const next = value + input.by;
        if (!Number.isSafeInteger(next)) throw new Error("Counter exceeds safe integer range");
        const path = resolve(context.app.dataDirectory, "counter.json");
        await Bun.write(path + ".tmp", JSON.stringify({ value: next }));
        await rename(path + ".tmp", path);
        value = next;
        context.emit("counter.changed", { value });
        return { value };
      });
      queue = result.then(() => {}, () => {});
      return result;
    },
  }),
  async start({ app, native }) {
    const file = Bun.file(resolve(app.dataDirectory, "counter.json"));
    if (await file.exists()) value = api.methods["counter.get"].output.parse(await file.json()).value;
    await native.windows.setTitlebar({ id: "main", items: [{ type: "text", id: "status", label: "Humans + agents" }] });
  },
});
`,
    "agent/instructions.md": `## Counter workflow\n\nUse counter.get to inspect state and counter.increment to change it. The UI and CLI share the same saved counter. Subscribe to counter.changed for updates. An increment has an effect; after a connection failure, read state before deciding whether to repeat it.\n`,
    "frontend/App.tsx": `import React, { useEffect, useState } from "react";
import { createClient } from "@semicoder/fia/client";
import type api from "../shared/api";
const app = createClient<typeof api>();
export default function App() {
  const [value, setValue] = useState<number>();
  const [error, setError] = useState("");
  useEffect(() => {
    const refresh = () => { void app.call("counter.get", {}).then(data => setValue(data.value)).catch(e => setError(String(e))); };
    const off = app.on("counter.changed", data => setValue(data.value));
    const reconnected = app.onReconnect(refresh);
    refresh();
    return () => { off(); reconnected(); };
  }, []);
  const increment = () => app.call("counter.increment", { by: 1 }).then(data => { setValue(data.value); setError(""); }).catch(e => setError(String(e)));
  return <main><span>FIA · HUMANS + AGENTS</span><h1>One shared counter.</h1><output>{value ?? "…"}</output><p><button onClick={() => void increment()}>Add one</button></p><p>Try the same operation from your agent:</p><code>${name} call counter.increment --json '{'{"by":1}'}'</code>{error && <p role="alert">{error}</p>}</main>;
}
`,
    "frontend/main.tsx": `import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { native } from "@semicoder/fia/client";
import App from "./App";
import "./style.css";
function Root() { useEffect(() => { void native.ready(); }, []); return <App />; }
createRoot(document.getElementById("root")!).render(<Root />);
`,
    "frontend/index.html": `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>\n`,
    "frontend/style.css":
      ":root{font:16px system-ui;color-scheme:light dark}body{margin:0}main{max-width:720px;margin:12vh auto;padding:32px}span{font-weight:700;letter-spacing:.15em}h1{font-size:42px}output{font-size:64px;font-variant-numeric:tabular-nums}button{font:inherit;padding:10px 18px;border:1px solid #8888;border-radius:8px;cursor:pointer}code{font-size:13px}\n",
    "vite.config.ts": `import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\nimport fia from "@semicoder/fia/vite";\nexport default defineConfig({ root: "frontend", plugins: [react(), fia()], build: { outDir: "dist", emptyOutDir: true } });\n`,
    "tsconfig.json": json({
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
      include: ["frontend", "backend", "shared", "fia.config.ts", "vite.config.ts"],
    }),
    ".gitignore": "node_modules/\n.fia/\ndist/\nfrontend/dist/\n.DS_Store\n.env*\n*private*.pem\n",
    "README.md": `# ${title}\n\nRun bun install and bun run dev (or bun run dev --open-browser). The dev output includes a one-use browser link valid for 60 seconds; obtain another with bun run agent open --browser --url, including after backend restart. In another terminal run bun run agent call counter.increment --json '{"by":1}'.\n\nEdit shared/api.ts for the contract, backend/ for handlers, frontend/ for UI, and agent/instructions.md for business guidance. bun run build produces an application with its own CLI and Bun runtime. Use the app menu to install the command; then run ${name} skill install to install its skill.\n\nCLI startup stays in the tray; ${name} open shows the window. Explicitly quit to stop the backend. Scripts are trusted local code.\n`,
    "AGENTS.md":
      "# FIA 4 application\n\nDeclare shared operations and events in shared/api.ts. Implement them in backend/ with implementAPI; call them from frontend/ using createClient. Keep the contract module free of backend initialization and side effects. Update agent/instructions.md with business workflows. Do not start another server, port or CLI; use defineBackend.http for custom HTTP and WebSocket routes relative to /api. Custom routes are not available through the application CLI. Use fia agent for the current development instance. Run bun run check and bun run build before delivery. Call native.ready() on first frontend mount even when hidden. windows.create declares windows; use open to present them. Persist business data under context.app.dataDirectory. Scripts are trusted local code; persistent jobs belong in your backend. Return a task ID promptly, use context.emit in start/routes for background events, veto updates in beforeUpdate while busy, and cancel tasks in stop. API messages are limited to 1 MiB of UTF-8. Use events --count N --timeout MS --match JSON to wait for matching events; timeout exits 124. Events have no replay, so subscribe before triggering work and reread state after waiting. For browser debugging use fia dev --open-browser or fia agent open --browser --url; tickets expire after 60 seconds and must be refreshed after backend restart. Framework documentation is included at node_modules/@semicoder/fia/docs/framework/README.md.\n",
  };
}
