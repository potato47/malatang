# `@fia/cli`

The command-line interface for FIA, a macOS desktop UI framework built around Bun, AppKit, and
`WKWebView`.

The public surface provides project creation, native development, production execution, signed
local builds, typed configuration, and environment diagnostics:

```bash
fia --version
fia create hello
fia create hello --no-install --git
fia dev
fia run
fia build
fia doctor
fia doctor --json
```

Projects import `defineConfig` from the package subpath:

```ts
import { defineConfig } from "@fia/cli/config";

export default defineConfig({
  configVersion: 1,
  app: { name: "Hello", identifier: "com.example.hello" },
  ui: "src/ui/index.html",
});
```

Projects import `defineApp` from the runtime subpath instead of calling `Bun.serve` directly:

```ts
import { defineApp } from "@fia/cli/runtime";

export default defineApp({
  routes: { "/api/hello": () => Response.json({ message: "Hello" }) },
});
```

`fia dev` uses the embedded arm64 Host and Bun HMR, `fia run` launches a temporary production
build, and `fia build` atomically writes an ad-hoc signed `.app` under `dist/`.

FIA currently requires macOS 14 or newer, Apple Silicon, and Bun 1.3.14. The package is prepared
for publication but is not published by this repository workflow yet.
