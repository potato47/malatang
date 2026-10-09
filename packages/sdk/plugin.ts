import { cp, mkdir, mkdtemp, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { buildPlugin } from "./build";
import { manifestSchema } from "./src/manifest";
import { checkStyles, safeFile } from "./src/style-check";
import sdkPackage from "./package.json";
const help = `malatang plugin <create|check|build|pack> [directory] [--json]
  create <directory> [--template notes|model] [--id ID] [--name NAME]
    创建独立项目，默认 notes；不安装依赖或插件，不初始化 Git。
  check [directory]  检查 manifest、TypeScript、CSS Modules 与资源引用。
  build [directory]  检查后构建 dist；失败清除 dist。
  pack [directory]   重新检查和构建，生成并验证 .tgz。
目录默认当前目录（create 必填）。所有子命令支持 --help / --json。
开发者需安装 Bun >= 1.4.2；生成后运行 bun install --ignore-scripts。
`;
async function execute(args: string[], cwd: string, capture = false) {
  const child = Bun.spawn(args, { cwd, stdout: capture ? "pipe" : "inherit", stderr: "inherit" });
  const output = capture ? await new Response(child.stdout).text() : "";
  const code = await child.exited;
  if (code !== 0) throw new Error(`命令失败（退出码 ${code}）：${args[0]} ${args[1]}`);
  return output;
}
export async function checkPlugin(directory: string) {
  const root = resolve(directory), pkg = await Bun.file(join(root, "package.json")).json();
  if (!/^(?:@[a-z0-9][a-z0-9-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(pkg.name ?? "") || typeof pkg.version !== "string" || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(pkg.version)) throw new Error("package name/version 无效");
  if (pkg.malatang?.sdkVersion !== "0.2") throw new Error("插件需要 SDK 0.2，请更新清单并重新构建");
  const manifest = manifestSchema.parse(pkg.malatang);
  await safeFile(root, "src/client.tsx");
  const backendExists = await Bun.file(join(root, "src/backend.ts")).exists();
  if (Boolean(manifest.backend) !== backendExists) throw new Error("src/backend.ts 与 manifest.backend 必须同时声明或省略");
  const diagnostics = await checkStyles(root, pkg.malatangStyleExceptions ?? {});
  for await (const name of new Bun.Glob("src/**/*.{ts,tsx}").scan({ cwd: root })) {
    await safeFile(root, name);
    const source = await Bun.file(join(root, name)).text();
    if (/className\s*=\s*["'][^"']*\bm-/.test(source)) diagnostics.push(`${name}: 禁止依赖宿主私有 CSS class；使用 SDK 组件`);
    for (const match of source.matchAll(/(?:from\s*|import\s*\(?\s*)["']([^"']+)["']/g)) {
      const specifier = match[1]!;
      if (/^(radix-ui|@radix-ui\/|@semicoder\/malatang-sdk\/(?:src\/|theme\.css|ui\.css))/.test(specifier)) diagnostics.push(`${name}: 仅使用 SDK 公开组件入口，不引入宿主实现或全局样式：${specifier}`);
      if (specifier.startsWith(".") && /\.(?:css|svg|png|jpe?g|webp|woff2?)$/.test(specifier)) {
        try { await safeFile(root, join(dirname(name), specifier)); } catch { diagnostics.push(`${name}: 资源不存在或越出项目：${specifier}`); }
      }
    }
  }
  if (diagnostics.length) throw new Error(diagnostics.join("\n"));
  const require = createRequire(join(root, "package.json"));
  let compiler: string;
  try { compiler = join(dirname(require.resolve("typescript/package.json")), "bin/tsc"); require.resolve("@semicoder/malatang-sdk/plugin"); } catch { throw new Error("缺少项目依赖；请在项目目录运行 bun install --ignore-scripts（需要 typescript 和 @semicoder/malatang-sdk）"); }
  // Compiler diagnostics go to stderr, leaving stdout available for --json.
  const child = Bun.spawn([process.execPath, compiler, "--noEmit", "--incremental", "false", "--composite", "false", "--project", join(root, "tsconfig.json")], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (stdout || stderr) process.stderr.write(stdout + stderr);
  if (code !== 0) throw new Error("TypeScript 检查失败");
  return { root, pkg, manifest };
}
export async function buildCheckedPlugin(directory: string) {
  const root = resolve(directory);
  const pkg = await Bun.file(join(root, "package.json")).json();
  if (!pkg.malatang) throw new Error("此目录不是麻辣烫插件项目");
  try { const checked = await checkPlugin(root); await buildPlugin(root); await verifyDist(root, checked.manifest); return checked; }
  catch (error) { await rm(join(root, "dist"), { recursive: true, force: true }); throw error; }
}
async function verifyDist(root: string, manifest: ReturnType<typeof manifestSchema.parse>) {
  for (const name of [manifest.frontend, manifest.styles, ...(manifest.backend ? [manifest.backend] : [])]) await safeFile(root, name);
  const css = await Bun.file(join(root, manifest.styles)).text();
  for (const match of css.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/g)) if (!match[1]!.startsWith("data:")) await safeFile(root, join("dist", match[1]!));
}
export async function packPlugin(directory: string) {
  const { root, pkg, manifest } = await buildCheckedPlugin(directory);
  const temporary = await mkdtemp(join(tmpdir(), "malatang-pack-"));
  const archive = join(root, `${manifest.id}-${pkg.version}.tgz`);
  // Own the package layout: no scripts, SDK dependency, source or local paths shipped to users.
  try {
    const packed = join(temporary, "package"); await mkdir(packed);
    await cp(join(root, "dist"), join(packed, "dist"), { recursive: true });
    await Bun.write(join(packed, "package.json"), JSON.stringify({ name: pkg.name, version: pkg.version, type: "module", malatang: manifest }, null, 2));
    const staged = join(temporary, "plugin.tgz");
    await execute(["tar", "-czf", staged, "-C", temporary, "package"], root, true);
    const unpacked = join(temporary, "verify"); await mkdir(unpacked); await execute(["tar", "-xzf", staged, "-C", unpacked], root, true);
    const extracted = join(unpacked, "package"); const receipt = await Bun.file(join(extracted, "package.json")).json();
    await verifyDist(extracted, manifestSchema.parse(receipt.malatang));
    for await (const name of new Bun.Glob("dist/**/*").scan({ cwd: root, onlyFiles: true })) {
      if (!Buffer.from(await Bun.file(join(root, name)).arrayBuffer()).equals(Buffer.from(await Bun.file(join(extracted, name)).arrayBuffer()))) throw new Error(`归档资源校验失败：${name}`);
    }
    // Cross-volume temporary dirs are allowed: stage on destination before atomic replace.
    const adjacent = archive + ".tmp"; await cp(staged, adjacent); await rename(adjacent, archive);
    return archive;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
export async function createPlugin(directory: string, options: { template?: string; id?: string; name?: string; sdkArchive: string; templatesDirectory?: string }) {
  const root = resolve(directory), template = options.template ?? "notes";
  if (!["notes", "model"].includes(template)) throw new Error("template 必须是 notes 或 model");
  const name = options.name ?? basename(root); const id = options.id ?? basename(root).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  const manifest = manifestSchema.parse({ schemaVersion: 1, id, name, description: template === "notes" ? "使用宿主 KV 保存笔记" : "使用宿主模型进行流式生成", icon: template === "notes" ? "记" : "问", color: "#686868", sdkVersion: "0.2", frontend: "dist/client.js", styles: "dist/client.css", keepAlive: true });
  let existing = false;
  try { const info = await stat(root); if (!info.isDirectory() || (await readdir(root)).length) throw new Error("目标目录非空，不会覆盖已有文件"); existing = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (!(await Bun.file(options.sdkArchive).exists())) throw new Error("应用缺少经过验证的 SDK 快照，请重新构建应用");
  await mkdir(dirname(root), { recursive: true });
  const temporary = await mkdtemp(join(dirname(root), ".malatang-create-"));
  try {
    const templates = options.templatesDirectory ?? join(import.meta.dir, "templates");
    await cp(join(templates, template), temporary, { recursive: true });
    await Bun.write(join(temporary, ".gitignore"), "node_modules/\ndist/\n*.tgz\n!vendor/\n!vendor/*.tgz\n.malatang-*\n");
    await mkdir(join(temporary, "vendor")); await cp(options.sdkArchive, join(temporary, "vendor/malatang-sdk.tgz"));
    for await (const name of new Bun.Glob("**/*").scan({ cwd: temporary, onlyFiles: true })) {
      if (name.endsWith(".tgz")) continue;
      const file = join(temporary, name); const source = await Bun.file(file).text();
      await Bun.write(file, source.replaceAll("__PLUGIN_ID__", id).replaceAll("__PLUGIN_NAME_JSON__", JSON.stringify(manifest.name)));
    }
    await Bun.write(join(temporary, "package.json"), JSON.stringify({ name: `malatang-plugin-${id}`, version: "0.1.0", type: "module", private: true, scripts: { check: "bun tools.ts check", build: "bun tools.ts build", pack: "bun tools.ts pack" }, devDependencies: { "@semicoder/malatang-sdk": "file:./vendor/malatang-sdk.tgz", "@types/bun": "1.4.0", "@types/react": "19.2.17", "@types/react-dom": "19.2.3", typescript: "7.0.2", react: "19.2.7", "react-dom": "19.2.7" }, malatang: manifest }, null, 2) + "\n");
    // rmdir only succeeds if an existing destination remained empty.
    if (existing) await import("node:fs/promises").then(fs => fs.rmdir(root));
    await rename(temporary, root);
  } finally { await rm(temporary, { recursive: true, force: true }); }
  return { directory: root, template, id, next: "bun install --ignore-scripts", sdkVersion: sdkPackage.version };
}
export async function runPluginTool(args: string[], options: { cwd?: string; sdkArchive?: string; templatesDirectory?: string } = {}) {
  const json = args.includes("--json");
  try {
    if (args.some(arg => arg === "--help" || arg === "-h") || !args.length) { process.stdout.write(json ? JSON.stringify({ help }) + "\n" : help); return 0; }
    const command = args[0]; if (!["create", "check", "build", "pack"].includes(command!)) throw new Error("未知 plugin 命令；运行 malatang plugin --help");
    const positional: string[] = []; const flags: Record<string, string> = {};
    for (let index = 1; index < args.length; index++) {
      const arg = args[index]!; if (arg === "--json") continue;
      if (arg.startsWith("-")) { if (command !== "create" || !["--id", "--name", "--template"].includes(arg) || flags[arg] !== undefined || !args[index + 1] || args[index + 1]!.startsWith("--")) throw new Error(`无效参数：${arg}`); flags[arg] = args[++index]!; }
      else positional.push(arg);
    }
    if (positional.length > 1 || (command === "create" && positional.length !== 1)) throw new Error("create 需要一个目录，其余命令最多接受一个目录");
    const root = resolve(options.cwd ?? process.cwd(), positional[0] ?? ".");
    let result: unknown;
    if (command === "create") { if (!options.sdkArchive) throw new Error("请通过 malatang plugin create 创建项目以获得 SDK 快照"); result = await createPlugin(root, { template: flags["--template"], id: flags["--id"], name: flags["--name"], sdkArchive: options.sdkArchive, templatesDirectory: options.templatesDirectory }); }
    else if (command === "check") { await checkPlugin(root); result = { directory: root, checked: true }; }
    else if (command === "build") { await buildCheckedPlugin(root); result = { directory: root, dist: join(root, "dist") }; }
    else result = { directory: root, archive: await packPlugin(root) };
    process.stdout.write(JSON.stringify({ ok: true, command, result }, null, json ? undefined : 2) + "\n");
    if (command === "create" && !json) process.stderr.write(`创建完成。进入 ${root} 后运行 bun install --ignore-scripts，然后 bun run check / build / pack。\n`);
    return 0;
  } catch (error) { const message = error instanceof Error ? error.message : String(error); process.stderr.write(message + "\n"); if (json) process.stdout.write(JSON.stringify({ ok: false, error: message }) + "\n"); return 1; }
}
if (import.meta.main) process.exitCode = await runPluginTool(process.argv.slice(2));
