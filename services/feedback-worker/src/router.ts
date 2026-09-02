import type { Env } from "./env.js";
import { bearerMatches } from "./auth.js";
import { renderAdminPage } from "./admin-page.js";
import { HttpError, isUniqueConstraintError, methodNotAllowed, notFound, payloadTooLarge, unauthorized } from "./errors.js";
import { sha256Hex } from "./hash.js";
import { errorResponse, htmlResponse, jsonResponse, optionsResponse } from "./headers.js";
import { DEFAULT_MAX_BODY_BYTES, SERVICE_NAME, SERVICE_VERSION } from "./meta.js";
import { enforceIngestLimits } from "./ratelimit.js";
import { feedbackSubmissionRow, findSubmissionByHash, storeSubmission, telemetrySubmissionRow, type SubmissionRow } from "./store.js";
import { buildSummary } from "./summary.js";
import { parseJsonBody, validateFeedbackPayload, validateTelemetryBatch } from "./validate.js";

type RouteHandler = (request: Request, env: Env) => Promise<Response>;

interface Route {
  readonly path: string;
  readonly methods: Readonly<Record<string, RouteHandler>>;
}

const maxBodyBytes = (env: Env): number => {
  const parsed = Number.parseInt(env.MAX_BODY_BYTES ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_BODY_BYTES;
};

const readBody = async (request: Request, limit: number): Promise<ArrayBuffer> => {
  const declared = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declared) && declared > limit) throw payloadTooLarge(limit);
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > limit) throw payloadTooLarge(limit);
  return bytes;
};

const requireIngestToken = (request: Request, env: Env): void => {
  if (env.INGEST_TOKEN === undefined || env.INGEST_TOKEN.length === 0) return;
  if (!bearerMatches(request, env.INGEST_TOKEN)) throw unauthorized();
};

interface ParsedSubmission {
  readonly row: SubmissionRow;
  readonly events: Parameters<typeof storeSubmission>[2];
  readonly feedback: Parameters<typeof storeSubmission>[3];
}

type SubmissionBuilder = (body: unknown, meta: { id: string; receivedAt: number; payloadBytes: number; payloadHash: string }) => ParsedSubmission;

const buildFeedback: SubmissionBuilder = (body, meta) => {
  const payload = validateFeedbackPayload(body);
  return { row: feedbackSubmissionRow(payload, meta), events: payload.events, feedback: payload.feedback };
};

const buildTelemetry: SubmissionBuilder = (body, meta) => {
  const batch = validateTelemetryBatch(body);
  return { row: telemetrySubmissionRow(batch, meta), events: batch.events, feedback: [] };
};

const ingest = (build: SubmissionBuilder): RouteHandler => async (request, env) => {
  requireIngestToken(request, env);
  const bytes = await readBody(request, maxBodyBytes(env));
  const body = parseJsonBody(new TextDecoder().decode(bytes));
  const now = Date.now();
  const meta = { id: crypto.randomUUID(), receivedAt: now, payloadBytes: bytes.byteLength, payloadHash: await sha256Hex(bytes) };
  const parsed = build(body, meta);
  await enforceIngestLimits(env.DB, request, parsed.row.installationId, now);
  const existing = await findSubmissionByHash(env.DB, meta.payloadHash);
  if (existing !== null) return jsonResponse({ ok: true, duplicate: true, id: existing.id });
  try {
    await storeSubmission(env.DB, parsed.row, parsed.events, parsed.feedback);
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const raced = await findSubmissionByHash(env.DB, meta.payloadHash);
    return jsonResponse({ ok: true, duplicate: true, id: raced?.id ?? null });
  }
  return jsonResponse({ ok: true, duplicate: false, id: meta.id });
};

const health: RouteHandler = async () =>
  jsonResponse({ ok: true, service: SERVICE_NAME, version: SERVICE_VERSION, time: new Date().toISOString() });

const adminSummary: RouteHandler = async (request, env) => {
  if (!bearerMatches(request, env.ADMIN_TOKEN)) throw unauthorized();
  return jsonResponse(await buildSummary(env.DB, Date.now()));
};

const adminPage: RouteHandler = async () => htmlResponse(renderAdminPage());

const ROUTES: readonly Route[] = [
  { path: "/health", methods: { GET: health } },
  { path: "/v1/feedback", methods: { POST: ingest(buildFeedback) } },
  { path: "/v1/telemetry-batch", methods: { POST: ingest(buildTelemetry) } },
  { path: "/v1/admin/summary", methods: { GET: adminSummary } },
  { path: "/admin", methods: { GET: adminPage } }
];

const dispatch = async (request: Request, env: Env): Promise<Response> => {
  const { pathname } = new URL(request.url);
  const route = ROUTES.find((r) => r.path === pathname);
  if (route === undefined) throw notFound();
  const allow = Object.keys(route.methods).join(", ");
  if (request.method === "OPTIONS") return optionsResponse(`${allow}, OPTIONS`);
  const handler = route.methods[request.method === "HEAD" ? "GET" : request.method];
  if (handler === undefined) throw methodNotAllowed(allow);
  return handler(request, env);
};

export const handleRequest = async (request: Request, env: Env): Promise<Response> => {
  try {
    return await dispatch(request, env);
  } catch (error) {
    if (error instanceof HttpError) return errorResponse(error);
    console.error("unhandled error", error instanceof Error ? error.message : "unknown");
    return errorResponse(new HttpError(500, "internal_error", "Internal error"));
  }
};
