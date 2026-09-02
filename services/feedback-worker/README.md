# @apprentice/feedback-worker

Cloudflare Worker + D1 that receives opt-in, allowlisted feedback and telemetry from the Apprentice desktop app and exposes a token-protected summary for the alpha team.

The desktop app never depends on this deployment. Remote feedback is off by default; when it is on, the app previews every payload before upload, and when the endpoint is unreachable the app keeps working and keeps feedback local. If you never deploy this worker, nothing in the product breaks.

## Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | none | `{ ok, service, version, time }` |
| POST | `/v1/feedback` | optional `INGEST_TOKEN` bearer | `RemoteFeedbackPayloadSchema` (installation facts, events, structured feedback, optional warned comment) |
| POST | `/v1/telemetry-batch` | optional `INGEST_TOKEN` bearer | `TelemetryBatchSchema` (1-500 events) |
| GET | `/v1/admin/summary` | `ADMIN_TOKEN` bearer | Aggregates as JSON (see below) |
| GET | `/admin` | token entered in page | Static dashboard, inline CSS/JS only |

Anything else answers `404` JSON. Wrong methods on known paths answer `405` with `Allow`. `OPTIONS` answers `204` with `Allow` and no CORS headers: the desktop app is not a browser origin, so no cross-origin access is ever granted.

Ingestion responses:

- `200 { ok: true, duplicate: false, id }` stored.
- `200 { ok: true, duplicate: true, id }` same bytes were already stored (SHA-256 of the raw body).
- `400 bad_request` body is not JSON.
- `401 unauthorized` `INGEST_TOKEN` is configured and the bearer is missing or wrong.
- `413 payload_too_large` body exceeds `MAX_BODY_BYTES` (default 262144).
- `422 invalid_payload` schema or policy rejection. The response lists `issues: [{ path, code }]` and never echoes values.
- `429 rate_limited` more than 60 submissions per installation per hour or 600 per client IP per hour (`Retry-After` set).

Every response carries `cache-control: no-store`, `x-content-type-options: nosniff`, `referrer-policy: no-referrer`, `x-frame-options: DENY` and a Content-Security-Policy. JSON responses use `default-src 'none'`. The dashboard uses `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'` (connect-src is needed for its same-origin fetch of the summary).

## Schema policy

Validation is layered and every layer must pass:

1. `RemoteFeedbackPayloadSchema` / `TelemetryBatchSchema` from `@apprentice/schemas`, both `.strict()`: unknown keys fail.
2. Deep forbidden-key scan: any key at any depth that matches `FORBIDDEN_REMOTE_KEYS` case-insensitively is rejected (`screenshot`, `ocr`, `url`, `title`, `clipboard`, `text`, `email`, `path`, `prompt`, `response`, `html`, ...). The single exemption is `events[].name`, which is the product event enum.
3. Deep value scan: any string value that looks like a URL or domain, an email address, a base64 blob (200+ base64 characters in a row) or contains `data:image` is rejected.

Rejections report JSON paths and codes only. Payload values are never logged or returned.

Stored columns are limited to: installation id (pseudonymous hex), participant code, app version, macOS major, chip family, memory bucket, provider/model/version, event names with timestamps, risk classes, numeric counts, structured feedback answers, and the user-warned comment. See `migrations/0001_init.sql`.

## Admin summary

`GET /v1/admin/summary` with `Authorization: Bearer <ADMIN_TOKEN>` (constant-time compare) returns:

- `totals`: submissions, distinct installations, feedback items, events.
- `funnel`: event counts by name.
- `candidateRelevanceRate` and `candidateFeedbackCount`.
- `delegationIntent`: `wouldDelegate` distribution.
- `runOutcome`: `outcomeAchieved` distribution.
- `meanTrustRating`, `medianTimeSavedMinutes`.
- `failureCategories`: counts.
- `retention.byDay`: installations with at least one event on day 1, 3 and 7. Day 0 is an installation's first observed activity (earlier of first submission and earliest event timestamp, since events are batched and may predate upload).
- `comments`: the 50 most recent comments (`contextType`, `createdAt`, `comment`).

