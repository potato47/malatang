// Copied to a temporary consumer of the npm archive by pack.ts.
import { strict as assert } from "node:assert";
import { buildPlugin } from "@semicoder/malatang-sdk/build";
import { defineMethod, definePlugin, z } from "@semicoder/malatang-sdk/runtime";
import { createPluginClient } from "@semicoder/malatang-sdk/client";
import { Button, Panel } from "@semicoder/malatang-sdk/ui";

assert.equal(typeof createPluginClient, "function");
assert.equal(typeof Button, "function");
assert.equal(typeof Panel, "function");
const method = defineMethod("echo", z.object({ text: z.string() }), input => input.text);
const plugin = definePlugin({ methods: { echo: method } });
assert.equal(plugin.methods?.echo, method);
assert.equal(await method.execute({ text: "archive works" }, {} as never), "archive works");
assert.throws(() => method.execute({ text: 1 }, {} as never));
for (const directory of ["translate", "quick-notes"]) {
  await buildPlugin(directory);
  const client = await Bun.file(`${directory}/dist/client.js`).text();
  assert(client.includes("__MALATANG_REACT__"), "Plugin must use the host React runtime");
  const imports = new Bun.Transpiler({ loader: "js" }).scanImports(client);
  assert.equal(imports.length, 0, "Plugin dependencies must be bundled or supplied by the host");
}
const backend = (await import(`${process.cwd()}/translate/dist/backend.js`)).default;
assert.equal(typeof backend.methods.translate.execute, "function");
assert((await Bun.file(new URL(import.meta.resolve("@semicoder/malatang-sdk/theme.css"))).text()).includes("--m-bg"));
console.log("Standalone SDK imports, schema validation and frontend/backend builds passed");
