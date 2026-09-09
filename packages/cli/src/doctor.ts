import { defaultRunner } from "./application.ts";
import { verifyAssets } from "./artifacts.ts";
import { BUNDLED_BUN_VERSION } from "./metadata.ts";
import { loadProjectConfig } from "./project-config.ts";
export async function doctor(root: string, target: "dev" | "release" = "dev") {
  const checks = [
    {
      id: "platform",
      ok: process.platform === "darwin" && process.arch === "arm64",
      message: "macOS 14+ on Apple Silicon",
    },
    {
      id: "bun",
      ok: Bun.semver.satisfies(Bun.version, ">=1.4.0"),
      message: "Development Bun " + Bun.version + "; bundled runtime " + BUNDLED_BUN_VERSION,
    },
  ];
  try {
    await verifyAssets();
    checks.push({
      id: "precompiled-runtime",
      ok: true,
      message: "Host and Bun checksums verified",
    });
  } catch (error) {
    checks.push({ id: "precompiled-runtime", ok: false, message: String(error) });
  }
  const version = await defaultRunner(["/usr/bin/sw_vers", "-productVersion"], { cwd: root });
  checks.push({
    id: "macos",
    ok: Number.parseInt(version.stdout) >= 14,
    message: version.stdout.trim(),
  });
  const signature = await defaultRunner(["/usr/bin/codesign", "--version"], { cwd: root });
  checks.push({ id: "codesign", ok: signature.exitCode === 0, message: signature.stderr.trim() });
  if (target === "release") {
    try {
      const config = await loadProjectConfig(root);
      checks.push({
        id: "signing",
        ok:
          !!config.signing?.releaseIdentity?.startsWith("Developer ID Application:") &&
          !!config.signing?.notarizationProfile,
        message: "Developer ID identity and notarization profile required",
      });
    } catch (error) {
      checks.push({ id: "config", ok: false, message: String(error) });
    }
    for (const tool of ["notarytool", "stapler"]) {
      const result = await defaultRunner(["/usr/bin/xcrun", "--find", tool], { cwd: root });
      checks.push({
        id: tool,
        ok: result.exitCode === 0,
        message: result.stdout.trim() || result.stderr.trim(),
      });
    }
  }
  return { schemaVersion: 1, ok: checks.every((check) => check.ok), target, checks };
}
