# ADR 0003: Use the Node built-in `node:sqlite` instead of better-sqlite3

Status: accepted (2026-09-02)

## Context

The specification allows `better-sqlite3` if the Electron rebuild and packaging are configured
correctly. That means compiling a native module twice (Node ABI for tests, Electron ABI for the
app) and shipping a rebuild step in CI. Electron 42 embeds Node 24.19, which ships the
`node:sqlite` module (SQLite 3.53.3). We verified on this machine that `require("node:sqlite")`
works inside the Electron main process and in plain Node 24.

## Decision

Use `node:sqlite` (`DatabaseSync`) for all local persistence with explicit numbered migrations.
Storage code is plain TypeScript in `apps/desktop/src/main/storage` and is tested by vitest under
Node without any native build.

## Consequences

- No native dependencies in the desktop app; packaging is a pure copy.
- `node:sqlite` is marked experimental upstream; the API surface we use (`DatabaseSync`,
  `prepare`, `exec`, `run`, `get`, `all`) is stable across Node 22.13 to 24.x. A thin adapter
  isolates the dependency so `better-sqlite3` can be swapped in if needed.
- WAL mode and `synchronous=NORMAL` are set at open for batched writes.
