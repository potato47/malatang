import { spawn } from "node:child_process";

if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error("FIA Showcase E2E 仅支持 Apple Silicon macOS");
}
if (process.env.FIA_SHOWCASE_E2E !== "1") {
  console.error("此测试会启动真实 FIA Host，并可能触发屏幕录制/通知权限。确认后运行：");
  console.error("FIA_SHOWCASE_E2E=1 bun run test:e2e");
  process.exit(64);
}

const child = spawn(
  process.execPath,
  ["run", "dev", "--", "--print-session-url", "--emit-action", "open-home"],
  { cwd: import.meta.dir + "/..", stdio: ["ignore", "pipe", "pipe"] },
);
let buffer = "";
let checking = false;
const deadline = setTimeout(() => {
  console.error("等待 FIA Host 会话超时");
  process.exitCode = 1;
  child.kill("SIGTERM");
}, 30_000);
const consume = (chunk: Buffer | string) => {
  buffer += String(chunk);
  const match = /FIA_DEV_SESSION_URL=(\S+)/.exec(buffer);
  const sessionURL = match?.[1];
  if (sessionURL === undefined || checking) return;
  checking = true;
  void (async () => {
    try {
      const bootstrap = await fetch(sessionURL, { redirect: "manual" });
      if (bootstrap.status !== 302) throw new Error(`bootstrap HTTP ${bootstrap.status}`);
      const cookie = bootstrap.headers.get("set-cookie")?.split(";", 1)[0];
      if (cookie === undefined) throw new Error("bootstrap 未返回会话 cookie");
      const origin = new URL(sessionURL).origin;
      const overview = await fetch(`${origin}/api/overview`, { headers: { cookie } });
      if (!overview.ok) throw new Error(`overview HTTP ${overview.status}`);
      const capability = await fetch(`${origin}/api/capabilities`, { headers: { cookie } });
      if (!capability.ok) throw new Error(`capabilities HTTP ${capability.status}`);
      console.log("FIA Showcase 真实 Host 会话 E2E 通过");
      child.kill("SIGTERM");
    } catch (error) {
      console.error(error);
      child.kill("SIGTERM");
      process.exitCode = 1;
    } finally {
      clearTimeout(deadline);
    }
  })();
};
child.stdout.on("data", consume);
child.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
  consume(chunk);
});
const exitCode = await new Promise<number | null>((resolve) => child.on("exit", resolve));
if (process.exitCode !== 1 && exitCode !== 0 && exitCode !== null && exitCode !== 143)
  process.exitCode = exitCode;
