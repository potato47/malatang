import { expect, test } from "bun:test";
import { localProfile } from "../src/local-profile.ts";
import { infoPlist } from "../src/application.ts";
import { validateConfig } from "../src/project-config.ts";
import { mkdtemp, mkdir, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

test("local profiles separate macOS identity and preview storage without migrating development keys", () => {
  const config = validateConfig(
    {
      app: { name: "Example", identifier: "com.example.app", version: "1.0.0", build: 1 },
      agent: { command: "example", description: "Example" },
      updates: {
        url: "https://example.com/latest.json",
        publicKey: Buffer.alloc(32, 1).toString("base64"),
      },
    },
    "/tmp/local-profile-project",
  );
  const before = JSON.stringify(config);
  const dev = localProfile(config, "development");
  const preview = localProfile(config, "preview");
  expect(dev.config.app.identifier).toBe(config.app.identifier);
  expect(dev.dataRoot).toBe("/tmp/local-profile-project/.fia/dev/data");
  expect(preview.dataRoot).toBe("/tmp/local-profile-project/.fia/preview/data");
  expect(dev.bundleIdentifier).toBe("com.example.app.dev");
  expect(preview.bundleIdentifier).toBe("com.example.app.preview");
  expect(dev.config.agent.command).toBe("example-dev");
  expect(preview.config.agent.command).toBe("example-preview");
  expect(dev.config.updates).toBeUndefined();
  expect(preview.config.updates).toBeUndefined();
  const plist = infoPlist(dev.config, dev.bundleIdentifier, true);
  expect(plist).toContain("<string>Example Dev</string>");
  expect(plist).toContain("<string>com.example.app.dev</string>");
  expect(plist).toContain("<key>CFBundleIconFile</key><string>AppIcon</string>");
  expect(infoPlist(config)).toContain("<string>com.example.app</string>");
  expect(JSON.stringify(config)).toBe(before);
});

test("a Dev bundle CLI never cold-starts without the managed development session", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "fia-local-cli-"));
  try {
    const bundle = resolve(root, "Example Dev.app");
    await mkdir(resolve(bundle, "Contents/Resources"), { recursive: true });
    await writeFile(
      resolve(bundle, "Contents/Resources/fia.runtime.json"),
      JSON.stringify({
        schema: 4,
        runtimeId: "test",
        app: { name: "Example Dev", identifier: "com.example.app" },
        agent: { command: "example-dev" },
        localProfile: { mode: "development", dataRoot: resolve(root, "data"), label: "DEV" },
      }),
    );
    const source = new URL("../src/agent-cli.ts", import.meta.url).href;
    const child = Bun.spawn(
      [
        process.execPath,
        "-e",
        `import {runAgentCLI} from ${JSON.stringify(source)}; process.exitCode = await runAgentCLI(["call","counter.get","--json","{}"], ${JSON.stringify(bundle)});`,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect(code).toBe(75);
    expect(stderr).toContain("not_running");
    await expect(
      access(resolve(root, "data/com.example.app/Agent/launch.lock")),
    ).rejects.toBeDefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
