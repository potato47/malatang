import { chmod, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";

interface SessionRecord {
  schemaVersion: 1;
  root: string;
  socket: string;
  token: string;
  id: string;
}
export interface SessionEvent {
  time: string;
  event: string;
  component: string;
  message?: string;
  [key: string]: unknown;
}

export async function requestSession(
  root: string,
  action: "status" | "logs" | "stop",
): Promise<unknown> {
  const canonical = await realpath(root);
  let record: SessionRecord;
  try {
    record = JSON.parse(await readFile(resolve(canonical, ".fia/dev/session.json"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return action === "logs" ? await savedLogs(canonical) : { schemaVersion: 1, running: false };
    throw error;
  }
  if (record.schemaVersion !== 1 || record.root !== canonical)
    throw new Error("Development session does not belong to this project");
  try {
    const response = await fetch(`http://localhost/${action}`, {
      unix: record.socket,
      method: action === "stop" ? "POST" : "GET",
      headers: { authorization: `Bearer ${record.token}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error(`Session rejected ${action}: ${response.status}`);
    return await response.json();
  } catch (error) {
    if (action === "stop")
      throw new Error(
        "Session owner is unavailable. No process was signalled; confirm the old owner has exited, remove .fia/dev/session.lock, then restart fia dev.",
        { cause: error },
      );
    return action === "logs"
      ? await savedLogs(canonical)
      : { schemaVersion: 1, running: false, stale: true };
  }
}

async function savedLogs(root: string) {
  try {
    return {
      schemaVersion: 1,
      running: false,
      events: JSON.parse(await readFile(resolve(root, ".fia/dev/events.json"), "utf8")),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { schemaVersion: 1, running: false, events: [] };
    throw error;
  }
}

export async function createSession(
  root: string,
  stop: () => void,
  inspect: () => Promise<unknown>,
  output: (event: SessionEvent) => void,
) {
  const canonical = await realpath(root);
  const directory = resolve(canonical, ".fia/dev");
  await mkdir(directory, { recursive: true });
  const id = crypto.randomUUID();
  const token = crypto.randomUUID() + crypto.randomUUID();
  const hash = createHash("sha256").update(canonical).digest("hex").slice(0, 20);
  const socket = resolve(tmpdir(), `fia-${process.getuid?.() ?? "user"}-${hash}.sock`);
  const recordPath = resolve(directory, "session.json");
  const lockPath = resolve(directory, "session.lock");
  // Exclusive project ownership prevents concurrent launchers from unlinking each other's socket.
  try {
    await mkdir(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error(
        "This project already has a development session or an interrupted session.lock. Use fia status/stop; remove a stale lock only after its owner has exited.",
      );
    throw error;
  }
  let previous: { running?: boolean };
  try {
    previous = (await requestSession(canonical, "status")) as { running?: boolean };
  } catch (error) {
    await rm(lockPath, { recursive: true, force: true });
    throw error;
  }
  if (previous.running) {
    await rm(lockPath, { recursive: true });
    throw new Error("This project already has a development session. Use fia status or fia stop.");
  }
  // A stale socket has no listener; unlinking it never signals a PID.
  await rm(socket, { force: true });
  const events: SessionEvent[] = [];
  const logsPath = resolve(directory, "events.json");
  let flushTask = Promise.resolve();
  const flush = () => {
    const snapshot = JSON.stringify(events);
    flushTask = flushTask
      .catch(() => {})
      .then(async () => {
        const temporary = resolve(directory, `events-${id}.tmp`);
        await writeFile(temporary, snapshot, { mode: 0o600 });
        await rename(temporary, logsPath);
      });
    return flushTask;
  };
  let server: ReturnType<typeof Bun.serve>;
  try {
    server = Bun.serve({
      unix: socket,
      fetch: async (request) => {
        if (request.headers.get("authorization") !== `Bearer ${token}`)
          return new Response("Unauthorized", { status: 401 });
        const action = new URL(request.url).pathname;
        if (action === "/stop" && request.method === "POST") {
          stop();
          return Response.json({ schemaVersion: 1, stopping: true, id });
        }
        if (action === "/logs") return Response.json({ schemaVersion: 1, id, events });
        if (action === "/status")
          return Response.json({
            schemaVersion: 1,
            id,
            root: canonical,
            running: true,
            runtime: await inspect(),
          });
        return new Response("Not Found", { status: 404 });
      },
    });
  } catch (error) {
    await rm(lockPath, { recursive: true, force: true });
    throw error;
  }
  try {
    await chmod(socket, 0o600);
    await writeFile(
      recordPath,
      JSON.stringify({
        schemaVersion: 1,
        root: canonical,
        socket,
        token,
        id,
      } satisfies SessionRecord),
      { mode: 0o600 },
    );
  } catch (error) {
    await server.stop(true);
    await rm(socket, { force: true });
    await rm(lockPath, { recursive: true, force: true });
    throw error;
  }
  const flushTimer = setInterval(() => {
    void flush().catch(() => {});
  }, 1000);
  flushTimer.unref();
  return {
    emit(event: Omit<SessionEvent, "time">) {
      const value = { ...event, time: new Date().toISOString() } as SessionEvent;
      events.push({
        ...value,
        ...(typeof value.message === "string" ? { message: value.message.slice(-32768) } : {}),
      });
      while (events.length > 256) events.shift();
      output(value);
    },
    async close() {
      clearInterval(flushTimer);
      try {
        await flush();
      } finally {
        await server.stop(true);
        await rm(socket, { force: true });
        await rm(recordPath, { force: true });
        await rm(lockPath, { recursive: true, force: true });
      }
    },
  };
}
