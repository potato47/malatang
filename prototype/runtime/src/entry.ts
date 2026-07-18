import { resolve } from "node:path";
import uiTemplate from "../../../.fia/generated/ui/index.txt" with { type: "text" };
import {
  ProtocolError,
  decodeLines,
  parseInitializeLine,
  parseShutdownLine,
  serializeReady,
} from "./protocol.ts";
import { startRuntimeServer, type RuntimeServer } from "./runtime-server.ts";

async function main(): Promise<void> {
  const lines = decodeLines(Bun.stdin.stream());
  const iterator = lines[Symbol.asyncIterator]();
  const first = await iterator.next();
  if (first.done) throw new ProtocolError("stdin closed before initialize");
  const initialize = parseInitializeLine(first.value);
  if (resolve(initialize.dataDirectory) !== resolve(process.cwd())) {
    throw new ProtocolError("runtime working directory does not match dataDirectory");
  }

  let runtime: RuntimeServer | undefined;
  let stopping: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    if (stopping !== undefined) return stopping;
    stopping = (async () => {
      await runtime?.stop();
    })();
    return stopping;
  };

  const onSignal = (): void => {
    void stop().finally(() => process.exit(0));
  };
  process.once("SIGTERM", onSignal);
  process.once("SIGINT", onSignal);

  runtime = startRuntimeServer({ initialize, uiTemplate });
  process.stdout.write(serializeReady(runtime.port, process.pid));

  try {
    while (true) {
      const next = await iterator.next();
      if (next.done) break;
      if (next.value.length === 0) continue;
      parseShutdownLine(next.value);
      break;
    }
  } finally {
    await stop();
  }
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    const message = error instanceof Error ? error.message : "unknown startup failure";
    process.stderr.write(`fia-runtime: ${message}\n`);
    process.exit(64);
  },
);
