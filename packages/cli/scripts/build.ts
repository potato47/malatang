import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
await rm(resolve(root, "dist"), { recursive: true, force: true });
await mkdir(resolve(root, "dist"));
for (const name of [
  "index",
  "config",
  "client",
  "backend",
  "vite",
  "business-api",
  "agent-cli",
  "script-preload",
]) {
  const result = await Bun.build({
    entrypoints: [resolve(root, "src", (name === "agent-cli" ? "agent-entry" : name) + ".ts")],
    target: ["client", "business-api", "config"].includes(name) ? "browser" : "bun",
    outdir: resolve(root, "dist"),
    naming: name + ".js",
  });
  if (!result.success) throw new AggregateError(result.logs, "Failed to build " + name);
}
const tsc = Bun.spawn(
  [
    process.execPath,
    resolve(root, "../../node_modules/typescript/bin/tsc"),
    "-p",
    resolve(root, "tsconfig.build.json"),
  ],
  { stdout: "inherit", stderr: "inherit" },
);
if (await tsc.exited) process.exit(1);
