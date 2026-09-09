# @semicoder/fia

FIA 3 creates macOS 14+ Apple Silicon apps with React, Vite, Bun and a precompiled Swift host.

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
| `dev`                                 | Native window, Vite HMR and supervised Bun restart         |
| `run`                                 | Build and launch a production layout                       |
| `build`                               | Assemble and sign a local `.app` without Swift compilation |
| `release`                             | Developer ID signing, notarization, stapling and ZIP       |
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

The minimal config needs only `app`. Optional backend settings are `entry` and `assets`; optional web settings are `root` and `dist`, which must match Vite's output. There are no enabled, mode, template or Swift settings.

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
