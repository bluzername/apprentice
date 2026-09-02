# ADR 0004: Loopback service and extension pairing

Status: accepted (2026-09-02)

## Decision

- The Electron main process hosts a plain `http` server bound to `127.0.0.1` on the first free port
  in 47815-47825. The extension probes that range with an unauthenticated `GET /v1/discover`
  that returns only the product name and protocol version.
- Pairing: the app shows a six-digit code valid for five minutes. `POST /v1/pair` with the code and
  the extension id returns a 256-bit random bearer token, stored hashed (SHA-256) in SQLite and
  bound to the `chrome-extension://<id>` origin. Every other request must carry the token and a
  matching `Origin` header; mismatches return 401/403 and are rate-limited.
- Requests are limited to 64 KB bodies, 30 requests per 10 seconds per client, and are validated
  with the Zod schemas in `packages/schemas`.

## Consequences

Any local process can discover the port, but cannot submit events or read the allowlist without the
pairing token. The token never leaves the machine and can be revoked from the Privacy screen.
