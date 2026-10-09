import { runPluginTool } from "@semicoder/malatang-sdk/plugin";
process.exitCode = await runPluginTool(process.argv.slice(2), { cwd: import.meta.dir });
