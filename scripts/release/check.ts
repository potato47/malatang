import { appendFile } from "node:fs/promises";
import { config, pkg, assert, validateConfig } from "./config";

validateConfig();
assert(Bun.version === "1.4.2", "Use Bun 1.4.2");
if (process.env.GITHUB_ACTIONS) {
  assert(process.env.GITHUB_REPOSITORY === config.repository, "Publishing is only enabled in the configured repository");
  if (process.env.GITHUB_EVENT_NAME === "push") assert(process.env.GITHUB_REF === `refs/tags/v${pkg.version}`, "Tag and application version differ");
  else assert(process.env.GITHUB_EVENT_NAME === "workflow_dispatch", "Unexpected release trigger");
}
if (process.argv.includes("--signed")) {
  assert(process.env.MALATANG_SIGNING_IDENTITY?.startsWith("Developer ID Application:"), "Set APPLE_SIGNING_IDENTITY repository variable");
  assert(process.env.FIA_UPDATE_PRIVATE_KEY_FILE, "Update signing key is missing");
}
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `version=${pkg.version}\nbuild=${config.build}\ntag=v${pkg.version}\n`);
console.log(`Release configuration valid: v${pkg.version} (${config.build})`);
