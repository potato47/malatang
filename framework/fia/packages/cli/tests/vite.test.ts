import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createServer, type ViteDevServer } from "vite";
import fia from "../src/vite.ts";

test("local FIA SDK refreshes invalidate Vite bundles and browser URLs without a version bump", async () => {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "fia-vite-client-")));
  const packageRoot = resolve(root, "node_modules/@semicoder/fia");
  let server: ViteDevServer | undefined;
  async function start(withFIA: boolean) {
    server = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: withFIA ? [fia()] : [],
      server: { host: "127.0.0.1", port: 0 },
      optimizeDeps: withFIA ? {} : { include: ["@semicoder/fia/client"] },
    });
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === "string") throw new Error("Missing Vite port");
    return "http://127.0.0.1:" + address.port;
  }
  async function client(origin: string) {
    const headers = { "sec-fetch-dest": "script" };
    const entry = await (await fetch(origin + "/main.js", { headers })).text();
    const path = /from\s+"([^"]+)"/u.exec(entry)?.[1];
    if (!path) throw new Error("Missing client import");
    const response = await fetch(new URL(path, origin), { headers });
    expect(response.status).toBe(200);
    return { path, code: await response.text(), cache: response.headers.get("cache-control") };
  }
  try {
    await mkdir(packageRoot, { recursive: true });
    await writeFile(resolve(root, "package.json"), '{"type":"module"}');
    await writeFile(
      resolve(packageRoot, "package.json"),
      JSON.stringify({
        name: "@semicoder/fia",
        version: "0.16.1",
        type: "module",
        exports: {
          "./client": { import: "./client.js", default: "./client.js" },
          "./api": { import: "./business-api.js" },
        },
      }),
    );
    await writeFile(resolve(packageRoot, "business-api.js"), 'export const contract = "v1";');
    await writeFile(resolve(root, "index.html"), '<script type="module" src="/main.js"></script>');
    await writeFile(
      resolve(root, "main.js"),
      'import { protocol } from "@semicoder/fia/client"; window.protocol = protocol;',
    );
    const replaceClient = (protocol: string) =>
      writeFile(resolve(packageRoot, "client.js"), `export const protocol = "${protocol}";`);
    await replaceClient("old-cookie-only");
    const old = await client(await start(false));
    expect(old.path).toContain("/.vite/deps/");
    expect(old.code).toContain("old-cookie-only");
    await server!.close();
    let previousPath = old.path;
    for (const protocol of ["browser-ticket-v1", "browser-ticket-v2"]) {
      await replaceClient(protocol);
      const fresh = await client(await start(true));
      expect(fresh.path).not.toBe(previousPath);
      expect(fresh.code).toContain(protocol);
      expect(fresh.code).not.toContain("old-cookie-only");
      previousPath = fresh.path;
      await server!.close();
    }
  } finally {
    await server?.close();
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);
