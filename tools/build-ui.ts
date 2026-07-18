import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ensureParent, generatedUIPath, repositoryRoot, requireBunVersion, run } from "./shared.ts";

export async function buildUI(): Promise<void> {
  requireBunVersion();
  await ensureParent(generatedUIPath);
  const source = resolve(repositoryRoot, "prototype/runtime/src/ui/index.html");
  const outdir = resolve(repositoryRoot, ".fia/generated/ui");
  const bundledHTMLPath = resolve(outdir, "index.html");
  await run([
    process.execPath,
    "build",
    "--compile",
    "--target=browser",
    source,
    "--outdir",
    outdir,
  ]);

  const bundled = await readFile(bundledHTMLPath, "utf8");
  const protectedHTML = bundled
    .replaceAll(/<script\b/g, '<script nonce="__FIA_CSP_NONCE__"')
    .replaceAll(/<style\b/g, '<style nonce="__FIA_CSP_NONCE__"');
  if (!protectedHTML.includes("__FIA_CSP_NONCE__")) {
    throw new Error("Bundled UI contains no script or style tags to protect with a CSP nonce");
  }
  await Bun.write(generatedUIPath, protectedHTML);
}

if (import.meta.main) {
  await buildUI();
  console.log(`Generated ${generatedUIPath}`);
}
