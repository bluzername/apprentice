/**
 * Runtime-agnostic loopback API client. It only knows how to talk to
 * `http://127.0.0.1:<port>` and never to any other host.
 */
import { z } from "zod";
import {
  AllowlistResponseSchema,
  DomStateQuerySchema,
  EXTENSION_PROTOCOL_VERSION,
  ExtensionEventBatchResponseSchema,
  ExtensionEventBatchSchema,
  LOOPBACK_HOST,
  PairRequestSchema,
  PairResponseSchema,
  type AllowlistResponse,
  type ExtensionEvent,
  type PairRequest,
  type PairResponse
} from "@apprentice/schemas";
import { LoopbackError } from "./errors.js";

export type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>;

export interface ClientConfig {
  readonly port: number;
  readonly origin: string;
  readonly fetchImpl: FetchImpl;
  readonly token?: string;
}

/** The allowlist payload plus the optional `runActive` hint the app may include during a run. */
export const AllowlistWithRunSchema = AllowlistResponseSchema.extend({ runActive: z.boolean().optional() });
export type AllowlistWithRun = z.infer<typeof AllowlistWithRunSchema>;

export const DomQueryResponseSchema = z.object({ query: DomStateQuerySchema.nullable() });
export type DomQueryResponse = z.infer<typeof DomQueryResponseSchema>;

export const DomStatePostSchema = z.object({
  marker: z.string().max(160),
  present: z.boolean(),
  domain: z.string().max(253).optional(),
  path: z.string().max(512).optional()
});
export type DomStatePost = z.infer<typeof DomStatePostSchema>;

export const EventBatchResponseSchema = ExtensionEventBatchResponseSchema;
export type EventBatchResponse = z.infer<typeof EventBatchResponseSchema>;

export function baseUrlForPort(port: number): string {
  return `http://${LOOPBACK_HOST}:${port}`;
}

function parseRetryAfter(response: Response): number | undefined {
  const header = response.headers.get("retry-after");
  if (header === null) {
    return undefined;
  }
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : undefined;
}

async function request<T>(
  config: ClientConfig,
  method: "GET" | "POST",
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
  authenticated = true
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json", Origin: config.origin };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (authenticated) {
    if (!config.token) {
      throw new LoopbackError("unauthorized", "Not paired: no token available");
    }
    headers.Authorization = `Bearer ${config.token}`;
  }
  let response: Response;
  try {
    response = await config.fetchImpl(`${baseUrlForPort(config.port)}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch (error) {
    throw new LoopbackError("network", `Request to ${path} failed: ${String(error)}`);
  }
  if (response.status === 401) {
    throw new LoopbackError("unauthorized", "Pairing token rejected", { status: 401 });
  }
  if (response.status === 403) {
    throw new LoopbackError("forbidden", "Extension origin rejected", { status: 403 });
  }
  if (response.status === 429) {
    throw new LoopbackError("rate_limited", "Rate limited by the desktop app", {
      status: 429,
      retryAfterMs: parseRetryAfter(response)
    });
  }
  if (!response.ok) {
    throw new LoopbackError("http", `Unexpected status ${response.status} from ${path}`, { status: response.status });
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new LoopbackError("protocol", `Non-JSON response from ${path}`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new LoopbackError("protocol", `Malformed response from ${path}: ${parsed.error.message}`);
  }
  return parsed.data;
}

export async function pair(config: ClientConfig, requestBody: PairRequest): Promise<PairResponse> {
  const validated = PairRequestSchema.parse(requestBody);
  return request(config, "POST", "/v1/pair", PairResponseSchema, validated, false);
}

export async function sendEvents(config: ClientConfig, events: readonly ExtensionEvent[]): Promise<EventBatchResponse> {
  const batch = ExtensionEventBatchSchema.parse({ protocolVersion: EXTENSION_PROTOCOL_VERSION, events });
  return request(config, "POST", "/v1/events", EventBatchResponseSchema, batch);
}

export async function getAllowlist(config: ClientConfig): Promise<AllowlistWithRun> {
  return request(config, "GET", "/v1/allowlist", AllowlistWithRunSchema);
}

export async function getDomQuery(config: ClientConfig): Promise<DomQueryResponse> {
  return request(config, "GET", "/v1/dom-query", DomQueryResponseSchema);
}

export async function postDomState(config: ClientConfig, state: DomStatePost): Promise<{ ok: true }> {
  const validated = DomStatePostSchema.parse(state);
  return request(config, "POST", "/v1/dom-state", z.object({ ok: z.literal(true) }), validated);
}

export type { AllowlistResponse };
