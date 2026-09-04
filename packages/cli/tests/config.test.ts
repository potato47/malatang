import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { loadProjectConfig, ProjectConfigError } from "../src/project-config.ts";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

async function project(source: string): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "fia-config-v2-"));
  roots.push(root);
  await mkdir(resolve(root, "frontend"));
  await writeFile(resolve(root, "fia.toml"), source);
  return root;
}

const minimal = `schema = 2

[app]
name = "Example"
identifier = "dev.example.fia"
version = "2.0.0"
build = 1
minimumMacOS = "14.0"
activationPolicy = "regular"

[web]
enabled = true
root = "frontend"
dist = "frontend/dist"

[backend]
enabled = false
runtime = "bun"
mount = "/api"

[native.permissions]
application = true
windows = true
`;

describe("fia.toml schema 2", () => {
  test("resolves defaults and keeps Bun, updater, and status item optional", async () => {
    const config = await loadProjectConfig(await project(minimal));
    expect(config.schema).toBe(2);
    expect(config.web.enabled).toBe(true);
    expect(config.backend.enabled).toBe(false);
    expect(config.statusItem).toBeUndefined();
    expect(config.updater).toBeUndefined();
    expect(config.native.permissions.clipboard).toBe(false);
  });

  test("rejects old schemas and unknown fields", async () => {
    for (const source of [
      minimal.replace("schema = 2", "schema = 6"),
      `${minimal}\nlegacy = true\n`,
    ]) {
      await expect(loadProjectConfig(await project(source))).rejects.toBeInstanceOf(
        ProjectConfigError,
      );
    }
  });

  test("accepts a complete Sparkle configuration", async () => {
    const source = `${minimal}
[updater]
publicKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
channel = "stable"
ui = "native"

[updater.feeds]
stable = "https://updates.example.dev/stable.xml"
`;
    const config = await loadProjectConfig(await project(source));
    expect(config.updater?.feeds.stable).toBe("https://updates.example.dev/stable.xml");
  });

  test("rejects non-canonical updater keys", async () => {
    const source = `${minimal}
[updater]
publicKey = "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
channel = "stable"
ui = "native"

[updater.feeds]
stable = "https://updates.example.dev/stable.xml"
`;
    await expect(loadProjectConfig(await project(source))).rejects.toBeInstanceOf(
      ProjectConfigError,
    );
  });
});
