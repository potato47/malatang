import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { compile } from "json-schema-to-typescript";
import { describeAPI, type APIContract } from "./business-api.ts";
import type { ResolvedFIAConfig } from "./project-config.ts";

export async function generateAgentArtifacts(config: ResolvedFIAConfig, destination: string) {
  const result = await Bun.build({
    entrypoints: [resolve(config.projectRoot, config.api.entry)],
    target: "bun",
    format: "esm",
  });
  if (!result.success) throw new AggregateError(result.logs, "API contract failed to build");
  const module = (await import(
    "data:text/javascript;base64," +
      Buffer.from((await result.outputs[0]!.text()) + "\n//" + crypto.randomUUID()).toString(
        "base64",
      )
  )) as { default: APIContract };
  const schema = describeAPI(module.default);
  const directory = resolve(destination, config.agent.command);
  await mkdir(resolve(directory, "references"), { recursive: true });
  const command = config.agent.command;
  const instructions = config.agent.instructions
    ? await readFile(resolve(config.projectRoot, config.agent.instructions), "utf8")
    : "";
  const skill = `---\nname: ${command}\ndescription: ${JSON.stringify(config.agent.description)}\ncompatibility: macOS 14+, Apple Silicon; requires the ${command} desktop application.\nmetadata:\n  version: ${JSON.stringify(config.app.version)}\n  build: ${JSON.stringify(String(config.app.build))}\n---\n\n# ${config.app.name}\n\nUse the installed \`${command}\` command. The application owns its runtime; no separate Node.js or Bun install is needed.\n\nRun \`${command} help\` and \`${command} schema --json\` for the active application's API. If the build differs from this skill, use the live schema. Read [API reference](references/api.md) for details.\n\nCall a method with \`${command} call METHOD --json '{...}'\`. Subscribe with \`${command} events EVENT --jsonl [--count N] [--timeout MS] [--match JSON]\`. Match is a JSON object of top-level scalar fields (AND). Reaching count exits 0; timeout exits 124 without an error frame. Events have no replay: establish the subscription before triggering work and read current state again after waiting.\n\nCompose operations in TypeScript:\n\n\`\`\`sh\n${command} exec <<'TS'\nconsole.log(help());\n// await app.call("method.name", { ... });\nTS\n\`\`\`\n\nScripts receive app.call(), app.on(), app.onReconnect(), and help(). Use console.log for results. Type definitions are in [agent.d.ts](agent.d.ts). Each invocation is independent. Scripts are trusted local code with file and network access, not sandboxed. The default timeout is 60 seconds; --timeout takes milliseconds, with 0 disabling it.\n\nCLI calls start the application in the background when necessary. Use \`${command} open\` to show the desktop UI. Do not automatically repeat a call after an execution_unknown error: effects may already have occurred. app.on(event, listener, {match}) filters events on the server. Subscription changes reconnect the shared stream and trigger onReconnect. Event reconnection does not replay history; read current state again. Long-lived business jobs must be managed through the application's API.\n\n${instructions}\n`;
  const reference = [
    "# API reference",
    "",
    `Application build: ${config.app.build}`,
    "",
    ...Object.entries(schema.methods).flatMap(([name, method]) => [
      `## ${name}`,
      "",
      method.description,
      "",
      "Input:",
      "```json",
      JSON.stringify(method.input, null, 2),
      "```",
      "Output:",
      "```json",
      JSON.stringify(method.output, null, 2),
      "```",
      ...(method.examples
        ? ["Examples:", "```json", JSON.stringify(method.examples, null, 2), "```"]
        : []),
      "",
    ]),
    ...Object.entries(schema.events).flatMap(([name, event]) => [
      `## Event: ${name}`,
      "",
      event.description,
      "```json",
      JSON.stringify(event.payload, null, 2),
      "```",
      "",
    ]),
  ].join("\n");
  const types: string[] = ["// Generated from the application's API contract.\n"];
  const methods: string[] = [],
    events: string[] = [];
  let index = 0;
  for (const [name, method] of Object.entries(schema.methods)) {
    const id = "Method" + index++;
    types.push(
      `export namespace ${id}InputTypes {\n` +
        (await compile(
          { ...method.input, title: id + "Input" } as Parameters<typeof compile>[0],
          id + "Input",
          {
            bannerComment: "",
          },
        )) +
        "\n}",
    );
    types.push(
      `export namespace ${id}OutputTypes {\n` +
        (await compile(
          { ...method.output, title: id + "Output" } as Parameters<typeof compile>[0],
          id + "Output",
          {
            bannerComment: "",
          },
        )) +
        "\n}",
    );
    methods.push(
      `call(method: ${JSON.stringify(name)}, input: ${id}InputTypes.${id}Input, options?: {signal?: AbortSignal; timeoutMs?: number}): Promise<${id}OutputTypes.${id}Output>;`,
    );
  }
  for (const [name, event] of Object.entries(schema.events)) {
    const id = "Event" + index++;
    types.push(
      `export namespace ${id}Types {\n` +
        (await compile({ ...event.payload, title: id } as Parameters<typeof compile>[0], id, {
          bannerComment: "",
        })) +
        "\n}",
    );
    events.push(
      `on(event: ${JSON.stringify(name)}, listener: (payload: ${id}Types.${id}) => void, options?: {match?: Readonly<Record<string, string | number | boolean | null>>}): () => void;`,
    );
  }
  types.push(
    `export interface FIAApplication {\n${methods.join("\n")}\n${events.join("\n")}\nonReconnect(listener: () => void): () => void;\nclose(): void;\n}\ndeclare global { const app: FIAApplication; function help(name?: string): string; }\n`,
  );
  await writeFile(resolve(directory, "SKILL.md"), skill);
  await writeFile(resolve(directory, "references/api.md"), reference);
  await writeFile(resolve(directory, "schema.json"), JSON.stringify(schema, null, 2) + "\n");
  await writeFile(
    resolve(directory, "metadata.json"),
    JSON.stringify({ description: config.agent.description }) + "\n",
  );
  await writeFile(resolve(directory, "agent.d.ts"), types.join("\n"));
  return schema;
}
