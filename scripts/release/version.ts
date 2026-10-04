import { writeFile } from "node:fs/promises";
import { config, pkg, assert, root } from "./config";

const version = process.argv[2];
assert(version && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version), "Usage: bun run version:app <x.y.z>");
const parts = version.split(".").map(Number), current = pkg.version.split(".").map(Number);
const difference = parts.findIndex((n, i) => n !== current[i]);
assert(difference >= 0 && parts[difference]! > current[difference]!, "Version must increase");
assert(Number.isSafeInteger(config.build + 1), "Build number exhausted");
await writeFile(new URL("package.json", `file://${root}`), JSON.stringify({ ...pkg, version }, null, 2) + "\n");
await writeFile(new URL("release/config.json", `file://${root}`), JSON.stringify({ ...config, build: config.build + 1 }, null, 2) + "\n");
console.log(`Malatang ${version}, build ${config.build + 1}. Commit both files before tagging v${version}.`);
