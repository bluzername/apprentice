# Model setup

Apprentice runs its vision model behind a replaceable OpenAI-compatible boundary.
There are four ways to satisfy it. Pick one; nothing here needs `sudo`, Homebrew,
or a system-wide install, and every file the scripts write lives under
`~/Library/Application Support/Apprentice` (override with `APPRENTICE_DATA_DIR`).

| Path | When | Memory |
|---|---|---|
| 1. Demo mode (no model) | First look, CI, Playwright journeys | any |
| 2. Existing OpenAI-compatible endpoint | You already run llama.cpp, LM Studio, Ollama, vLLM, or a remote server | depends on host |
| 3. Recommended: llama.cpp + UI-Mate-9B Q6_K (managed) | Alpha default for Apple Silicon | 24 GB recommended |
| 4. Advanced: MLX 6-bit | You want the official MLX route | 24 GB recommended |

All commands run from the repo root with Node 24. Every script accepts `--json`
(machine-readable result on stdout, progress on stderr) and `--check`/`--status`
modes that never touch the network.

## Memory guidance

- Q6_K weights are 7.7 GB and the f16 mmproj is 0.9 GB. With `-c 8192`, the KV
  cache and the image encoder, plan on 24 GB of unified memory for comfortable use
  next to a browser and the Electron app.
- 16 GB machines: do not use Q6_K. Either download a smaller quant from the same
  repository (`IQ4_XS` or `Q4_K_M` in `bartowski/tencent_UI-Mate-9B-GGUF`) and start
  it manually via path 2, or point the app at an external endpoint.
- Apprentice keeps at most 2 screenshots in model context (`imagesToKeep`), which
  is the verified limit for both runtimes.

## Path 1: demo mode (no model)

The desktop app ships a mock provider and synthetic fixtures. Nothing to install.
Select "Demo (no model)" in the model manager. Analysis, skill drafts and assisted
runs come from `packages/test-fixtures`; no inference happens.

## Path 2: existing OpenAI-compatible endpoint

In the app: Settings > Model > "Existing endpoint". Enter the base URL (normally
ending in `/v1`), the model name, and optionally an API key (stored in the macOS
keychain via safeStorage, never in settings files). The app tests `GET /v1/models`
and one harmless screenshot-analysis request.

To make Apprentice use a llama-server you already have (for example from
`brew install llama.cpp`, which is your call; the scripts never run it), either
start it yourself and use this path, or let the scripts manage it:

```bash
export APPRENTICE_LLAMA_SERVER="$(brew --prefix)/bin/llama-server"
node scripts/start-local-model.mjs
```

Any `llama-server` on `PATH` is also picked up automatically (after the env
override and the managed install).

## Path 3 (recommended): llama.cpp + UI-Mate-9B Q6_K

Pins live in `scripts/model-manifest.json` and are the single source of truth for
release, URLs, sizes and SHA-256 sums. The in-app model manager calls the same
scripts.

### 3.1 Install the runtime (11 MB, verified before anything runs)

```bash
node scripts/install-local-runtime.mjs            # or: pnpm model:install-runtime
node scripts/install-local-runtime.mjs --check    # status only, no network
```

What it does:

1. Downloads `llama-b10752-bin-macos-arm64.tar.gz` from the pinned GitHub release
   into `runtime/downloads/` with resume support.
2. Verifies size (11,072,747 bytes) and SHA-256
   (`3c2057747f1d3c618d818960524151e48797d3b7f19fbebacc00124d930e3028`) before
   extraction. A mismatch deletes the file and aborts.
3. Extracts with `tar -xzf` into `runtime/llama-b10752/` (the binary must stay next
   to its dylibs).
4. Runs `llama-server --version` from that directory and requires the output to
   contain `10752`.
5. Writes `runtime/llama-b10752/INSTALLED.json` with release, sha256, verifiedAt
   and the version output.

If the download fails (offline, GitHub outage), the script prints a fallback:
install llama.cpp yourself (for example `brew install llama.cpp`) and set
`APPRENTICE_LLAMA_SERVER` to the binary. It never installs Homebrew or runs brew.

### 3.2 Install the model (8.6 GB, explicit consent required)

```bash
node scripts/install-uimate-model.mjs --yes       # or: pnpm model:install -- --yes
node scripts/install-uimate-model.mjs             # interactive: prints plan, asks "yes"
node scripts/install-uimate-model.mjs --check     # status only (add --verify to re-hash)
```

Before downloading, the script prints the source
(`bartowski/tencent_UI-Mate-9B-GGUF`, upstream `tencent/UI-Mate-9B` at commit
`1cb9e1e4`), the license (Apache-2.0, Tencent), the exact files, sizes, hashes,
total download (8.62 GB) and disk use. Without `--yes` and without a TTY it exits 1.

