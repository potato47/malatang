# @semicoder/fia

FIA 4 creates macOS 14+ Apple Silicon apps for humans and agents with one typed API, React UI, bundled CLI, TypeScript script SDK and agent skill. React, Vite, Bun and the precompiled Swift host remain the runtime architecture.

```bash
fia create my-app
cd my-app
bun run dev
bun run build
```

There is one project template. `create` accepts `--yes`, `--git/--no-git`, `--install/--no-install` and `--local`. It never asks for a backend or native mode. `--local` installs the current FIA package directory; precompiled assets must already exist.

## Commands

| Command                               | Purpose                                                    |
| ------------------------------------- | ---------------------------------------------------------- |
| `agent <args>`                        | Invoke this project’s running development application      |
| `dev [--open-browser]`                | Native window, Vite HMR and supervised Bun restart         |
| `run`                                 | Build and launch a production layout                       |
| `build`                               | Assemble and sign a local `.app` without Swift compilation |
| `build --dmg`                         | Create and mount-check a local test DMG                    |
| `release`                             | Developer ID signing, notarization, stapling and DMG       |
| `release --update`                    | Signed frontend/backend code release                       |
| `check` / `test`                      | Validate config and TypeScript / run application Bun tests |
| `doctor --target dev\|release --json` | Check runtime assets, OS and publishing tools              |
| `status` / `logs` / `stop`            | Inspect or stop this project's development session         |
| `smoke --json`                        | Production launch, frontend readiness and orderly shutdown |
| `icon F`                              | Render a text icon using the precompiled host              |
| `update keygen --output <directory>`  | Generate an Ed25519 release key pair                       |

`icon` accepts `--background`, `--foreground`, `--output`, and `--force` for exported files. In a project it writes the configured app icon, or `assets/icon.icns`; the standard path is discovered automatically. It does not rewrite executable TypeScript configuration. Keep private update keys outside the repository.

## Configuration

```ts
import { defineConfig } from "@semicoder/fia/config";

export default defineConfig({
  app: { name: "My App", identifier: "com.example.my-app", version: "1.0.0", build: 1 },
  agent: { command: "my-app", description: "Describe what the application can do." },
  statusItem: { symbol: "terminal", tooltip: "My App" },
  signing: {
    releaseIdentity: "Developer ID Application: Example (TEAMID)",
    notarizationProfile: "my-notary-profile",
  },
  updates: {
    url: "https://downloads.example.com/my-app/latest.json",
    publicKey: "BASE64_RAW_ED25519_PUBLIC_KEY",
    downloadURL: "https://example.com/download",
  },
});
```

The minimal config needs `app` and `agent.command/description`. The shared API defaults to `shared/api.ts`; override with `api.entry`. `agent.instructions` can point to application-specific Markdown workflows. Optional backend settings are `entry` and `assets`; optional web settings are `root` and `dist`, which must match Vite's output. There are no enabled, mode, template or Swift settings.

Paths in `backend.assets` are relative to `context.app.codeDirectory`: the project root in development, and the packaged code directory in production. For example, `assets: ["assets/model.wasm"]` can be read with `Bun.file(context.app.codeDirectory + "/assets/model.wasm")`. Store writable user data in `context.app.dataDirectory`.

## Publishing

Generate keys with `fia update keygen --output /secure/path/my-app-keys`, copy the public key into config, and create the first full installer with `fia release`. Configure the same update key before distributing that installer.

For a code update, increase `app.build` and `app.version`, keep the runtime settings unchanged, then run:

```bash
FIA_UPDATE_PRIVATE_KEY_FILE=/secure/path/my-app-keys/update-private.pem fia release --update
```

Upload `dist/updates/releases/<build>/` to the matching `releases/<build>/` directory beside your update URL, then publish `dist/updates/latest.json` at the configured URL. Upload the manifest last. Release directories are immutable; choose a new build number for another release. The CLI creates artifacts and does not upload them.

Both frontend and backend switch together after native confirmation. Native windows survive, but JS memory and connections restart. Persistent state belongs in backend `context.app.dataDirectory`. Keep data migrations compatible with the previous code version. Changes to the host, Bun, system permissions or native configuration need a new installer.

No Swift compiler is used by application create/dev/build/icon. Full installer releases still require the Apple signing and notarization tools and your own Developer ID credentials.

## Application CLI

Install the command explicitly from the application or tray menu (or `native.agent.installCLI()`). The default target is `~/.local/bin`; shell profiles are never modified. The application bundles its own Bun runtime. Move the app first, then reinstall the command to repair its path if necessary.

```bash
my-app schema --json
my-app call counter.increment --json '{"by":1}'
my-app events counter.changed --jsonl
my-app exec -e 'console.log(await app.call("counter.get", {}))'
my-app exec --file workflow.ts --timeout 60000
my-app skill install --dir ~/.agents/skills
my-app open
my-app status --json
my-app quit
```

Calls automatically start the app without presenting a window. `open` presents the existing instance. Scripts are trusted local code, not sandboxed; they run in a supervised Bun child process and finish with the CLI invocation. They may use already installed dependencies, but do not auto-install packages. Event reconnection requires refreshing state; failed writes are never automatically replayed.

The CLI launcher, command name and Bun are part of the immutable runtime. API handlers, schema, UI, skill and type definitions are a single signed code release. Active calls/scripts or an application `beforeUpdate` veto postpone activation. CLI calls return `updating` during the switch and observation period. Candidate skills remain unpublished until commit; rollback retains the previous skill.

See [FIA 4 migration](docs/framework/migration-v4.md) and [framework contract](docs/framework/README.md).

## Browser debugging and event waits

`fia dev` prints a one-use browser URL that expires after 60 seconds. Use `fia dev --open-browser` to open it automatically, or `fia agent open --browser --url` to get a new URL for browser automation. Omit `--url` to open it in the default browser. Obtain a new URL after a backend restart; the bare Vite URL does not establish authentication. Browser debugging connects to the running native host, and is unavailable in production.

```sh
my-app events session.changed --jsonl --count 1 --timeout 30000 \
  --match '{"sessionId":"session-1","status":"idle"}'
```

Matching uses top-level scalar equality (all fields must match). Count completion exits 0; timeout exits 124 without an error frame; cancellation exits 130. No count means unlimited events; no timeout or 0 means unlimited time. Subscribe before triggering work and read current state after waiting; events have no replay.

Shared API requests, responses and individual events each have a 1 MiB UTF-8 limit, including their envelope. Use pagination for histories and custom `defineBackend.http` routes for attachments or token streams. Routes are relative to `/api` and are not exposed by the application CLI. Background lifecycle hooks and routes receive typed `context.emit`. See the packaged [framework documentation](docs/framework/README.md) for background tasks, JSON diagnostics and WebSocket option sharing.
