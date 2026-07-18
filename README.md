# FIA Framework

FIA is an experimental macOS desktop UI framework for applications built with TypeScript and Web
technologies. The current repository implements the **phase 0 risk prototype**: a reusable
Swift/AppKit host launches a Bun standalone executable and presents its authenticated local UI in
`WKWebView`.

## Requirements

- macOS 14 or newer on Apple Silicon
- Bun 1.3.14
- Xcode/Swift toolchain capable of Swift tools 6.0

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

The `prototype:*` commands are internal development scripts, not the public `fia` CLI described in
the roadmap. See [the framework documentation](./docs/framework/README.md) and the
[experimental runtime protocol](./docs/framework/10-phase0-runtime-protocol.md).

Implementation progress and upcoming work are tracked in [TODO.md](./TODO.md).
