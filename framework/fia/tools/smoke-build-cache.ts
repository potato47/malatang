import { readFile, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { repositoryRoot, run } from "./shared.ts";
import { reportPath, buildStateDirectory } from "./prepare.ts";

const prepare = () => run([process.execPath, "tools/prepare.ts"], { quiet: true });
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
await prepare();
const cached = await prepare();
assert(cached.includes("verified cached outputs"), "Unchanged build did not use verified cache");
const client = resolve(repositoryRoot, "packages/cli/dist/client.js");
await rm(client);
const missing = await prepare();
assert(
  missing.includes("building CLI and SDK") && !missing.includes("building native runtime"),
  "Missing CLI output did not rebuild only CLI",
);
const host = resolve(repositoryRoot, "packages/cli/assets/darwin-arm64/FIAHost");
const binary = await readFile(host);
try {
  await writeFile(host, "corrupt runtime");
  const corrupt = await prepare();
  assert(
    corrupt.includes("building native runtime") && !corrupt.includes("building CLI and SDK"),
    "Corrupt native output did not rebuild only native",
  );
} catch (error) {
  await writeFile(host, binary);
  throw error;
}
const cachePath = resolve(buildStateDirectory, "native.json");
const record = JSON.parse(await readFile(cachePath, "utf8"));
await writeFile(cachePath, JSON.stringify({ ...record, input: "previous-toolchain-input" }));
const stale = await prepare();
assert(stale.includes("building native runtime"), "Mismatched native input was reused");
const report = JSON.parse(await readFile(reportPath, "utf8"));
assert(
  report.source.framework &&
    report.toolchain.bunSHA256 &&
    report.native.output &&
    report.cli.output,
  "Build provenance is incomplete",
);
console.log(
  JSON.stringify({
    ok: true,
    scenarios: ["cache-hit", "missing-cli", "corrupt-native", "stale-input", "provenance"],
  }),
);
