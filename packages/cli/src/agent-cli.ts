import { mkdir, readFile, realpath, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { APIError, createAPIClient, readLines, readResult, type APIFetch } from "./api-client.ts";
import { installSkill, manageCLI, type AgentInstallation } from "./agent-install.ts";
import { eventPath, parseEventMatch } from "./api-values.ts";
import type { AgentRecord } from "./agent-server.ts";
import { reservedAgentCommands, type ApplicationCommands } from "./agent-commands.ts";

export function agentFetch(record: AgentRecord, source: "cli" | "script" = "cli"): APIFetch {
  return (path, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set("authorization", "Bearer " + record.token);
    headers.set("x-fia-generation", record.generation);
    headers.set("x-fia-source", source);
    return fetch("http://localhost" + path, { ...init, headers, unix: record.socket });
  };
}
async function startupFailure(app: AgentInstallation, runtimeId: string) {
  try {
    const failure = JSON.parse(
      await readFile(resolve(app.supportPath, "Agent/failure.json"), "utf8"),
    ) as {
      identifier: string;
      runtimeId: string;
      bundlePath: string;
      createdAt: number;
      message: string;
    };
    if (
      failure.identifier === app.identifier &&
      failure.runtimeId === runtimeId &&
      (await realpath(failure.bundlePath)) === app.bundlePath
    )
      return failure;
  } catch {}
}
export async function connectAgent(
  app: AgentInstallation,
  runtimeId: string,
  launch: boolean,
  signal?: AbortSignal,
): Promise<AgentRecord> {
  const path = resolve(app.supportPath, "Agent/instance.json");
  const startedAt = Date.now();
  const deadline = startedAt + (launch ? 20_000 : 1000);
  let launched = false;
  let ownsLaunch = false;
  const lock = resolve(app.supportPath, "Agent/launch.lock");
  try {
    do {
      signal?.throwIfAborted();
      let hostRunning = false;
      try {
        const record = JSON.parse(await readFile(path, "utf8")) as AgentRecord;
        if (Number.isSafeInteger(record.hostPID) && record.hostPID > 1) {
          try {
            process.kill(record.hostPID, 0);
            hostRunning = true;
          } catch {}
        }
        if (hostRunning && record.phase === "updating")
          throw new APIError("updating", "Application is updating");
        const live = (await readResult(
          await agentFetch(record)("/handshake", { signal: AbortSignal.timeout(1000) }),
        )) as AgentRecord;
        if (
          record.protocolVersion !== 1 ||
          record.identifier !== app.identifier ||
          record.runtimeId !== runtimeId ||
          record.bundlePath !== app.bundlePath
        )
          throw new APIError(
            "instance_mismatch",
            `The running application does not match this CLI installation: expected ${JSON.stringify({ identifier: app.identifier, bundlePath: app.bundlePath, runtimeId, protocolVersion: 1 })}, received ${JSON.stringify({ identifier: record.identifier, bundlePath: record.bundlePath, runtimeId: record.runtimeId, protocolVersion: record.protocolVersion })}`,
          );
        if (
          live.identifier !== record.identifier ||
          live.generation !== record.generation ||
          live.bundlePath !== app.bundlePath ||
          live.runtimeId !== runtimeId ||
          live.build !== record.build ||
          live.protocolVersion !== 1
        )
          throw new APIError("instance_mismatch", "Agent handshake mismatch");
        if (live.phase === "updating")
          throw new APIError(
            "updating",
            "Application is updating; retry once the update completes",
          );
        return record;
      } catch (error) {
        if (error instanceof APIError) throw error;
        const failure = await startupFailure(app, runtimeId);
        if (launch && failure && failure.createdAt >= startedAt)
          throw new APIError("startup_failed", failure.message);
        if (!launch) throw new APIError("not_running", "Application is not running");
        if (hostRunning) {
          await Bun.sleep(100);
          continue;
        }
        if (!launched) {
          await mkdir(dirname(lock), { recursive: true, mode: 0o700 });
          try {
            await mkdir(lock, { mode: 0o700 });
            ownsLaunch = true;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
            const info = await stat(lock).catch(() => undefined);
            if (info && Date.now() - info.mtimeMs > 30_000)
              await rm(lock, { recursive: true, force: true });
            await Bun.sleep(100);
            continue;
          }
          launched = true;
          const child = Bun.spawn(
            [
              "/usr/bin/open",
              "-g",
              "--env",
              "FIA_DATA_DIRECTORY=" + dirname(app.supportPath),
              ...(process.env.FIA_CONTROL_DIRECTORY
                ? ["--env", "FIA_CONTROL_DIRECTORY=" + process.env.FIA_CONTROL_DIRECTORY]
                : []),
              app.bundlePath,
              "--args",
              "--agent-background",
            ],
            { stdin: "ignore", stdout: "ignore", stderr: "pipe" },
          );
          if (await child.exited)
            throw new APIError("launch_failed", await new Response(child.stderr).text());
        }
        await Bun.sleep(100);
      }
    } while (Date.now() < deadline);
    throw new APIError("startup_timeout", "Application did not become ready within 20 seconds");
  } finally {
    if (ownsLaunch) await rm(lock, { recursive: true, force: true });
  }
}
const emit = (value: unknown) => process.stdout.write(JSON.stringify(value) + "\n");
function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return;
  const value = args[index + 1];
  if (value === undefined) throw new APIError("usage", "Missing value for " + name);
  args.splice(index, 2);
  return value;
}
function flag(args: string[], name: string) {
  const i = args.indexOf(name);
  if (i < 0) return false;
  args.splice(i, 1);
  return true;
}
function noExtra(args: string[]) {
  if (args.length) throw new APIError("usage", "Unexpected arguments: " + args.join(" "));
}
export async function runAgentCLI(
  argv: readonly string[],
  bundle: string,
  support?: string,
  development = false,
): Promise<number> {
  let client: ReturnType<typeof createAPIClient> | undefined;
  const lifetime = new AbortController();
  const interrupt = () => lifetime.abort(new APIError("cancelled", "Interrupted"));
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  try {
    const bundlePath = await realpath(bundle);
    const manifest = JSON.parse(
      await readFile(resolve(bundlePath, "Contents/Resources/fia.runtime.json"), "utf8"),
    );
    if (manifest.schema !== 4 || !manifest.agent?.command)
      throw new APIError("incompatible_runtime", "Install a FIA 4 application");
    const app: AgentInstallation = {
      bundlePath,
      identifier: manifest.app.identifier,
      command: manifest.agent.command,
      supportPath:
        support ?? resolve(homedir(), "Library/Application Support", manifest.app.identifier),
    };
    const args = [...argv];
    const command = args.shift() ?? "help";
    if (["install", "uninstall", "installation-status"].includes(command)) {
      const directory = option(args, "--dir");
      noExtra(args);
      emit(
        await manageCLI(
          app,
          (command === "installation-status" ? "status" : command) as
            | "install"
            | "uninstall"
            | "status",
          directory && resolve(directory),
        ),
      );
      return 0;
    }
    if (command === "skill") {
      if (args.shift() !== "install")
        throw new APIError("usage", "Use skill install [--dir DIRECTORY]");
      const directory = option(args, "--dir");
      noExtra(args);
      await connectAgent(app, manifest.runtimeId, !development, lifetime.signal);
      emit(await installSkill(app, directory && resolve(directory)));
      return 0;
    }
    let record: AgentRecord;
    try {
      record = await connectAgent(
        app,
        manifest.runtimeId,
        !["status", "quit"].includes(command) && !development,
        lifetime.signal,
      );
    } catch (error) {
      if (command === "status" && error instanceof APIError && error.code === "not_running") {
        flag(args, "--json");
        noExtra(args);
        const failure = await startupFailure(app, manifest.runtimeId);
        emit({
          running: false,
          ...(failure ? { error: { code: "startup_failed", message: failure.message } } : {}),
        });
        return 0;
      }
      throw error;
    }
    const send = agentFetch(record);
    client = createAPIClient(send);
    if (["status", "--version", "version"].includes(command)) {
      flag(args, "--json");
      noExtra(args);
      const { token: _token, socket: _socket, ...publicRecord } = record;
      emit({ ...publicRecord, running: true, frameworkVersion: manifest.frameworkVersion });
      return 0;
    }
    if (command === "open" || command === "quit") {
      const browser = command === "open" && flag(args, "--browser");
      const urlOnly = command === "open" && flag(args, "--url");
      noExtra(args);
      if (urlOnly && !browser) throw new APIError("usage", "--url requires open --browser");
      if (browser) {
        const { url } = (await readResult(
          await send("/browser", { method: "POST", signal: lifetime.signal }),
        )) as { url: string };
        if (urlOnly) process.stdout.write(url + "\n");
        else {
          const child = Bun.spawn(["/usr/bin/open", url], { stdout: "ignore", stderr: "pipe" });
          if (await child.exited)
            throw new APIError(
              "open_failed",
              "Could not open the browser; use open --browser --url",
            );
          emit({ url });
        }
        return 0;
      }
      emit(
        await readResult(await send("/" + command, { method: "POST", signal: lifetime.signal })),
      );
      return 0;
    }
    if (["help", "--help", "-h", "schema"].includes(command)) {
      flag(args, "--json");
      noExtra(args);
      const schema = await readResult(await send("/schema", { signal: lifetime.signal }));
      const extensions =
        command === "schema"
          ? undefined
          : ((await readResult(
              await send("/commands", { signal: lifetime.signal }),
            )) as ApplicationCommands);
      if (command === "schema") emit(schema);
      else
        process.stdout.write(
          `${app.command} — ${record.description ?? manifest.agent.description ?? manifest.app.name}\n\nCommands: help, schema --json, call METHOD --json JSON, events EVENT --jsonl [--count N] [--timeout MS] [--match JSON], exec (--file FILE | -e CODE | < stdin) [--timeout MS] [--jsonl], open [--browser [--url]], status --json, quit, install, uninstall, skill install [--dir DIRECTORY]\n\n${Object.entries(
            extensions?.commands ?? {},
          )
            .map(([name, value]) => `${name}: ${value.description} (${app.command} ${name} --help)`)
            .join("\n")}\n\n${JSON.stringify(schema, null, 2)}\n`,
        );
      return 0;
    }
    if (command === "call") {
      const method = args.shift();
      const input = option(args, "--json") ?? "{}";
      noExtra(args);
      if (!method) throw new APIError("usage", "call requires a method");
      emit(await client.call(method, JSON.parse(input), { signal: lifetime.signal }));
      return 0;
    }
    if (command === "events") {
      const event = args.shift();
      flag(args, "--jsonl");
      const countArg = option(args, "--count");
      const timeoutArg = option(args, "--timeout");
      const matchArg = option(args, "--match");
      noExtra(args);
      const count = countArg === undefined ? Infinity : Number(countArg);
      const timeout = timeoutArg === undefined ? 0 : Number(timeoutArg);
      if (
        (countArg !== undefined &&
          (!/^\d+$/u.test(countArg) || !Number.isSafeInteger(count) || count < 1)) ||
        (timeoutArg !== undefined &&
          (!/^\d+$/u.test(timeoutArg) || !Number.isSafeInteger(timeout) || timeout > 2_147_483_647))
      )
        throw new APIError(
          "usage",
          "--count must be positive; --timeout must be 0..2147483647 milliseconds",
        );
      let match;
      try {
        match = matchArg === undefined ? undefined : parseEventMatch(JSON.parse(matchArg));
      } catch (error) {
        throw new APIError("usage", error instanceof Error ? error.message : String(error));
      }
      const schema = (await readResult(await send("/schema", { signal: lifetime.signal }))) as {
        events: Record<string, unknown>;
      };
      if (!event || !Object.hasOwn(schema.events, event))
        throw new APIError("not_found", "Unknown event: " + event);
      const waiting = new AbortController();
      const signal = AbortSignal.any([lifetime.signal, waiting.signal]);
      const timer = timeout ? setTimeout(() => waiting.abort(), timeout) : undefined;
      let received = 0;
      try {
        for await (const frame of readLines(
          await send(eventPath([{ event, ...(match ? { match } : {}) }]), { signal }),
        )) {
          if (frame.type === "event" && frame.event === event) {
            emit(frame);
            if (++received >= count) return 0;
          }
        }
        if (lifetime.signal.aborted) throw lifetime.signal.reason;
        if (waiting.signal.aborted) return 124;
        throw new APIError(
          "disconnected",
          "Event connection closed; refresh state before subscribing again",
        );
      } catch (error) {
        if (lifetime.signal.aborted) throw lifetime.signal.reason;
        if (waiting.signal.aborted) return 124;
        throw error;
      } finally {
        clearTimeout(timer);
        waiting.abort();
      }
    }
    if (command === "exec") return await executeScript(args, app, record, lifetime.signal);
    if (!reservedAgentCommands.has(command)) {
      const extensions = (await readResult(
        await send("/commands", { signal: lifetime.signal }),
      )) as ApplicationCommands;
      const extension = Object.hasOwn(extensions.commands, command)
        ? extensions.commands[command]
        : undefined;
      if (extension)
        return await executeScript(
          ["--file", extension.entry, "--timeout", "0"],
          app,
          record,
          lifetime.signal,
          { args, assetsDirectory: extensions.assetsDirectory },
        );
    }
    throw new APIError("usage", "Unknown command: " + command);
  } catch (error) {
    const code = lifetime.signal.aborted
      ? "cancelled"
      : error instanceof APIError
        ? error.code
        : "invalid_argument";
    process.stderr.write(
      JSON.stringify({
        error: { code, message: error instanceof Error ? error.message : String(error) },
      }) + "\n",
    );
    return code === "cancelled"
      ? 130
      : code === "timeout"
        ? 124
        : ["updating", "update_busy", "not_running", "execution_unknown", "disconnected"].includes(
              code,
            )
          ? 75
          : code === "usage" || code === "invalid_argument"
            ? 2
            : 1;
  } finally {
    client?.close();
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
  }
}