`GET /admin` is a static page that asks for the token, keeps it in `sessionStorage` only, sends it in the `Authorization` header, and renders the tables. The token never appears in a URL.

## Local run

From the repo root:

```bash
pnpm --filter @apprentice/feedback-worker migrate:local   # applies migrations to the local D1 in .wrangler/
pnpm --filter @apprentice/feedback-worker dev             # wrangler dev on http://localhost:8787
```

Give `wrangler dev` an admin token for the local session with a `.dev.vars` file next to `wrangler.toml` (listed in this package's `.gitignore`, never commit it):

```
ADMIN_TOKEN=local-admin
```

Smoke check:

```bash
curl -s localhost:8787/health
curl -s -X POST localhost:8787/v1/telemetry-batch -H 'content-type: application/json' \
  -d '{"schemaVersion":"1.0","installationId":"0123456789abcdef","appVersion":"0.1.0","events":[{"name":"app_launched","ts":1}]}'
curl -s localhost:8787/v1/admin/summary -H 'authorization: Bearer local-admin'
```

## Test, typecheck, build

```bash
pnpm --filter @apprentice/feedback-worker typecheck
pnpm --filter @apprentice/feedback-worker test       # @cloudflare/vitest-pool-workers, real D1 via Miniflare, migrations applied in setup
pnpm --filter @apprentice/feedback-worker build      # wrangler deploy --dry-run --outdir=dist, works offline
pnpm exec eslint services/feedback-worker --max-warnings=0
```

Tests run inside workerd with a real local D1 (`test/apply-migrations.ts` applies `migrations/` before each file). No Cloudflare account or network access is needed.

## Manual deployment checklist

Nothing below is required for the desktop alpha. Do it only when you want centralized feedback.

1. Authenticate: `pnpm --filter @apprentice/feedback-worker exec wrangler login`, or export `CLOUDFLARE_API_TOKEN` (Workers Scripts:Edit, D1:Edit) and `CLOUDFLARE_ACCOUNT_ID`.
2. Create the database: `pnpm --filter @apprentice/feedback-worker exec wrangler d1 create apprentice-feedback`. Copy the printed `database_id` into `wrangler.toml`, replacing `00000000-0000-0000-0000-000000000000`.
3. Set the admin secret: `pnpm --filter @apprentice/feedback-worker exec wrangler secret put ADMIN_TOKEN` (use a long random value, e.g. `openssl rand -hex 32`).
4. Optional ingestion secret: `pnpm --filter @apprentice/feedback-worker exec wrangler secret put INGEST_TOKEN`. If set, the same value must be configured in the desktop app's Feedback settings. If unset, ingestion is open but rate-limited.
5. Apply migrations remotely: `pnpm --filter @apprentice/feedback-worker run migrate:remote`.
6. Deploy: `pnpm --filter @apprentice/feedback-worker deploy`. Note the `*.workers.dev` URL (or attach a custom domain in the Cloudflare dashboard).
7. Verify: `curl https://<worker-url>/health` and open `https://<worker-url>/admin`, paste the admin token.
8. In the desktop app, open Settings > Feedback, enable remote feedback, and set the endpoint URL (`feedback.endpointUrl`) to `https://<worker-url>`. The upload client posts to `<endpointUrl>/v1/feedback` and `<endpointUrl>/v1/telemetry-batch`. Enter the ingest token if you set one.

Rotate a secret with `wrangler secret put <NAME>` again; the change is live immediately. Delete all data with `wrangler d1 execute apprentice-feedback --remote --command "DELETE FROM events; DELETE FROM feedback_items; DELETE FROM submissions; DELETE FROM rate_limits;"`.
