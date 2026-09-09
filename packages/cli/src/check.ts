import { loadProjectConfig } from "./project-config.ts";
import { checkTypes } from "./validation.ts";
import { verifyAssets } from "./artifacts.ts";
export async function checkProject(root: string) {
  const checks: Array<{ id: string; status: string; message: string }> = [];
  try {
    const config = await loadProjectConfig(root);
    checks.push({ id: "config", status: "pass", message: "fia.config.ts is valid" });
    await verifyAssets();
    checks.push({ id: "runtime", status: "pass", message: "Precompiled runtime matches CLI" });
    checks.push(...(await checkTypes(config)));
  } catch (error) {
    checks.push({ id: "project", status: "fail", message: String(error) });
  }
  return { schemaVersion: 1, ok: checks.every((check) => check.status === "pass"), checks };
}
