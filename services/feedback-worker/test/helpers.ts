import { env } from "cloudflare:test";
import worker from "../src/index.js";
import type { Env } from "../src/index.js";

export const ADMIN_TOKEN = "test-admin-token";
export const BASE_URL = "https://feedback.test";

export const installationId = (seed: string): string =>
  Array.from(seed)
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
    .join("")
    .padEnd(16, "0")
    .slice(0, 64);

export interface JsonRecord {
  [key: string]: unknown;
}

export const feedbackPayload = (overrides: JsonRecord = {}): JsonRecord => ({
  schemaVersion: "1.0",
  installationId: installationId("default"),
  participantCode: "alpha-01",
  appVersion: "0.1.0-alpha.1",
  macosMajor: 15,
  chipFamily: "m3",
  memoryBucket: "32",
  provider: "mock",
  model: "uimate-7b",
  modelVersion: "2026.08",
  events: [
    { name: "app_launched", ts: 1_756_000_000_000, counts: {} },
    { name: "candidate_generated", ts: 1_756_000_100_000, counts: { steps: 4 }, riskClass: "read_only", provider: "mock" }
  ],
  feedback: [
    {
      contextType: "candidate",
      answers: { kind: "candidate", relevant: true, wouldDelegate: "yes", boundaryAccuracy: "correct", reasonCodes: [] },
      comment: "Looks right",
      createdAt: 1_756_000_200_000
    }
  ],
  performance: { captureLatencyMs: 12 },
  ...overrides
});

export const telemetryPayload = (overrides: JsonRecord = {}): JsonRecord => ({
  schemaVersion: "1.0",
  installationId: installationId("telemetry"),
  appVersion: "0.1.0-alpha.1",
  events: [{ name: "run_completed", ts: 1_756_000_300_000, counts: { steps: 3 }, riskClass: "internal_mutation" }],
  ...overrides
});

export interface RequestOptions {
  readonly method?: string;
  readonly body?: unknown;
  readonly rawBody?: string;
  readonly headers?: Record<string, string>;
  readonly env?: Partial<Env>;
}

export const call = async (path: string, options: RequestOptions = {}): Promise<Response> => {
  const body = options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  const headers = new Headers({ "cf-connecting-ip": "203.0.113.10", ...(options.headers ?? {}) });
  if (body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
  const request = new Request(`${BASE_URL}${path}`, { method: options.method ?? (body === undefined ? "GET" : "POST"), body, headers });
  return worker.fetch(request, { ...env, ...(options.env ?? {}) });
};

export const post = (path: string, body: unknown, options: Omit<RequestOptions, "body"> = {}): Promise<Response> =>
  call(path, { ...options, body });

export const resetDb = async (): Promise<void> => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM events"),
    env.DB.prepare("DELETE FROM feedback_items"),
    env.DB.prepare("DELETE FROM submissions"),
    env.DB.prepare("DELETE FROM rate_limits")
  ]);
};

export const countRows = async (table: string, where = "1=1", ...binds: unknown[]): Promise<number> => {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).bind(...binds).first<{ n: number }>();
  return Number(row?.n ?? 0);
};

export const json = async <T = JsonRecord>(response: Response): Promise<T> => (await response.json()) as T;
