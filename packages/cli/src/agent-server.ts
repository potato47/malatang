import { chmod, mkdir, readFile, realpath, rename, rm, writeFile, lstat } from "node:fs/promises";
import { createHash, timingSafeEqual } from "node:crypto";
import { dirname, resolve } from "node:path";
import type { InitializeFrame } from "./backend.ts";
import { APIServer, apiError } from "./api-server.ts";
import { APIError } from "./api-client.ts";

export interface AgentRecord {
  hostPID: number;
  protocolVersion: 1;
  identifier: string;
  bundlePath: string;
  runtimeId: string;
  build: number;
  version: string;
  generation: string;
  socket: string;
  token: string;
  phase: "ready" | "updating";
  command: string;
  description?: string;
}
export async function startAgentServer(
  api: APIServer,
  init: InitializeFrame,
  issueBrowserURL?: () => string,
) {
  const directory = resolve(dirname(init.applicationSupport), "Agent");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const hash = createHash("sha256").update(directory).digest("hex").slice(0, 20);
  const sockets = `/tmp/fia-${process.getuid!()}-${hash}`;
  await mkdir(sockets, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
  const info = await lstat(sockets);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid!())
    throw new Error("Unsafe agent socket directory");
  await chmod(sockets, 0o700);
  const socket = resolve(sockets, init.generation.slice(0, 12) + ".sock");
  const token = crypto.randomUUID() + crypto.randomUUID();
  const metadata = await readFile(
    resolve(dirname(init.webRoot), "agent", init.agentCommand!, "metadata.json"),
    "utf8",
  )
    .then((value) => JSON.parse(value) as { description?: string })
    .catch(() => ({}) as { description?: string });
  const record: AgentRecord = {
    protocolVersion: 1,
    hostPID: process.ppid,
    identifier: init.app.identifier,
    bundlePath: await realpath(init.bundlePath!),
    runtimeId: init.runtimeId!,
    build: init.build,
    version: init.version,
    generation: init.generation,
    socket,
    token,
    phase: api.updating ? "updating" : "ready",
    command: init.agentCommand!,
    description: metadata.description,
  };
  const recordPath = resolve(directory, "instance.json");
  const publish = async () => {
    record.phase = api.updating ? "updating" : "ready";
    const path = recordPath + "." + init.generation;
    await writeFile(path, JSON.stringify(record), { mode: 0o600 });
    await rename(path, recordPath);
  };
  const server = Bun.serve({
    unix: socket,
    maxRequestBodySize: 1024 * 1024,
    async fetch(request, server) {
      server.timeout(request, 0);
      const supplied = request.headers.get("authorization") ?? "";
      const expected = "Bearer " + token;
      if (
        Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
      )
        return apiError(new APIError("unauthorized", "Invalid CLI credentials"), 401);
      const path = new URL(request.url).pathname;
      if (path === "/handshake") return Response.json({ result: { ...record, token: undefined } });
      if (request.headers.get("x-fia-generation") !== init.generation)
        return apiError(new APIError("stale_instance", "Application instance changed"), 409);
      if (!api.ready || api.updating)
        return apiError(new APIError("updating", "Application is updating"), 503);
      if (path === "/browser" && request.method === "POST") {
        if (!init.development || !issueBrowserURL)
          return apiError(
            new APIError("forbidden", "Browser access is only available in fia dev"),
            403,
          );
        try {
          return Response.json({ result: { url: issueBrowserURL() } });
        } catch (error) {
          return apiError(error);
        }
      }
      if (["/open", "/quit"].includes(path) && request.method === "POST") {
        try {
          return Response.json({
            result: await api.context.native.call(
              path === "/open" ? "application.show" : "application.quit",
            ),
          });
        } catch (error) {
          return apiError(error);
        }
      }
      return api.fetch(
        request,
        request.headers.get("x-fia-source") === "script" ? "script" : "cli",
      );
    },
  });
  await chmod(socket, 0o600);
  await publish();
  return {
    publish,
    async stop() {
      api.close();
      await server.stop(true);
      await rm(socket, { force: true });
      try {
        const current = JSON.parse(await readFile(recordPath, "utf8"));
        if (current.generation === init.generation && current.phase !== "updating")
          await rm(recordPath);
      } catch {}
    },
  };
}
