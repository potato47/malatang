import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import selectorParser from "postcss-selector-parser";
import valueParser from "postcss-value-parser";

const sdk = dirname(fileURLToPath(import.meta.url));
async function compile(source: string, from: string) {
  return (
    await postcss([tailwind({ base: sdk, optimize: { minify: false } })]).process(source, { from })
  ).css;
}
const imports = (prefix: string) =>
  `@import "tailwindcss/theme.css" layer(theme) prefix(${prefix});\n@import "tailwindcss/utilities.css" layer(utilities) prefix(${prefix}) source(none);\n@import ${JSON.stringify(join(sdk, "src/tailwind.css"))};\n`;
/** Public CSS is precompiled for archive consumers; no application runtime compiler. */
export async function buildUIStyles() {
  const source = imports("ui") + `@source ${JSON.stringify(join(sdk, "src/ui"))};\n`;
  const utilities = await compile(source, join(sdk, "ui.input.css"));
  await mkdir(join(sdk, "dist"), { recursive: true });
  await writeFile(
    join(sdk, "dist/ui.css"),
    utilities + "\n" + (await readFile(join(sdk, "src/ui.css"), "utf8")),
  );
}
export async function buildPluginStyles(root: string, id: string, css: string) {
  const source = imports("p") + `@source ${JSON.stringify(join(root, "src"))};\n`;
  const generated = await compile(source, join(sdk, "plugin.input.css"));
  return scopePluginStyles(generated + "\n" + css, id);
}
/** Namespace CSS globals as well as selectors: @property and keyframes are document-wide. */
export function scopePluginStyles(css: string, id: string) {
  const namespace = "mlt-" + createHash("sha256").update(id).digest("hex").slice(0, 16);
  const scope = `:where([data-plugin-scope=${JSON.stringify(id)}])`;
  const tree = postcss.parse(css);
  const names = new Map<string, string>();
  tree.walkAtRules((rule) => {
    if (/keyframes$/i.test(rule.name)) names.set(rule.params, `${namespace}-${rule.params}`);
  });
  const variable = (name: string) =>
    /^--(?:tw-|p-)/.test(name) ? `--${namespace}-${name.slice(2)}` : name;
  tree.walkAtRules((rule) => {
    if (/keyframes$/i.test(rule.name)) rule.params = names.get(rule.params)!;
    if (rule.name === "property") rule.params = variable(rule.params);
  });
  tree.walkDecls((decl) => {
    if (decl.prop.startsWith("--m-")) throw new Error(`插件不得覆盖主题 token: ${decl.prop}`);
    decl.prop = variable(decl.prop);
    const parsed = valueParser(decl.value);
    parsed.walk((node) => {
      if (node.type === "word") node.value = variable(node.value);
    });
    if (/^(?:-webkit-)?animation(?:-name)?$/.test(decl.prop))
      parsed.walk((node) => {
        if (node.type === "word" && names.has(node.value)) node.value = names.get(node.value)!;
      });
    decl.value = parsed.toString();
  });
  tree.walkRules((rule) => {
    if (rule.parent?.type === "atrule" && /keyframes$/i.test(rule.parent.name)) return;
    // Nested rules already inherit their scoped parent's selector.
    for (
      let parent: postcss.Container | postcss.Document | undefined = rule.parent;
      parent;
      parent = parent.parent
    )
      if (parent.type === "rule") return;
    rule.selector = selectorParser((selectors) => {
      selectors.each((selector) => {
        let rooted = false;
        selector.walkPseudos((node) => {
          if (node.value === ":root" || node.value === ":host") {
            node.replaceWith(selectorParser().astSync(scope).first!.first!.clone());
            rooted = true;
          }
        });
        if (!rooted) {
          selector.prepend(selectorParser.combinator({ value: " " }));
          selector.prepend(selectorParser().astSync(scope).first!.first!.clone());
        }
      });
    }).processSync(rule.selector);
  });
  return tree.toString();
}
if (import.meta.main) await buildUIStyles();
