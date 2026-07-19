# FIA Framework

FIA is a macOS desktop UI framework for applications built with TypeScript and Web technologies.
The repository contains the completed **phase 0 risk prototype** and the current **phase 1 CLI**
work: a reusable Swift/AppKit host launches a Bun standalone executable, while `@fia/cli` provides
environment diagnostics, strict public project configuration, and a React project scaffold.

## Requirements

- macOS 14 or newer on Apple Silicon
- Bun 1.3.14
- Xcode/Swift toolchain capable of Swift tools 6.0

Xcode and Swift are required to develop the Host in this repository, but they are optional in
`fia doctor` because ordinary FIA projects will consume a precompiled Host in a later phase 1
increment.

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
});
```

`fia create hello` generates the default React/Bun template and normally runs `bun install`;
`--no-install` skips installation and `--git` opts into repository initialization. The package is
not published by this repository workflow yet, so workspace smoke tests use `--no-install` or an
injected local package reference.

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

The generated template currently calls `Bun.serve` directly and runs in a browser. It is not yet
connected to the Swift Host security or lifecycle protocol. Public `fia dev`, `fia run`, and
`fia build` commands are not implemented yet. See the
[framework documentation](./docs/framework/README.md), the
[phase 0 validation baseline](./docs/framework/11-phase0-validation.md), and the
[experimental runtime protocol](./docs/framework/10-phase0-runtime-protocol.md).

Implementation progress and upcoming work are tracked in [TODO.md](./TODO.md).
