# FIA Framework

FIA is a macOS desktop UI framework for applications built with TypeScript and Web technologies.
The repository contains the completed **phase 0 risk prototype** and the first **phase 1 CLI**
slice: a reusable Swift/AppKit host launches a Bun standalone executable, while `@fia/cli` provides
the public `fia` command and environment diagnostics.

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
```

`doctor` exits with status 1 only when a required macOS, architecture, Bun, signing, or directory
check fails. Missing native development and release tools are reported as optional warnings.

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

The `prototype:*` commands remain internal development scripts. Public project commands such as
`fia create`, `fia dev`, and `fia build` are not implemented yet. See the
[framework documentation](./docs/framework/README.md), the
[phase 0 validation baseline](./docs/framework/11-phase0-validation.md), and the
[experimental runtime protocol](./docs/framework/10-phase0-runtime-protocol.md).

Implementation progress and upcoming work are tracked in [TODO.md](./TODO.md).
