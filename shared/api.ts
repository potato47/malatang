import { defineAPI, z } from "@semicoder/fia/api";
import { chatGPTStatus, chatGPTModel, chatGPTLabel } from "./chatgpt";
export const themeMode = z.enum(["system", "light", "dark"]);
export type ThemeMode = z.infer<typeof themeMode>;
const appearance = z.strictObject({ theme: themeMode });
const modelOptions = z.record(z.string().max(60), z.string().trim().max(300));
export const modelInfo = z.strictObject({ id: z.string(), name: z.string(), provider: z.string(), model: z.string(), baseURL: z.string(), kind: z.enum(["openai-compatible", "pi", "chatgpt"]), configured: z.boolean(), preset: z.string().nullable(), hasApiKey: z.boolean(), chatgptProfileId: z.string().optional(), options: modelOptions });
export const modelInput = z.strictObject({ id: z.string().optional(), name: z.string().trim().min(1).max(100), provider: z.string().trim().min(1).max(100), model: z.string().trim().min(1).max(200), baseURL: z.string().trim().max(2000), apiKey: z.string().max(2000).optional(), clearApiKey: z.boolean().optional(), preset: z.string().nullable().optional(), options: modelOptions.optional() });
const providerPreset = z.strictObject({ id: z.string(), name: z.string(), modelCount: z.number(), apiKeySupported: z.boolean(), keyLabel: z.string(), notice: z.string(), fields: z.array(z.strictObject({ key: z.string(), label: z.string(), placeholder: z.string(), required: z.boolean() })) });
const presetModel = z.strictObject({ id: z.string(), name: z.string(), api: z.string(), baseURL: z.string(), contextWindow: z.number(), reasoning: z.boolean() });
export const run = z.strictObject({ id: z.string(), pluginId: z.string(), modelId: z.string(), title: z.string(), input: z.string(), output: z.string(), status: z.enum(["running", "completed", "cancelled", "failed"]), error: z.string().nullable(), createdAt: z.number(), updatedAt: z.number(), revision: z.number(), demo: z.boolean() });
export const pluginInfo = z.strictObject({ id: z.string(), name: z.string(), description: z.string(), icon: z.string(), color: z.string(), version: z.string(), packageName: z.string(), source: z.string(), builtin: z.boolean(), enabled: z.boolean(), status: z.enum(["active", "disabled", "error"]), error: z.string().nullable(), clientURL: z.string(), styleURL: z.string().nullable(), keepAlive: z.boolean(), methods: z.array(z.strictObject({ name: z.string(), description: z.string(), inputSchema: z.json() })) });
export const installJob = z.strictObject({ id: z.string(), source: z.string(), status: z.enum(["installing", "completed", "failed"]), message: z.string(), pluginId: z.string().nullable(), createdAt: z.number() });
const pluginId = z.string().min(1).max(100);
const key = z.string().min(1).max(200);
const empty = z.strictObject({});
const selection = z.strictObject({ pluginId, runId: z.string() });
export default defineAPI({
  methods: {
    "appearance.get": { description: "Read the saved application theme preference.", input: empty, output: appearance },
    "appearance.set": { description: "Persist light, dark or system theme and apply it to native windows and plugin pages.", input: appearance, output: appearance },
    "chatgpt.status": { description: "Read saved ChatGPT connection summaries without credentials.", input: empty, output: chatGPTStatus },
    "chatgpt.signIn": { description: "Start official ChatGPT OAuth in the system browser; returns promptly. Omit profileId only to register a new account.", input: z.strictObject({ profileId: z.string().optional(), consent: z.boolean().optional() }), output: chatGPTStatus },
    "chatgpt.cancel": { description: "Cancel an outstanding ChatGPT sign-in attempt.", input: z.strictObject({ id: z.string() }), output: chatGPTStatus },
    "chatgpt.select": { description: "Select a saved ChatGPT registration for the settings picker; models retain their original account binding.", input: z.strictObject({ profileId: z.string() }), output: chatGPTStatus },
    "chatgpt.rename": { description: "Rename a saved account without changing its identity or model bindings.", input: z.strictObject({ profileId: z.string(), label: chatGPTLabel }), output: chatGPTStatus },
    "chatgpt.remove": { description: "Remove selected local registrations atomically. Requires signed-out accounts with no bound models or active login. Does not revoke remote registrations.", input: z.strictObject({ profileIds: z.array(z.string()).min(1).max(10) }), output: chatGPTStatus },
    "chatgpt.signOut": { description: "Revoke the renewable session and clear local tokens, retaining the registration.", input: z.strictObject({ profileId: z.string() }), output: chatGPTStatus },
    "chatgpt.acknowledge": { description: "Dismiss the first connected-plan welcome message.", input: z.strictObject({ profileId: z.string() }), output: chatGPTStatus },
    "chatgpt.catalog": { description: "Fetch the current account-specific ChatGPT model catalog using its OAuth token.", input: z.strictObject({ profileId: z.string() }), output: z.array(chatGPTModel) },
    "chatgpt.addModel": { description: "Add a model available to the selected ChatGPT account. Does not generate text or switch billing paths.", input: z.strictObject({ profileId: z.string(), modelId: z.string() }), output: modelInfo },
    "chatgpt.manageUsage": { description: "Open ChatGPT Settings Usage in the system browser.", input: empty, output: z.null() },
    "models.list": { description: "List host-configured models. Credentials are never returned.", input: empty, output: z.array(modelInfo) },
    "models.providers": { description: "List all Pi provider presets and their configuration requirements.", input: empty, output: z.array(providerPreset) },
    "models.catalog": { description: "Read the bundled Pi chat model catalog for one provider.", input: z.strictObject({ providerId: z.string() }), output: z.array(presetModel) },
    "models.save": { description: "Save a Pi preset or custom OpenAI-compatible model. Omitted keys are retained only when provider and endpoint are unchanged.", input: modelInput, output: modelInfo },
    "models.remove": { description: "Remove a configured model; active calls prevent removal.", input: z.strictObject({ id: z.string() }), output: z.null() },
    "models.generate": { description: "Start a background text generation. Poll runs.get or subscribe to runs.changed.", input: z.strictObject({ pluginId, modelId: z.string(), prompt: z.string().min(1).max(16000), system: z.string().max(16000).optional(), title: z.string().max(100).optional() }), output: run },
    "runs.list": { description: "Read the latest 30 run summaries (input/output truncated to 300 characters). Use runs.get for full content.", input: z.strictObject({ pluginId }), output: z.array(run) },
    "runs.get": { description: "Read the authoritative state of a plugin run, also after event reconnection.", input: selection, output: run },
    "runs.cancel": { description: "Cancel an active run and wait until its terminal state is saved.", input: selection, output: run },
    "plugins.list": { description: "List installed and built-in applications and their activation state.", input: empty, output: z.array(pluginInfo) },
    "plugins.invoke": { description: "Call a plugin method. Discover method names and input schemas with plugins.list.", input: z.strictObject({ pluginId, method: z.string().min(1).max(100), input: z.json() }), output: z.json() },
    "plugins.install": { description: "Install a trusted, prebuilt plugin from an npm spec, Git URL or absolute local .tgz path. Returns an installation job.", input: z.strictObject({ source: z.string().trim().min(1).max(2000) }), output: installJob },
    "plugins.installExample": { description: "Install the included independently packed Quick Notes example.", input: empty, output: installJob },
    "plugins.jobs": { description: "Read recent installation job outcomes and progress.", input: empty, output: z.array(installJob) },
    "plugins.setEnabled": { description: "Enable or disable a plugin. Active runs must finish or be cancelled first.", input: z.strictObject({ pluginId, enabled: z.boolean() }), output: pluginInfo },
    "plugins.uninstall": { description: "Remove an external plugin and its managed package files. KV and run history are retained.", input: z.strictObject({ pluginId }), output: z.null() },
    "kv.get": { description: "Read a plugin-scoped JSON value; absent keys return null.", input: z.strictObject({ pluginId, key }), output: z.json() },
    "kv.set": { description: "Persist a plugin-scoped JSON value (maximum 64 KiB).", input: z.strictObject({ pluginId, key, value: z.json() }), output: z.null() },
    "kv.delete": { description: "Delete a plugin-scoped key.", input: z.strictObject({ pluginId, key }), output: z.null() },
  },
  events: {
    "appearance.changed": { description: "Theme preference changed. Reread appearance.get on reconnect.", payload: appearance },
    "runs.changed": { description: "A run changed. Read its current snapshot; notifications have no replay.", payload: z.strictObject({ pluginId: z.string(), runId: z.string(), revision: z.number(), status: run.shape.status }) },
    "plugins.changed": { description: "Plugin registry or installation jobs changed. Reread their current state.", payload: z.strictObject({ revision: z.number() }) },
    "chatgpt.changed": { description: "ChatGPT connection or login changed. Reread chatgpt.status.", payload: z.strictObject({ revision: z.number() }) },
    "models.changed": { description: "Host model configurations changed.", payload: z.strictObject({ revision: z.number() }) },
  },
});
