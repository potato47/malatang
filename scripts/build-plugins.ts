import { buildCheckedPlugin, packPlugin } from "../packages/sdk/plugin";
import { cp, mkdir, rm } from "node:fs/promises";
await buildCheckedPlugin("plugins/translate");
const packed = await packPlugin("examples/quick-notes");
await mkdir("resources/plugins", { recursive: true });
await cp(packed, "resources/plugins/quick-notes.tgz");
await rm(packed);
console.log("Built translation plugin and packed resources/plugins/quick-notes.tgz");
