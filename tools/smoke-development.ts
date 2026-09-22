import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { requestSession } from "../packages/cli/src/session.ts";
import { waitUntil } from "../packages/cli/src/smoke.ts";
import type { ResolvedFIAConfig } from "../packages/cli/src/project-config.ts";

/** Exercises the real Vite/WKWebView connection and Bun generation replacement. */
export async function smokeDevelopment(config: ResolvedFIAConfig) {
  const root = config.projectRoot;
  const backend = resolve(root, config.backend.entry);
  const frontend = resolve(root, config.web.root, "App.tsx");
  const originalBackend = await readFile(backend, "utf8");
  const originalFrontend = await readFile(frontend, "utf8");
  const events = resolve(root, ".fia/dev-events.jsonl");
  const report = resolve(root, ".fia/hmr.json");
  const source = (generation: number) => `
import { defineBackend } from "@semicoder/fia/backend";
import { appendFile } from "node:fs/promises";
const generation = ${generation};
export default defineBackend({
  http: { routes: { "/hmr": { POST: async (request) => { await Bun.write(${JSON.stringify(report)}, await request.text()); return new Response("ok"); } } } },
  async start({ native }) {
    await native.windows.create({ id: "aux", title: "Auxiliary" });
    await native.windows.setTitlebar({ id: "main", items: [{type:"text",id:"generation",label:String(generation)}] });
    await appendFile(${JSON.stringify(events)}, JSON.stringify({event:"start",generation,pid:process.pid})+"\\n");
  },
  async stop() { await appendFile(${JSON.stringify(events)}, JSON.stringify({event:"stop",generation,pid:process.pid})+"\\n"); }
});`;
  await writeFile(backend, source(1));
  await writeFile(
    frontend,
    `import React, {useEffect} from "react";
export default function App() {
  useEffect(() => { if (new URLSearchParams(location.search).get("fiaWindow") === "main") void fetch("/api/hmr", {method:"POST",body:JSON.stringify({marker:1,timeOrigin:performance.timeOrigin})}); }, []);
  return <main>Development smoke</main>;
}`,
  );
  const logs: string[] = [];
  let failure: unknown;
  let exited = false;
  const development = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, "../packages/cli/src/index.ts"), "dev"],
    { cwd: root, detached: true, stdin: "ignore", stdout: "pipe", stderr: "pipe" },
  );
  const drain = async (stream: ReadableStream<Uint8Array>) => {
    for await (const bytes of stream) logs.push(new TextDecoder().decode(bytes));
  };
  const running = Promise.all([
    development.exited,
    drain(development.stdout),
    drain(development.stderr),
  ])
    .then(([code]) => {
      if (code !== 0) throw new Error("Development exited with status " + code);
    })
    .catch((error) => {
      failure = error;
    })
    .finally(() => {
      exited = true;
    });
  const inspect = async () => {
    if (failure || exited)
      throw new Error("Development exited: " + String(failure) + "\n" + logs.join("\n"));
    return (await requestSession(root, "status")) as {
      runtime?: {
        pid: number;
        backend: string;
        frontendsReady: string[];
        windows: string[];
        processGroups: number[];
      };
    };
  };
  try {
    const first = await waitUntil(
      async () => {
        const { runtime } = await inspect();
        return runtime?.backend === "ready" &&
          runtime.frontendsReady?.includes("aux") &&
          runtime.frontendsReady.includes("main")
          ? runtime
          : undefined;
      },
      30_000,
      "Development windows ready",
    );
    const before = await waitUntil(
      async () => {
        try {
          return JSON.parse(await readFile(report, "utf8")) as {
            timeOrigin: number;
            marker: number;
          };
        } catch {
          return undefined;
        }
      },
      5_000,
      "Frontend probe",
    );
    await writeFile(frontend, (await readFile(frontend, "utf8")).replace("marker:1", "marker:2"));
    const after = await waitUntil(
      async () => {
        const value = JSON.parse(await readFile(report, "utf8")) as typeof before;
        return value.marker === 2 ? value : undefined;
      },
      10_000,
      "React Fast Refresh",
    );
    if (!Number.isFinite(after.timeOrigin) || after.timeOrigin !== before.timeOrigin)
      throw new Error("Frontend HMR reloaded the page");
    const beforeRestart = await inspect();
    if (beforeRestart.runtime?.processGroups[0] !== first.processGroups[0])
      throw new Error("Frontend edit restarted Bun");
    await writeFile(backend, source(2));
    const second = await waitUntil(
      async () => {
        const { runtime } = await inspect();
        return runtime?.backend === "ready" &&
          runtime.processGroups[0] !== first.processGroups[0] &&
          runtime.frontendsReady?.includes("main") &&
          runtime.frontendsReady.includes("aux")
          ? runtime
          : undefined;
      },
      30_000,
      "Bun restart and frontend reconnection",
    );
    if (
      second.pid !== first.pid ||
      JSON.stringify(second.windows) !== JSON.stringify(first.windows)
    )
      throw new Error("Bun restart replaced native windows or host");
    try {
      process.kill(-first.processGroups[0]!, 0);
      throw new Error("Old Bun process group remains");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
    const recorded = (await readFile(events, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    if (
      recorded.filter((event) => event.event === "start").length !== 2 ||
      recorded.filter((event) => event.event === "stop" && event.generation === 1).length !== 1
    )
      throw new Error("Duplicate start or missing stop hook");
    const interruptedAt = Date.now();
    // A terminal sends Ctrl+C to the entire foreground process group.
    process.kill(-development.pid, "SIGINT");
    await waitUntil(async () => (exited ? true : undefined), 3000, "Ctrl+C shutdown");
    if (failure) throw failure;
    const stopped = (await readFile(events, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    if (stopped.filter((event) => event.event === "stop" && event.generation === 2).length !== 1)
      throw new Error("Ctrl+C did not execute the backend stop hook exactly once");
    for (const pid of [second.pid, ...second.processGroups.map((pid) => -pid)]) {
      try {
        process.kill(pid, 0);
        throw new Error("Process remains after Ctrl+C: " + pid);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    }
    if (((await requestSession(root, "status")) as { running: boolean }).running)
      throw new Error("Development session remains after Ctrl+C");
    console.log(
      "Development: frontend HMR, two stable windows, backend restart, stop hook and process cleanup passed; Ctrl+C shutdown in " +
        (Date.now() - interruptedAt) +
        " ms.",
    );
  } catch (error) {
    throw new Error(String(error) + "\n" + logs.join("\n"));
  } finally {
    if (!exited) await requestSession(root, "stop");
    await running;
    await writeFile(backend, originalBackend);
    await writeFile(frontend, originalFrontend);
  }
}
