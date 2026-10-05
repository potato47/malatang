import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildCheckedPlugin, checkPlugin, createPlugin, packPlugin } from "../packages/sdk/plugin";
import { checkStyles } from "../packages/sdk/src/style-check";
import * as UI from "../packages/sdk/src/ui";
import { uiExports } from "../packages/sdk/src/shared-modules";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
const directories: string[] = [];
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });
async function temporary() { const path = await mkdtemp(join(tmpdir(), "malatang plugin test ")); directories.push(path); return path; }
const options = { sdkArchive: resolve("resources/sdk/malatang-sdk.tgz"), templatesDirectory: resolve("packages/sdk/templates") };
async function fixture(template = "notes") { const parent = await temporary(), root = join(parent, "sample project"); await createPlugin(root, { ...options, template }); await symlink(resolve("node_modules"), join(root, "node_modules")); return root; }
test("shared UI exports are complete; controls connect labels, errors and loading state", () => {
  expect(Object.keys(UI).sort()).toEqual([...uiExports].sort());
  const html = renderToStaticMarkup(createElement(UI.Field, { id: "title", label: "标题", error: "必填", children: createElement(UI.Input) }));
  expect(html).toContain('for="title"'); expect(html).toContain('id="title"'); expect(html).toContain('aria-describedby="title-description"'); expect(html).toContain('aria-invalid="true"'); expect(html).toContain('role="alert"');
  const button = renderToStaticMarkup(createElement(UI.Button, { loading: true }, "保存"));
  expect(button).toContain('type="button"'); expect(button).toContain('disabled=""'); expect(button).toContain('aria-busy="true"');
  expect(renderToStaticMarkup(createElement(UI.IconButton, { label: "添加" }, "+"))).toContain('aria-label="添加"');
});
test("create validates names and templates, preserves existing content and ships relative SDK snapshot", async () => {
  const parent = await temporary(), root = join(parent, "notes with spaces");
  const receipt = await createPlugin(root, options); expect(receipt.id).toBe("notes-with-spaces");
  const pkg = await Bun.file(join(root, "package.json")).json(); expect(pkg.devDependencies["@semicoder/malatang-sdk"]).toBe("file:./vendor/malatang-sdk.tgz"); expect(pkg.malatang.sdkVersion).toBe("0.2");
  expect(await Bun.file(join(root, "vendor/malatang-sdk.tgz")).exists()).toBe(true); expect(await Bun.file(join(root, "node_modules")).exists()).toBe(false);
  await expect(createPlugin(root, options)).rejects.toThrow("非空");
  for (const id of ["bad id", "X", "../bad", "settings"]) await expect(createPlugin(join(parent, "other"), { ...options, id })).rejects.toThrow();
  await expect(createPlugin(join(parent, "other"), { ...options, name: "  " })).rejects.toThrow();
  await expect(createPlugin(join(parent, "other"), { ...options, template: "unknown" })).rejects.toThrow();
  await mkdir(join(parent, "empty")); await createPlugin(join(parent, "empty"), options);
});
for (const template of ["notes", "model"]) test(`${template} template checks, shares host UI, packages CSS and referenced assets`, async () => {
  const root = await fixture(template); await checkPlugin(root); await buildCheckedPlugin(root);
  const js = await Bun.file(join(root, "dist/client.js")).text(); expect(js).toContain('__MALATANG_MODULES__'); expect(js).toContain('@semicoder/malatang-sdk/ui'); expect(js).not.toContain('react-dom-client.development'); expect(js).not.toContain('m-panel-header');
  const assets = await Array.fromAsync(new Bun.Glob("dist/assets/*").scan({ cwd: root })); expect(assets.length).toBeGreaterThan(0);
  const archive = await packPlugin(root); expect(await Bun.file(archive).exists()).toBe(true);
  const entries = Bun.spawnSync(["tar", "-tzf", archive]).stdout.toString(); expect(entries).toContain("package/package.json"); expect(entries).toContain("package/dist/client.js"); expect(entries).toContain("package/dist/client.css"); expect(entries).not.toContain("node_modules"); expect(entries).not.toContain("src/");
}, 15000);
test("missing dependencies are actionable; failed builds remove stale dist", async () => {
  const missing = join(await temporary(), "missing"); await createPlugin(missing, options);
  await expect(checkPlugin(missing)).rejects.toThrow("bun install --ignore-scripts");
  const root = await fixture(); await buildCheckedPlugin(root);
  await Bun.write(join(root, "src/client.tsx"), 'import Missing from "./missing"; export default Missing;');
  await expect(buildCheckedPlugin(root)).rejects.toThrow("TypeScript"); expect(await Bun.file(join(root, "dist/client.js")).exists()).toBe(false);
});
test("style constraints reject global rules, private classes, theme overrides and missing resources", async () => {
  const root = await temporary(); await mkdir(join(root, "src"));
  for (const css of ["*{margin:0}", ":root{--m-bg:red}", ".local:global(body){color:red}", ".m-button{color:red}", ".page{--m-bg:red}", ".page{color:#fff}", '.page{background:url("./missing.svg")}']) {
    await Bun.write(join(root, "src/page.module.css"), css); expect((await checkStyles(root)).length).toBeGreaterThan(0);
  }
  await Bun.write(join(root, "src/page.module.css"), ".chart{color:#f00}"); expect(await checkStyles(root, { "src/page.module.css": "数据中的警戒线颜色" })).toEqual([]);
  await Bun.write(join(root, "src/page.module.css"), ".chart{--m-bg:#f00}"); expect((await checkStyles(root, { "src/page.module.css": "品牌" })).length).toBeGreaterThan(0);
});
test("CLI help and JSON keep machine output separate from diagnostics", async () => {
  for (const command of ["create", "check", "build", "pack"]) {
    const child = Bun.spawn([process.execPath, "packages/sdk/plugin.ts", command, "--help", "--json"], { stdout: "pipe", stderr: "pipe" });
    expect(JSON.parse(await new Response(child.stdout).text()).help).toContain("--json"); expect(await child.exited).toBe(0);
  }
  const child = Bun.spawn([process.execPath, "packages/sdk/plugin.ts", "check", "/missing malatang project", "--json"], { stdout: "pipe", stderr: "pipe" });
  expect(JSON.parse(await new Response(child.stdout).text()).ok).toBe(false); expect(await child.exited).toBe(1); expect(await new Response(child.stderr).text()).not.toBe("");
});
