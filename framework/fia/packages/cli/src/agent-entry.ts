import { runAgentCLI } from "./agent-cli.ts";
const [bundle, support, ...args] = process.argv.slice(2);
if (!bundle || !support) throw new Error("Launch through FIAHost --cli");
process.exitCode = await runAgentCLI(args, bundle, support);
