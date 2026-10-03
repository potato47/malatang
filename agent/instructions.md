## Malatang application workflows

This is a trusted local plugin platform. The host owns model configuration and credentials. Plugins consume models and namespaced KV through the SDK. List plugins and their dynamically declared method schemas with plugins.list before invoking an unfamiliar method.

- Read models.list to select a model. The demo model provides canned output and is not a real translation model. models.save accepts OpenAI-compatible Chat Completions configuration; never print API keys or place them in conversation logs. Model save does not verify connectivity.
- Call plugins.invoke for plugin business methods, or models.generate for direct model use. Both return a run promptly. Subscribe to runs.changed before starting, then read runs.get for the authoritative terminal state. runs.list contains truncated summaries. Cancellation uses runs.cancel. Switching pages does not cancel work.
- Install trusted prebuilt npm / Git / local .tgz packages with plugins.install; installation executes local plugin code after validation. The included archive can be installed with plugins.installExample. Poll plugins.jobs and distinguish saved installation, backend activation and frontend loading.
- Enable/disable with plugins.setEnabled. Uninstall external plugins with plugins.uninstall; this retains KV and history. Active work blocks disable and removal. Reinstallation is the current upgrade path.
- plugins.list reports keepAlive (default false): opt-in pages retain unsaved UI state while hidden in the current window. Default pages unmount on navigation. Disabling, uninstalling or replacing a plugin releases its page; reload/restart does not preserve unsaved drafts. None of these navigation policies cancels host model runs. Installed manifests are not automatically upgraded.
- KV get/set/delete require pluginId. Missing values return null. Each value is limited to 64 KiB.
- Read appearance.get for the saved application theme. appearance.set accepts {"theme":"system"}, {"theme":"light"} or {"theme":"dark"}; it updates native appearance, persists the preference and emits appearance.changed. UI clients reread appearance.get after changes and reconnection. This changes only Malatang, not the macOS system setting.

Events have no replay. Read snapshots initially and after reconnecting. After an unknown execution outcome, query jobs/runs/plugins before repeating a mutation. The application uses FIA's existing CLI; do not start another service or add a parallel CLI.
