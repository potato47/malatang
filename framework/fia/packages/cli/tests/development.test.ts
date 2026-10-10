import { expect, test } from "bun:test";
import { hasProcessExited, isDevelopmentServerReady } from "../src/application.ts";

test("development readiness bypasses proxy environment and checks HTTP status", async () => {
  let status = 200;
  let proxyRequests = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("ready", { status }),
  });
  const proxy = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => {
      proxyRequests++;
      return new Response(null, { status: 502 });
    },
  });
  try {
    const source = new URL("../src/application.ts", import.meta.url).href;
    const child = Bun.spawn(
      [
        process.execPath,
        "-e",
        `import {isDevelopmentServerReady} from ${JSON.stringify(source)}; console.log(await isDevelopmentServerReady(${server.port}));`,
      ],
      {
        env: {
          ...process.env,
          HTTP_PROXY: `http://127.0.0.1:${proxy.port}`,
          http_proxy: `http://127.0.0.1:${proxy.port}`,
          NO_PROXY: "",
          no_proxy: "",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect((await new Response(child.stdout).text()).trim()).toBe("true");
    expect(await child.exited).toBe(0);
    expect(proxyRequests).toBe(0);
    status = 503;
    expect(await isDevelopmentServerReady(server.port!)).toBe(false);
  } finally {
    await server.stop(true);
    await proxy.stop(true);
  }
});

test("development detects both normal and signal-terminated child processes", async () => {
  const normal = Bun.spawn([process.execPath, "-e", "process.exit(0)"]);
  await normal.exited;
  expect(hasProcessExited(normal)).toBe(true);

  for (const signal of ["SIGINT", "SIGTERM", "SIGKILL"] as const) {
    const child = Bun.spawn(["/bin/sleep", "60"]);
    try {
      expect(hasProcessExited(child)).toBe(false);
      child.kill(signal);
      await child.exited;
      expect(child.signalCode).toBe(signal);
      expect(hasProcessExited(child)).toBe(true);
    } finally {
      if (!hasProcessExited(child)) child.kill("SIGKILL");
      await child.exited;
    }
  }
});

test("development startup excludes native interaction wait but still times out afterwards", async () => {
  const { waitUntil } = await import("../src/smoke.ts");
  const start = Date.now();
  const result = await waitUntil(
    async () => (Date.now() - start > 350 ? "ready" : undefined),
    200,
    "startup",
    async () => Date.now() - start < 300,
  );
  expect(result).toBe("ready");
  await expect(
    waitUntil(
      async () => undefined,
      120,
      "startup",
      async () => false,
    ),
  ).rejects.toThrow("timed out");
});
