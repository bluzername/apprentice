# ADR 0001: Toolchain and versions

Status: accepted (2026-09-02)

## Decision

- TypeScript 5.9.x in strict mode. The TypeScript 7 native preview was available but the
  ESLint, Vite, and electron-vite ecosystem had not caught up; 5.9 is the safe choice for an alpha.
- Electron 42.11.1 (Chromium 148, Node 24.19). Pinned exactly because electron-builder needs a
  fixed version.
- electron-vite 5 with Vite 7 for main/preload/renderer bundling, React 19 in the renderer.
- vitest 4.1 for every package, `@cloudflare/vitest-pool-workers` 0.22 for the Worker.
- Swift Package Manager (Swift 6.2 toolchain, Swift 5 language mode) for the native helper.
- pnpm 10 workspaces with `node-linker=hoisted` so Electron packaging sees a flat node_modules.

## Consequences

Renderer and main share one TypeScript config base. The alpha does not use TypeScript project
references; each package typechecks its own sources and imports workspace packages by source.
