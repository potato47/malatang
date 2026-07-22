# `@semicoder/fia`

The command-line interface for FIA, a macOS desktop UI framework built around Bun, AppKit, and
`WKWebView`.

The public surface provides project creation, native development, production execution, signed
local builds, typed desktop configuration, a secure native bridge, and environment diagnostics:

```bash
fia --version
fia create hello
fia create hello --runtime swift
fia create hello --no-install --git
fia dev
fia run
fia build
fia doctor
fia doctor --json
```

Projects import `defineConfig` from the package subpath:

```ts
import { defineConfig } from "@semicoder/fia/config";

export default defineConfig({
  configVersion: 2,
  app: { name: "Hello", identifier: "com.example.hello", mode: "hybrid" },
  ui: "src/ui/index.html",
  window: { closeBehavior: "hide", restoreState: true },
  statusBar: { symbol: "circle.grid.2x2.fill" },
});
```

`runtime: "none"` creates a UI-only production app without `fia-runtime`; omit `entry` in this mode.
Bun remains a development/build dependency for browser bundling and HMR. Omit `runtime` (or use
`runtime: "bun"`) when the application has FIA HTTP or WebSocket routes.

`runtime: "swift"` selects an exclusive Swift backend. It requires Swift 6, a project-local SwiftPM
package, an executable product, and no `entry`:

```ts
export default defineConfig({
  configVersion: 2,
  runtime: "swift",
  app: { name: "Hello", identifier: "com.example.hello" },
  ui: "src/ui/index.html",
  swift: { package: "Backend", product: "HelloBackend" },
});
```

UI code uses the independent asynchronous bridge:

```ts
import { backend } from "@semicoder/fia/backend";

const result = await backend.invoke<{ name: string }, { message: string }>("greet", { name: "FIA" });
const unsubscribe = backend.onEvent("greet.completed", payload => console.log(payload));
```

The npm package also contains the local SwiftPM SDK under `swift/`. Production packages static UI and
`fia-backend` without Bun; development keeps Bun only for browser HMR and restarts the Swift child after
successful source builds.

Web UI code imports the typed Host bridge from the native subpath:

```ts
import { native } from "@semicoder/fia/native";

const state = await native.getState();
await native.statusBar.setVisible(!state.statusBarVisible);
```

Projects import `defineApp` from the runtime subpath instead of calling `Bun.serve` directly:

```ts
import { defineApp } from "@semicoder/fia/runtime";

export default defineApp({
  routes: { "/api/hello": () => Response.json({ message: "Hello" }) },
});
```

`fia dev` uses the embedded arm64 Host and Bun HMR, `fia run` launches a temporary production
build, and `fia build` atomically writes an ad-hoc signed `.app` under `dist/`.

FIA currently requires macOS 14 or newer, Apple Silicon, and Bun 1.3.14 or newer. Swift backend projects
also require Swift 6 at development/build time. The package is prepared for publication but is not
published by this repository workflow yet.
