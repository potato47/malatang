import { agentFetch } from "./agent-cli.ts";
import { createAPIClient, readResult } from "./api-client.ts";
import type { AgentRecord } from "./agent-server.ts";
const { record, sessionId } = JSON.parse(process.env.FIA_SCRIPT_CONNECTION ?? "null") as {
  record: AgentRecord;
  sessionId: string;
};
delete process.env.FIA_SCRIPT_CONNECTION;
const send = agentFetch(record, "script");
const schema = (await readResult(await send("/schema"))) as {
  methods: Record<string, unknown>;
  events: Record<string, unknown>;
};
Object.assign(globalThis, {
  app: createAPIClient(send, sessionId),
  help: (name?: string) =>
    JSON.stringify(
      name
        ? (schema.methods[name] ?? schema.events[name] ?? { error: "Unknown API name" })
        : schema,
      null,
      2,
    ),
});