async function executeScript(
  args: string[],
  app: AgentInstallation,
  record: AgentRecord,
  signal: AbortSignal,
  command?: { args: string[]; assetsDirectory: string },
): Promise<number> {
  const file = option(args, "--file");
  let code = option(args, "-e");
  const timeout = Number(option(args, "--timeout") ?? 60_000);
  const jsonl = flag(args, "--jsonl");
  noExtra(args);
  if (!Number.isSafeInteger(timeout) || timeout < 0 || (file !== undefined && code !== undefined))
    throw new APIError(
      "usage",
      "Choose one script source and a non-negative timeout in milliseconds",
    );
  if (!file && code === undefined) {
    if (process.stdin.isTTY)
      throw new APIError("usage", "Provide --file, -e, or a script on stdin");
    const reader = Bun.stdin.stream().getReader();
    const cancel = () => {
      void reader.cancel();
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      const decoder = new TextDecoder();
      code = "";
      while (true) {
        signal.throwIfAborted();
        const { value, done } = await reader.read();
        if (done) break;
        code += decoder.decode(value, { stream: true });
        if (Buffer.byteLength(code) > 1024 * 1024)
          throw new APIError("resource_limit", "Inline script exceeds 1 MiB");
      }
      signal.throwIfAborted();
      code += decoder.decode();
    } finally {
      signal.removeEventListener("abort", cancel);
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  if (!file && !code?.trim()) throw new APIError("usage", "Script is empty");
  if (code && Buffer.byteLength(code) > 1024 * 1024)
    throw new APIError("resource_limit", "Inline script exceeds 1 MiB");
  const sessionId = crypto.randomUUID();
  const lease = new AbortController();
  const send = agentFetch(record);
  const iterator = readLines(
    await send("/lease", {
      headers: { "x-fia-client": sessionId },
      signal: AbortSignal.any([lease.signal, signal]),
    }),
  );
  const ready = await iterator.next();
  if (ready.value?.type !== "ready")
    throw new APIError("disconnected", "Script lease was not established");
  const preload = resolve(app.bundlePath, "Contents/Resources/script-preload.js");
  let child;
  try {
    child = Bun.spawn(
      [
        resolve(app.bundlePath, "Contents/Helpers/bun"),
        "--no-env-file",
        "--no-orphans",
        "--install=disable",
        "--preload",
        preload,
        ...(file ? [resolve(file)] : ["--eval", code!]),
        ...(command?.args ?? []),
      ],
      {
        cwd: process.cwd(),
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        detached: true,
        env: {
          ...process.env,
          FIA_SCRIPT_CONNECTION: JSON.stringify({ record, sessionId }),
          ...(command ? { FIA_COMMAND_ASSETS: command.assetsDirectory } : {}),
        },
      },
    );
  } catch (error) {
    lease.abort();
    await iterator.return(undefined);
    throw error;
  }
  let failure: APIError | undefined;
  const stop = (error: APIError) => {
    failure ??= error;
    try {
      child.kill("SIGTERM");
    } catch {}
  };
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const kill = () => {
    if (child.exitCode === null) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
    }
  };
  const scheduleKill = () => {
    killTimer ??= setTimeout(kill, 1500);
  };
  const onAbort = () => {
    stop(new APIError("cancelled", "Script cancelled"));
    scheduleKill();
  };
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) onAbort();
  const timer = timeout
    ? setTimeout(() => {
        stop(new APIError("timeout", "Script execution timed out"));
        scheduleKill();
      }, timeout)
    : undefined;
  const monitor = (async () => {
    try {
      for await (const _frame of iterator) {
      }
      if (!lease.signal.aborted) {
        stop(new APIError("disconnected", "Application connection closed"));
        scheduleKill();
      }
    } catch {
      if (!lease.signal.aborted) {
        stop(new APIError("disconnected", "Application connection lost"));
        scheduleKill();
      }
    }
  })();
  const drain = async (stream: ReadableStream<Uint8Array>, channel: "stdout" | "stderr") => {
    const decoder = new TextDecoder();
    for await (const chunk of stream) {
      if (jsonl) emit({ type: channel, data: decoder.decode(chunk, { stream: true }) });
      else process[channel].write(chunk);
    }
    const rest = decoder.decode();
    if (jsonl && rest) emit({ type: channel, data: rest });
  };
  const drains = Promise.all([drain(child.stdout, "stdout"), drain(child.stderr, "stderr")]);
  try {
    const exitCode = await child.exited;
    // Detached descendants must not outlive even a successful script.
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {}
    await drains;
    if (failure) throw failure;
    if (jsonl) emit({ type: "complete", exitCode });
    return exitCode;
  } catch (error) {
    if (jsonl)
      emit({
        type: "error",
        code: error instanceof APIError ? error.code : "script_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    throw error;
  } finally {
    clearTimeout(timer);
    clearTimeout(killTimer);
    signal.removeEventListener("abort", onAbort);
    lease.abort();
    await monitor;
    kill();
  }
}
