# FIA Framework

FIA is a macOS desktop UI framework for applications built with TypeScript and Web technologies.
The repository contains the completed **phase 0 risk prototype**, the **phase 1 CLI MVP**, and the
first **phase 2 desktop shell** slice. A reusable Swift/AppKit host can launch either a FIA-managed Bun
runtime or an application-owned Swift backend, while `@semicoder/fia` provides project creation, HMR,
production runs, signed local builds, desktop application modes, window controls, and typed bridges.

## Requirements

- macOS 14 or newer on Apple Silicon
- Bun 1.3.14 or newer
- Swift 6 toolchain (framework development and `runtime: "swift"` projects)

Ordinary FIA projects consume the versioned arm64 Host embedded in `@semicoder/fia`, so Xcode and Swift
are not required for Bun or UI-only projects. Swift backend projects require Swift 6 while developing
and building; their end users do not need Bun, SwiftPM, or Xcode.

## CLI development

The CLI package is prepared for publication but is currently run from the workspace:

```bash
bun run fia -- --version
bun run fia -- doctor
bun run fia -- doctor --json
bun run fia -- create hello --no-install
```

`doctor` exits with status 1 only when a required macOS, architecture, Bun, signing, or directory
check fails. Missing native development and release tools are reported as optional warnings.

The public package adds a typed configuration entry:

```ts
import { defineConfig } from "@semicoder/fia/config";

export default defineConfig({
  configVersion: 2,
  app: { name: "Hello", identifier: "com.example.hello", mode: "hybrid" },
  ui: "src/ui/index.html",
  window: { closeBehavior: "hide", alwaysOnTop: false },
  statusBar: { symbol: "circle.grid.2x2.fill" },
});
```

Set `runtime: "none"` and omit `entry` for a UI-only application. Development still uses Bun for
bundling and HMR, while production packages the generated UI under `Contents/Resources/UI` and does
not include the Bun runtime executable. The default `runtime: "bun"` keeps the full-stack server entry.

Use the exclusive Swift backend mode when application logic should be written with Swift and Codable:

```ts
export default defineConfig({
  configVersion: 2,
  runtime: "swift",
  app: { name: "Hello", identifier: "com.example.hello" },
  ui: "src/ui/index.html",
  swift: { package: "Backend", product: "HelloBackend" },
});
```

The UI calls it through the separate asynchronous backend bridge:

```ts
import { backend } from "@semicoder/fia/backend";

const value = await backend.invoke<{ name: string }, { message: string }>("greet", { name: "FIA" });
const off = backend.onEvent<{ progress: number }>("sync.progress", event => console.log(event.progress));
```

Production Swift applications contain static `fia-app://` UI and `Contents/MacOS/fia-backend`, with no
`fia-runtime`. During `fia dev`, Bun remains the UI bundler/HMR server; successful Swift rebuilds restart
only the backend process.

Web UI code imports the native desktop API from its own browser entry:

```ts
import { native } from "@semicoder/fia/native";

const state = await native.getState();
await native.window.setAlwaysOnTop(!state.window.alwaysOnTop);
```

The Bun server entry exposes ordinary commands through the same backend bridge used by Swift.
HTTP routes and WebSockets remain optional for streaming, file transfer, and long-lived channels:

```ts
import { defineApp } from "@semicoder/fia/runtime";

export default defineApp({
  backend: {
    methods: {
      greet: ({ name }: { name: string }) => ({ message: `Hello, ${name}` }),
    },
  },
  routes: { "/api/health": () => Response.json({ status: "ok" }) },
});
```

The Web UI calls either Bun or Swift with `backend.invoke()` and receives application events with
`backend.onEvent()`. Bun RPC travels through the Host-owned stdin/stdout NDJSON channel; it does not
use the loopback HTTP session.

`fia create hello` generates the default React/Bun template; `fia create hello --runtime swift` generates
React UI, a SwiftPM backend, and an example RPC. Both normally run `bun install`;
`--no-install` skips installation and `--git` opts into repository initialization. The package is
not published by this repository workflow yet, so workspace smoke tests use `--no-install` or an
injected local package reference.

Inside a generated project, `bun run dev` launches the native window with React HMR, `bun run run`
builds current source into a temporary production application and runs it, and `bun run build`
atomically writes an ad-hoc signed arm64 application to `dist/<application name>.app`.

## Validate and build

```bash
bun install --frozen-lockfile
bun run check
bun run prototype:build
bun run prototype:verify
open dist/FIAPrototype.app
```

`bun run prototype:lifecycle` performs destructive signal tests only against the explicit Host and
Runtime PIDs that it launches itself. Generated files live under `.fia/` and `dist/`.

The generated template uses the FIA-managed Runtime: Host-owned process lifecycle, one-time
bootstrap, authenticated HTTP/WebSocket routes, strict production CSP, and development HMR are
enabled by default. See the [framework documentation](./docs/framework/README.md), the
[phase 0 validation baseline](./docs/framework/11-phase0-validation.md), the
[phase 1 CLI MVP validation](./docs/framework/12-phase1-cli-mvp-validation.md), and the
[experimental runtime protocol](./docs/framework/10-phase0-runtime-protocol.md).

Implementation progress and upcoming work are tracked in [TODO.md](./TODO.md).

## Publish the npm package

Prepare a new version from a clean working tree. This updates package and CLI metadata, refreshes
`bun.lock`, rebuilds the embedded Host, and validates the resulting manifest and checksum:

```bash
bun run version:npm -- 0.3.0
```

Then run the entire npm release workflow from the repository root. The dry run validates version and
Host metadata, runs every test, and asks npm to show the exact public package payload without
publishing it:

```bash
bun run release:npm --dry-run
```

After committing the release changes and logging in to the `https://registry.npmjs.org/` registry,
publish from the same directory:

```bash
npm login --registry https://registry.npmjs.org/
bun run release:npm
```

Before the first public release, choose and add a license, complete the npm repository metadata,
and confirm publish access plus 2FA for the `@semicoder` scope.

The version command requires a clean Git working tree and rolls back package metadata, lockfile, Host,
and manifest if an update step fails. The real release also refuses a dirty tree, verifies that the
exact version is not already published, and publishes the `@semicoder/fia` workspace with public access.
