import { defineBackend, implementAPI } from "@semicoder/fia/backend";
import api from "../shared/api";
import { Appearance } from "./appearance";
import { Store } from "./store";
import { Models } from "./models";
import { Plugins } from "./plugins";

let store: Store;
let appearance: Appearance;
let models: Models;
let plugins: Plugins;
export default defineBackend({
  api: implementAPI(api, {
    "appearance.get": () => appearance.get(),
    "appearance.set": ({ theme }) => appearance.set(theme),
    "models.list": () => models.list(),
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
  http: { fetch: request => plugins.asset(request) },
  async start({ app, native, emit }) {
    store = new Store(app.dataDirectory);
    await store.open();
    appearance = new Appearance(store, mode => native.application.setAppearance({ mode }), theme => emit("appearance.changed", { theme }));
    await appearance.restore();
    let revision = 0;
    models = new Models(store, run => emit("runs.changed", { pluginId: run.pluginId, runId: run.id, revision: run.revision, status: run.status }), () => emit("models.changed", { revision: ++revision }));
    plugins = new Plugins(store, models, app.codeDirectory, () => emit("plugins.changed", { revision: ++revision }));
    await plugins.open();
    await native.windows.update({ id: "main", title: "麻辣烫", width: 1200, height: 800 });
    await native.windows.setTitlebar({ id: "main", items: [] });
  },
  beforeUpdate: () => ({ ready: !models.busy() && !plugins.busy(), reason: "模型或插件任务正在运行" }),
  async stop() { await models?.stop(); await plugins?.stop(); },
});
