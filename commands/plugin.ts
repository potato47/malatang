import { resolve, join } from "node:path";
import { createRequire } from "node:module";
import { runPluginCreate } from "../packages/sdk/create";
/** Invoked by FIA's supervised application-command process. */
export default async function plugin(context: {
  args: string[];
  cwd: string;
  assetsDirectory: string;
}) {
  const [command] = context.args;
  if (
    !command ||
    command === "create" ||
    context.args.includes("--help") ||
    context.args.includes("-h")
  )
    return runPluginCreate(context.args, {
      cwd: context.cwd,
      sdkArchive: join(context.assetsDirectory, "resources/sdk/malatang-sdk.tgz"),
      templatesDirectory: join(context.assetsDirectory, "resources/sdk/templates"),
    });
  const json = context.args.includes("--json");
  const fail = (message: string) => {
    process.stderr.write(message + "\n");
    if (json) process.stdout.write(JSON.stringify({ ok: false, error: message }) + "\n");
    return 1;
  };
  if (!["check", "build", "pack"].includes(command))
    return fail("未知 plugin 命令；运行 malatang plugin --help");
  const bun = Bun.which("bun");
  if (!bun) return fail("缺少开发者 Bun；请从 https://bun.sh 安装 Bun >= 1.4.2 后重试。");
  const version = Bun.spawnSync([bun, "--version"], { stdout: "pipe", stderr: "pipe" });
  const parts = version.stdout
    .toString()
    .trim()
    .match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (
    version.exitCode !== 0 ||
    !parts ||
    +parts[1]! < 1 ||
    (+parts[1]! === 1 && (+parts[2]! < 4 || (+parts[2]! === 4 && +parts[3]! < 2)))
  )
    return fail("开发者 Bun 版本过旧；请升级到 Bun >= 1.4.2。");
  const args = context.args.slice(1).filter((arg) => arg !== "--json");
  if (args.length > 1 || args[0]?.startsWith("-"))
    return fail("参数无效；运行 malatang plugin --help");
  const root = resolve(context.cwd, args[0] ?? ".");
  let entry: string;
  try {
    entry = createRequire(join(root, "package.json")).resolve("@semicoder/malatang-sdk/plugin");
  } catch {
    return fail(`缺少项目依赖；请进入 ${root} 后运行 bun install --ignore-scripts。`);
  }
  const child = Bun.spawn([bun, entry, command, root, ...(json ? ["--json"] : [])], {
    cwd: context.cwd,
    env: process.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return await child.exited;
}
