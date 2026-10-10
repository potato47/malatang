import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";

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
    external: ["index", "agent-cli", "script-preload"].includes(name) ? [] : ["zod", "zod/*"],
    naming: name + ".js",
  });
  if (!result.success) throw new AggregateError(result.logs, "Failed to build " + name);
}
const tsc = Bun.spawn(
  [
    process.execPath,
    resolve(dirname(Bun.resolveSync("typescript/package.json", root)), "bin/tsc"),
    "-p",
    resolve(root, "tsconfig.build.json"),
  ],
  { stdout: "inherit", stderr: "inherit" },
);
if (await tsc.exited) process.exit(1);

await rm(resolve(root, "docs/framework"), { recursive: true, force: true });
await cp(resolve(root, "../../docs/framework"), resolve(root, "docs/framework"), {
  recursive: true,
});
