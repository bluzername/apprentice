# Build environment (inspected 2026-09-02)

| Item | Value |
|---|---|
| Machine | Apple M3 Max, arm64, 36 GB unified memory |
| macOS | 26.6 (build 25G5028f) |
| Free disk | 93 GiB of 926 GiB |
| Node | v24.10.0 (npm 11.6.2) |
| pnpm | 10.33.0 (store: ~/Library/pnpm/store/v10) |
| corepack | 0.34.0 |
| Swift | 6.2.4 (swiftlang-6.2.4.1.4), Xcode 26.3 (17C529), CLT at /Applications/Xcode.app/Contents/Developer |
| Python | 3.13.0 at /usr/local/bin/python3, uv 0.8.17, pyenv available |
| Homebrew | 6.0.17 at /opt/homebrew (ollama, mlx, mlx-c, sqlite, cmake present; llama.cpp NOT installed) |
| Git | 2.50.1 (Apple Git-155) |
| gh | authenticated (bluzername) |
| Code signing | "Apple Development" and "Developer ID Application" identities present in keychain |
| Notarization credentials | not present in environment (APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID unset) |
| Cloudflare | wrangler not installed globally; no CLOUDFLARE_API_TOKEN in environment |
| Electron cache | ~/Library/Caches/electron has v33.4.11 arm64 |
| Local model | no llama-server on PATH, mlx Python package not installed in system Python, no UI-Mate weights present |

## Upstream sources verified during implementation

| Source | Pinned |
|---|---|
| Tencent/UI-Mate | commit `1cb9e1e44ce856e23b593992b02efbd489943fcb` (2026-09-01), Apache-2.0 |
| tencent/UI-Mate-9B (Hugging Face) | Qwen3.5-9B based, Apache-2.0 |
| bartowski/tencent_UI-Mate-9B-GGUF Q6_K | `tencent_UI-Mate-9B-Q6_K.gguf` 7,700,259,968 bytes, sha256 `d43523385746a24991f6c84761a34564104ec474041f77987ca9bf660130a971` |
| mmproj (f16) | `mmproj-tencent_UI-Mate-9B-f16.gguf` 918,166,016 bytes, sha256 `5a8380c4637dddceed9dbc28fffcdfa8601909c0ece9fe218fbd6888ec5d2c16` |
| llama.cpp release | `b10752` (2026-09-02) `llama-b10752-bin-macos-arm64.tar.gz` 11,072,747 bytes, sha256 `3c2057747f1d3c618d818960524151e48797d3b7f19fbebacc00124d930e3028`, downloaded and executed on this machine (`llama-server --version` reports build 10752) |
| mlx-vlm (PyPI) | 0.6.17 |

## Toolchain decisions

- TypeScript 5.9.x (not the 7.x native preview) for ecosystem compatibility.
- Electron 42.x (Chromium 148, Node 24.19) with electron-vite 5 and electron-builder 26.
- vitest 4.1 everywhere, including `@cloudflare/vitest-pool-workers` 0.22 for the Worker.
- Swift Package Manager for the helper; `swift build -c release --arch arm64`.
