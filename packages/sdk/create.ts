import { cp, mkdir, mkdtemp, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { manifestSchema } from "./src/manifest";
import sdkPackage from "./package.json";
export const help = `malatang plugin <create|check|build|pack> [directory] [--json]
  create <directory> [--template notes|model] [--id ID] [--name NAME]
    创建独立项目，默认 notes；不安装依赖或插件，不初始化 Git。
  check [directory]  检查 manifest、TypeScript、Tailwind 入口、CSS Modules 与资源引用。
  build [directory]  检查后构建 dist；失败清除 dist。
  pack [directory]   重新检查和构建，生成并验证 .tgz。
目录默认当前目录（create 必填）。所有子命令支持 --help / --json。
开发者需安装 Bun >= 1.4.2；生成后运行 bun install --ignore-scripts。
`;
export async function createPlugin(
  directory: string,
  options: {
    template?: string;
    id?: string;
    name?: string;
    sdkArchive: string;
    templatesDirectory?: string;
  },
) {
  const root = resolve(directory),
    template = options.template ?? "notes";
  if (!["notes", "model"].includes(template)) throw new Error("template 必须是 notes 或 model");
  const name = options.name ?? basename(root);
  const id =
    options.id ??
    basename(root)
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "");
  const manifest = manifestSchema.parse({
    schemaVersion: 1,
    id,
    name,
    description: template === "notes" ? "使用宿主 KV 保存笔记" : "使用宿主模型进行流式生成",
    icon: template === "notes" ? "记" : "问",
    color: "#686868",
    sdkVersion: "0.3",
    frontend: "dist/client.js",
    styles: "dist/client.css",
    keepAlive: true,
  });
  let existing = false;
  try {
    const info = await stat(root);
    if (!info.isDirectory() || (await readdir(root)).length)
      throw new Error("目标目录非空，不会覆盖已有文件");
    existing = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (!(await Bun.file(options.sdkArchive).exists()))
    throw new Error("应用缺少经过验证的 SDK 快照，请重新构建应用");
  await mkdir(dirname(root), { recursive: true });
  const temporary = await mkdtemp(join(dirname(root), ".malatang-create-"));
  try {
    const templates = options.templatesDirectory ?? join(import.meta.dir, "templates");
    await cp(join(templates, template), temporary, { recursive: true });
    await Bun.write(
      join(temporary, ".gitignore"),
      "node_modules/\ndist/\n*.tgz\n!vendor/\n!vendor/*.tgz\n.malatang-*\n",
    );
    await mkdir(join(temporary, "vendor"));
    await cp(options.sdkArchive, join(temporary, "vendor/malatang-sdk.tgz"));
    for await (const name of new Bun.Glob("**/*").scan({ cwd: temporary, onlyFiles: true })) {
      if (name.endsWith(".tgz")) continue;
      const file = join(temporary, name);
      const source = await Bun.file(file).text();
      await Bun.write(
        file,
        source
          .replaceAll("__PLUGIN_ID__", id)
          .replaceAll("__PLUGIN_NAME_JSON__", JSON.stringify(manifest.name)),
      );
    }
    await Bun.write(
      join(temporary, "package.json"),
      JSON.stringify(
        {
          name: `malatang-plugin-${id}`,
          version: "0.1.0",
          type: "module",
          private: true,
          scripts: {
            check: "bun tools.ts check",
            build: "bun tools.ts build",
            pack: "bun tools.ts pack",
          },
          devDependencies: {
            "@semicoder/malatang-sdk": "file:./vendor/malatang-sdk.tgz",
            "@types/bun": "1.4.0",
            "@types/react": "19.2.17",
            "@types/react-dom": "19.2.3",
            typescript: "7.0.2",
            react: "19.2.7",
            "react-dom": "19.2.7",
          },
          malatang: manifest,
        },
        null,
        2,
      ) + "\n",
    );
    // rmdir only succeeds if an existing destination remained empty.
    if (existing) await import("node:fs/promises").then((fs) => fs.rmdir(root));
    await rename(temporary, root);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  return {
    directory: root,
    template,
    id,
    next: "bun install --ignore-scripts",
    sdkVersion: sdkPackage.version,
  };
}
export async function runPluginCreate(
  args: string[],
  options: { cwd?: string; sdkArchive?: string; templatesDirectory?: string } = {},
) {
  const json = args.includes("--json");
  try {
    if (args.some((arg) => arg === "--help" || arg === "-h") || !args.length) {
      process.stdout.write(json ? JSON.stringify({ help }) + "\n" : help);
      return 0;
    }
    const command = args[0];
    if (!["create", "check", "build", "pack"].includes(command!))
      throw new Error("未知 plugin 命令；运行 malatang plugin --help");
    const positional: string[] = [];
    const flags: Record<string, string> = {};
    for (let index = 1; index < args.length; index++) {
      const arg = args[index]!;
      if (arg === "--json") continue;
      if (arg.startsWith("-")) {
        if (
          command !== "create" ||
          !["--id", "--name", "--template"].includes(arg) ||
          flags[arg] !== undefined ||
          !args[index + 1] ||
          args[index + 1]!.startsWith("--")
        )
          throw new Error(`无效参数：${arg}`);
        flags[arg] = args[++index]!;
      } else positional.push(arg);
    }
    if (positional.length > 1 || (command === "create" && positional.length !== 1))
      throw new Error("create 需要一个目录，其余命令最多接受一个目录");
    const root = resolve(options.cwd ?? process.cwd(), positional[0] ?? ".");
    let result: unknown;
    if (command === "create") {
      if (!options.sdkArchive)
        throw new Error("请通过 malatang plugin create 创建项目以获得 SDK 快照");
      result = await createPlugin(root, {
        template: flags["--template"],
        id: flags["--id"],
        name: flags["--name"],
        sdkArchive: options.sdkArchive,
        templatesDirectory: options.templatesDirectory,
      });
    } else throw new Error("构建命令必须由开发项目 SDK 执行");
    process.stdout.write(
      JSON.stringify({ ok: true, command, result }, null, json ? undefined : 2) + "\n",
    );
    if (command === "create" && !json)
      process.stderr.write(
        `创建完成。进入 ${root} 后运行 bun install --ignore-scripts，然后 bun run check / build / pack。\n`,
      );
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(message + "\n");
    if (json) process.stdout.write(JSON.stringify({ ok: false, error: message }) + "\n");
    return 1;
  }
}
