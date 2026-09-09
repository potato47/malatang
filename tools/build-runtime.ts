import { chmod, cp, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assetDirectory, sha256 } from "../packages/cli/src/artifacts.ts";
import {
  BUNDLED_BUN_VERSION,
  CLI_VERSION,
  FIA_BACKEND_PROTOCOL_VERSION,
} from "../packages/cli/src/metadata.ts";
import { repositoryRoot, run } from "./shared.ts";

if (process.platform !== "darwin" || process.arch !== "arm64")
  throw new Error("Precompile on Apple Silicon macOS");
if (Bun.version !== BUNDLED_BUN_VERSION)
  throw new Error("Runtime release requires Bun " + BUNDLED_BUN_VERSION);
await run(["swift", "build", "--disable-sandbox", "-c", "release", "--product", "FIAHost"], {
  env: {
    ...process.env,
    CLANG_MODULE_CACHE_PATH: resolve(repositoryRoot, ".build/module-cache"),
    SWIFTPM_MODULECACHE_OVERRIDE: resolve(repositoryRoot, ".build/module-cache"),
  },
});
const output = (
  await run(["swift", "build", "--disable-sandbox", "-c", "release", "--show-bin-path"], {
    quiet: true,
    env: {
      ...process.env,
      CLANG_MODULE_CACHE_PATH: resolve(repositoryRoot, ".build/module-cache"),
      SWIFTPM_MODULECACHE_OVERRIDE: resolve(repositoryRoot, ".build/module-cache"),
    },
  })
).trim();
await mkdir(assetDirectory, { recursive: true });
await cp(resolve(output, "FIAHost"), resolve(assetDirectory, "FIAHost"));
await cp(process.execPath, resolve(assetDirectory, "bun"));
for (const name of ["FIAHost", "bun"]) await chmod(resolve(assetDirectory, name), 0o755);
await writeFile(
  resolve(assetDirectory, "manifest.json"),
  JSON.stringify(
    {
      schema: 1,
      frameworkVersion: CLI_VERSION,
      bunVersion: BUNDLED_BUN_VERSION,
      protocol: FIA_BACKEND_PROTOCOL_VERSION,
      architecture: "arm64",
      minimumMacOS: "14.0",
      hostSHA256: await sha256(resolve(assetDirectory, "FIAHost")),
      bunSHA256: await sha256(resolve(assetDirectory, "bun")),
    },
    null,
    2,
  ) + "\n",
);
console.log("Precompiled runtime ready: " + assetDirectory);