Files land in `models/ui-mate-9b/`:

- `tencent_UI-Mate-9B-Q6_K.gguf` 7,700,259,968 bytes,
  sha256 `d43523385746a24991f6c84761a34564104ec474041f77987ca9bf660130a971`
- `mmproj-tencent_UI-Mate-9B-f16.gguf` 918,166,016 bytes,
  sha256 `5a8380c4637dddceed9dbc28fffcdfa8601909c0ece9fe218fbd6888ec5d2c16`
- `model.json` with repo, files, sha256s and installedAt

Downloads resume from `<file>.part` using HTTP Range; interrupt with Ctrl-C and
re-run. Every file is hashed after completion and deleted if the hash differs.

Alternative without a managed download: `--use-hf-cache` records that llama-server
should fetch the model itself using the official `-hf` argument (into llama.cpp's
own cache under `~/Library/Caches/llama.cpp`). Nothing is downloaded by the script.

### 3.3 Start, status, stop

```bash
node scripts/start-local-model.mjs                # or: pnpm model:start
node scripts/start-local-model.mjs --port 8000    # fixed port instead of a free one
node scripts/start-local-model.mjs --hf           # official -hf form (uses llama.cpp cache)
node scripts/start-local-model.mjs --status
node scripts/start-local-model.mjs --stop
```

The launcher builds this argument array (no shell, every value its own argv entry):

```text
-m <weights> --mmproj <mmproj> --host 127.0.0.1 --port <port> -ngl 99 -c 8192 --alias UI_Mate --log-file <log>
```

or, with `--hf` (or when the model was recorded with `--use-hf-cache`):

```text
-hf bartowski/tencent_UI-Mate-9B-GGUF:Q6_K --host 127.0.0.1 --port <port> -ngl 99 -c 8192 --alias UI_Mate --log-file <log>
```

It waits for `GET /health` to return 200 (default timeout 300 s, `--timeout <ms>`),
then prints one JSON object on stdout and stays in the foreground, forwarding
SIGINT/SIGTERM to llama-server:

```json
{ "baseUrl": "http://127.0.0.1:52341/v1", "model": "UI_Mate", "port": 52341, "pid": 12345, "logPath": "...", "modelSource": "local" }
```

The server binds only to 127.0.0.1. The port is a free loopback port unless
`--port` is given.

### How the app discovers the endpoint

- The launcher writes `runtime/llama-server.pid` (JSON: pid, port, baseUrl, model,
  logPath, startedAt). The desktop app's model manager reads this record, checks
  the pid is alive and probes `/health`; that is what `--status` does too.
- The JSON printed on stdout is the same contract the model manager consumes when
  it spawns the script itself.
- For any other server, paste `baseUrl` and model name `UI_Mate` into Settings >
  Model > Existing endpoint.

### Logs

- `logs/llama-server-<timestamp>.log`: llama-server's own `--log-file`.
- `logs/llama-server-<timestamp>.log.stdio`: captured stdout/stderr of the process.
- `logs/mlx-setup.log`, `logs/mlx-convert.log`, `logs/mlx-server-<timestamp>.log`:
  MLX route.

### Stopping everything

```bash
node scripts/start-local-model.mjs --stop        # SIGTERM, then SIGKILL after 10 s
```

Ctrl-C in the terminal running the launcher does the same. If the pid file is
stale (machine rebooted), `--status` and `--stop` remove it. For the MLX server,
Ctrl-C the `setup-mlx-route.mjs` process; it forwards the signal to
`mlx_vlm.server`.

## Path 4 (advanced): MLX 6-bit

Follows the official UI-Mate MLX guidance with a private virtual environment at
`mlx-venv/` under the app support directory. The system Python is never modified.

```bash
node scripts/setup-mlx-route.mjs --check          # venv, installed versions, converted weights
node scripts/setup-mlx-route.mjs --dry-run        # prints every command as an argument array
node scripts/setup-mlx-route.mjs --env-only       # create venv + install pins only
node scripts/setup-mlx-route.mjs --yes            # env + convert (multi-GB) + serve
node scripts/setup-mlx-route.mjs --serve          # serve already converted weights
```

Steps:

1. `uv venv <mlx-venv> --python /usr/local/bin/python3` (falls back to
   `python3 -m venv` when `uv` is absent).
2. `uv pip install --python <venv>/bin/python mlx-vlm==0.6.17 mlx==0.32.2 transformers==5.16.1`
   (pins in `mlxPins` in the manifest; resolved from mlx-vlm 0.6.17's
   `requires_dist` on PyPI: `mlx>=0.32.0`, `transformers>=5.14.0`. Refresh with
   `--resolve-pins`, which rewrites the manifest.)
