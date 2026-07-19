# FIA Framework

FIA is a macOS desktop UI framework for applications built with TypeScript and Web technologies.
The repository contains the completed **phase 0 risk prototype** and the **phase 1 CLI MVP**: a
reusable Swift/AppKit host launches a FIA-managed Bun runtime, while `@fia/cli` provides project
creation, development HMR, production runs, signed local builds, and environment diagnostics.

## Requirements

- macOS 14 or newer on Apple Silicon
- Bun 1.3.14
- Xcode/Swift toolchain capable of Swift tools 6.0 (framework development only)

Ordinary FIA projects consume the versioned arm64 Host embedded in `@fia/cli`, so Xcode and Swift
are not required for `fia create/dev/run/build`.

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
import { defineConfig } from "@fia/cli/config";

export default defineConfig({
  configVersion: 1,
  app: { name: "Hello", identifier: "com.example.hello" },
  ui: "src/ui/index.html",
});
```

The server entry exports declarative application routes:

```ts
import { defineApp } from "@fia/cli/runtime";

export default defineApp({
  routes: { "/api/hello": () => Response.json({ message: "Hello" }) },
});
```

`fia create hello` generates the default React/Bun template and normally runs `bun install`;
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
[phase 0 validation baseline](./docs/framework/11-phase0-validation.md), and the
[experimental runtime protocol](./docs/framework/10-phase0-runtime-protocol.md).

Implementation progress and upcoming work are tracked in [TODO.md](./TODO.md).
