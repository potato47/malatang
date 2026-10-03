import { defineBackend, implementAPI } from "@semicoder/fia/backend";
import { createHash } from "node:crypto";
import { ChatGPT } from "./chatgpt";
import { CHATGPT_USAGE_URL } from "../shared/chatgpt";
import api from "../shared/api";
import { Appearance } from "./appearance";
import { Store } from "./store";
import { Models } from "./models";
import { Plugins } from "./plugins";
import { listProviders, listPresetModels } from "./providers";

let chatgpt: ChatGPT;
let store: Store;
let appearance: Appearance;
let models: Models;
let plugins: Plugins;
export default defineBackend({
  api: implementAPI(api, {
    "appearance.get": () => appearance.get(),
    "appearance.set": ({ theme }) => appearance.set(theme),
    "chatgpt.status": () => chatgpt.status(),
    "chatgpt.signIn": ({ profileId, consent }) => chatgpt.signIn(profileId, consent),
    "chatgpt.cancel": ({ id }) => chatgpt.cancel(id),
    "chatgpt.select": ({ profileId }) => chatgpt.select(profileId),
    "chatgpt.rename": ({ profileId, label }) => chatgpt.rename(profileId, label),
    "chatgpt.remove": ({ profileIds }) => chatgpt.remove(profileIds),
    "chatgpt.signOut": ({ profileId }) => chatgpt.signOut(profileId),
    "chatgpt.acknowledge": ({ profileId }) => chatgpt.acknowledge(profileId),
    "chatgpt.catalog": ({ profileId }) => chatgpt.catalog(profileId),
    "chatgpt.addModel": ({ profileId, modelId }) => models.addChatGPTModel(profileId, modelId),
    "chatgpt.manageUsage": async (_, { native }) => { await native.system.openURL({ url: CHATGPT_USAGE_URL }); return null; },
    "models.list": () => models.list(),
    "models.providers": () => listProviders(),
    "models.catalog": ({ providerId }) => listPresetModels(providerId),
    "models.save": input => models.save(input),
    "models.remove": async ({ id }) => { await models.remove(id); return null; },
    "models.generate": input => plugins.use(input.pluginId, () => models.start(input.pluginId, input)),
    "runs.list": ({ pluginId }) => { plugins.get(pluginId); return models.listRuns(pluginId); },
    "runs.get": ({ pluginId, runId }) => { plugins.get(pluginId); return models.get(pluginId, runId); },
    "runs.cancel": ({ pluginId, runId }) => models.cancel(pluginId, runId),
    "plugins.list": () => plugins.list(),
    "plugins.invoke": ({ pluginId, method, input }) => plugins.invoke(pluginId, method, input),
    "plugins.install": ({ source }) => plugins.install(source),
    "plugins.installExample": () => plugins.installExample(),
    "plugins.jobs": () => plugins.listJobs(),
    "plugins.setEnabled": ({ pluginId, enabled }) => plugins.setEnabled(pluginId, enabled),
    "plugins.uninstall": async ({ pluginId }) => { await plugins.uninstall(pluginId); return null; },
    "kv.get": ({ pluginId, key }) => plugins.use(pluginId, () => store.get(pluginId, key)),
    "kv.set": ({ pluginId, key, value }) => plugins.use(pluginId, async () => { await store.set(pluginId, key, value); return null; }),
    "kv.delete": ({ pluginId, key }) => plugins.use(pluginId, async () => { await store.delete(pluginId, key); return null; }),
  }),
  http: { callbacks: { "/oauth/openai/callback": request => chatgpt?.callback(request) ?? new Response("Starting", { status: 503 }) }, fetch: request => plugins.asset(request) },
  async start({ app, native, emit, url }) {
    store = new Store(app.dataDirectory);
    await store.open();
    appearance = new Appearance(store, mode => native.application.setAppearance({ mode }), theme => emit("appearance.changed", { theme }));
    await appearance.restore();
    let revision = 0;
    const key = "chatgpt.oauth." + createHash("sha256").update(app.dataDirectory).digest("hex");
    const modelChanged = () => emit("models.changed", { revision: ++revision });
    chatgpt = new ChatGPT({ redirectURI: url("/api/oauth/openai/callback").href,
      readSecret: () => native.keychain.get({ key }), writeSecret: value => native.keychain.set({ key, value }), openURL: url => native.system.openURL({ url }),
      changed: () => { emit("chatgpt.changed", { revision: ++revision }); modelChanged(); },
      modelCount: profileId => store.value.models.filter(model => model.chatgptProfileId === profileId).length,
    });
    await chatgpt.open();
    models = new Models(store, run => emit("runs.changed", { pluginId: run.pluginId, runId: run.id, revision: run.revision, status: run.status }), modelChanged, fetch, chatgpt);
    plugins = new Plugins(store, models, app.codeDirectory, () => emit("plugins.changed", { revision: ++revision }));
    await plugins.open();
    await native.windows.update({ id: "main", title: "麻辣烫", width: 1200, height: 800 });
    await native.windows.setTitlebar({ id: "main", items: [] });
  },
  beforeUpdate: () => ({ ready: !models.busy() && !plugins.busy() && !chatgpt.busy(), reason: "模型、插件或登录任务正在运行" }),
  async stop() { await chatgpt?.stop(); await models?.stop(); await plugins?.stop(); },
});