3. Conversion, only after `--yes` or an interactive confirmation because it pulls
   the bf16 checkpoint (~19 GB estimate) into the Hugging Face cache:
   `python -m mlx_vlm.convert --hf-path tencent/UI-Mate-9B --mlx-path <models>/UI-Mate-9B-mlx-6bit -q --q-bits 6 --q-group-size 64`
4. Serve: `KV_BITS=4 PREFILL_STEP_SIZE=1024 python -m mlx_vlm.server --model <path> --host 127.0.0.1 --port <free port>`,
   wait for `GET /health`, print `{ baseUrl, model, port, pid, logPath, route: "mlx" }`.

Keep `imagesToKeep` at 1-2 for MLX. The endpoint is OpenAI-compatible
(`/v1/chat/completions`); the model name is the converted path.

### Upstream cache patch (opt-in only)

No patch is applied by default. If you want to apply an upstream KV-cache patch:

```bash
node scripts/setup-mlx-route.mjs --env-only --patch ./cache.diff --patch-sha256 <sha256 of cache.diff>
```

The script hashes the diff and refuses on mismatch before anything else runs,
then executes `git apply --check`, lists touched files with `git apply --numstat`,
applies it inside the venv's site-packages, and appends an entry
(`patch`, `sha256`, `sitePackages`, `files`, `appliedAt`) to `mlx-venv/PATCHES.json`.

## Troubleshooting

- `No llama-server found`: run `install-local-runtime.mjs`, or set
  `APPRENTICE_LLAMA_SERVER`, or put `llama-server` on PATH.
- `Runtime download failed`: check connectivity; the tarball resumes from
  `runtime/downloads/<asset>.part`. Fallback instructions are printed.
- `SHA-256 mismatch`: the file was deleted. Re-run; if it repeats, the upstream
  asset changed and the manifest pin must be re-verified, not edited blindly.
- `llama-server --version did not report build 10752`: the extracted layout
  changed; the install is not marked as installed. Delete
  `runtime/llama-b10752/` and re-run with `--force`.
- `Timed out ... waiting for /health`: look at the log path printed in the error
  (last 20 lines are included). Typical causes: not enough free memory for Q6_K,
  a corrupted GGUF (`install-uimate-model.mjs --check --verify`), or a port in use
  (pass `--port`).
- `UI-Mate model is not installed`: run `install-uimate-model.mjs --yes` or
  `--use-hf-cache`, or start with `--hf`.
- macOS blocks the binary (Gatekeeper): the release is downloaded by Node without
  a quarantine attribute, so this should not happen. If it does, do not use
  `sudo spctl`; use `xattr -d com.apple.quarantine <path>` on the extracted
  directory yourself, or use the Homebrew fallback.
- Stale `running` status after a crash or reboot: `--status` removes the stale pid
  file automatically.
- MLX `pip install` fails on Python version: mlx 0.32.2 ships wheels for CPython
  3.10-3.13 on macOS arm64; use `/usr/local/bin/python3` (3.13) or a pyenv 3.12.

## Verification status (this machine, 2026-09-02)

Verified for real:

- `node scripts/install-local-runtime.mjs --json` with `APPRENTICE_DATA_DIR` set to
  a scratch directory: downloaded the 11,072,747 byte tarball, matched the pinned
  SHA-256, extracted `llama-b10752/`, and `llama-server --version` printed
  `version: 0.3.0-dev (build 10752, commit b96806d96)`; `INSTALLED.json` written.
- `--check` and `--status` modes of all four scripts against an empty data dir
  (no network).
- `pnpm run test:scripts`: resumable download against a local Range-capable HTTP
  server (abort after ~300 KB, resume, hash match), corrupted download rejected and
  removed, free loopback port, exact llama-server argument arrays, manifest
  validation, CLI check/status/consent behaviour, and a full start -> status ->
  stop cycle against a fake `llama-server` that answers `/health`.
- PyPI metadata for mlx-vlm 0.6.17 (`requires_dist`), mlx 0.32.2 (cp313 macOS
  arm64 wheels present) and transformers 5.16.1; `mlx_vlm.server` accepts
  `--host/--port/--model` and serves `GET /health`; `mlx_vlm.convert` accepts
  `--hf-path/--mlx-path/-q/--q-bits/--q-group-size` (checked in the v0.6.17 source).

NOT verified on this machine:

- No UI-Mate weights were downloaded (neither the 8.6 GB GGUF pair nor the MLX
  checkpoint); the GGUF sizes and hashes come from `docs/BUILD_ENVIRONMENT.md`.
- No inference was run against a real llama-server or mlx_vlm.server; the
  start/stop cycle was exercised with a fake server only.
- The MLX venv was not created and `mlx-vlm==0.6.17` was not installed here; only
  `--check` and `--dry-run` paths ran. Disk estimates for the MLX route are estimates.
- No cache patch was applied (none is shipped).
