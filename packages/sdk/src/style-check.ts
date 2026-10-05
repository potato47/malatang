import postcss from "postcss";
import selectorParser from "postcss-selector-parser";
import { resolve, dirname, relative, isAbsolute, sep } from "node:path";
import { realpath } from "node:fs/promises";
export async function checkStyles(root: string, exceptions: Record<string, string> = {}) {
  const diagnostics: string[] = [];
  const files = await Array.fromAsync(new Bun.Glob("src/**/*.css").scan({ cwd: root }));
  for (const name of Object.keys(exceptions)) if (!files.includes(name) || typeof exceptions[name] !== "string" || !exceptions[name]!.trim()) diagnostics.push(`无效颜色例外声明：${name}（需指定样式文件和品牌/数据颜色理由）`);
  for (const name of files) {
    const fail = (reason: string) => diagnostics.push(`${name}: ${reason}`);
    if (!name.endsWith(".module.css")) fail("插件业务样式必须使用 .module.css");
    try {
      await safeFile(root, name);
      const css = postcss.parse(await Bun.file(resolve(root, name)).text(), { from: name });
      css.walkRules(rule => {
        if (rule.parent?.type === "atrule" && /keyframes$/i.test(rule.parent.name)) return;
        selectorParser(selectors => selectors.each(selector => {
          let local = false;
          selector.walk(node => {
            if (node.type === "class") { local = true; if (node.value.startsWith("m-")) fail(`禁止依赖宿主私有类 .${node.value}`); }
            if ((node.type === "pseudo" && /:(?:root|global|host)/.test(node.value)) || (node.type === "tag" && /^(html|body)$/i.test(node.value)) || node.type === "id") fail(`禁止全局选择器 ${node.value}`);
            if (node.type === "attribute" && node.attribute === "data-theme") fail("主题由宿主管理");
          });
          if (!local) fail(`选择器必须位于本地 class 内：${selector}`);
        })).processSync(rule.selector);
      });
      css.walkAtRules(rule => { if (/^(import|font-face|property)$/i.test(rule.name)) fail(`不允许 @${rule.name}；资源请在 CSS Module 中引用`); });
      const references: string[] = [];
      css.walkDecls(decl => {
        if (decl.prop.startsWith("--m-")) fail(`禁止重定义公共 token ${decl.prop}`);
        if (!exceptions[name] && /#[\da-f]{3,8}\b|\b(?:rgb|hsl|oklch|color)\(/i.test(decl.value)) fail(`颜色应引用语义 token；品牌/数据颜色需在 malatangStyleExceptions 中注明理由：${decl.prop}`);
        for (const match of decl.value.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/g)) references.push(match[1]!);
      });
      for (const reference of references) {
        if (/^(?:data:|https?:|\/|#)/i.test(reference)) { fail(`请使用包内资源引用：${reference}`); continue; }
        try { await safeFile(root, relative(root, resolve(dirname(resolve(root, name)), decodeURIComponent(reference.split(/[?#]/)[0]!)))); }
        catch { fail(`资源不存在或越出项目：${reference}`); }
      }
    } catch (error) { fail(String(error)); }
  }
  return diagnostics;
}
export async function safeFile(root: string, name: string) {
  if (isAbsolute(name) || name.includes("\\") || name.split("/").includes("..")) throw new Error(`必须使用包内相对路径：${name}`);
  const base = await realpath(root), path = await realpath(resolve(base, name)), rel = relative(base, path);
  if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel) || !(await Bun.file(path).exists())) throw new Error(`资源越出项目：${name}`);
  return path;
}

/** Host shell rules may arrange public components, but do not restyle their private classes. */
export function checkHostStyles(source: string) {
  const diagnostics: string[] = [];
  const css = postcss.parse(source);
  css.walkRules(rule => {
    if (/\.m-[\w-]+/.test(rule.selector)) diagnostics.push(`宿主外壳不得重写 SDK 私有类：${rule.selector}`);
    if (/(?:^|,)\s*(?:\*|html\b|body\b|:root)/.test(rule.selector)) diagnostics.push(`全局基础样式属于 SDK：${rule.selector}`);
  });
  css.walkDecls(decl => {
    if (decl.prop.startsWith("--m-")) diagnostics.push(`公共 token 只能在 theme.css 定义：${decl.prop}`);
    // Explicit brand/appearance swatches are illustrations of a theme, not UI colors.
    const selector = decl.parent?.type === "rule" ? decl.parent.selector : "";
    if (/#[\da-f]{3,8}\b|\b(?:rgb|hsl|oklch|color)\(/i.test(decl.value) && !/^(?:\.appearance-preview|\.app-icon\.sage)/.test(selector)) diagnostics.push(`宿主 UI 应使用语义颜色：${selector}`);
  });
  return diagnostics;
}
