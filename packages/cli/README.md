# `@fia/cli`

The command-line interface for FIA, a macOS desktop UI framework built around Bun, AppKit, and
`WKWebView`.

The current public surface provides project creation, typed configuration, and environment
diagnostics:

```bash
fia --version
fia create hello
fia create hello --no-install --git
fia doctor
fia doctor --json
```

Projects import `defineConfig` from the package subpath:

```ts
import { defineConfig } from "@fia/cli/config";

export default defineConfig({
  configVersion: 1,
  app: { name: "Hello", identifier: "com.example.hello" },
});
```

The React template runs a direct Bun development server with an HTTP Hello endpoint and WebSocket
Echo. It does not yet implement the Swift Host bootstrap, authentication, or production lifecycle;
`fia dev`, `fia run`, and `fia build` remain later phase 1 work.

FIA currently requires macOS 14 or newer, Apple Silicon, and Bun 1.3.14. The package is prepared
for publication but is not published by this repository workflow yet.
