/**
 * Minimal OpenAI-compatible transport: JSON over global fetch with an
 * AbortController timeout and the same retry policy as the reference
 * `UIMateAgent.call_llm` (connection errors, timeouts, 400/429/5xx are
 * retried; the back-off is min(5s * attempt, 30s) and injectable).
 */
import { z } from "zod";
import type { ModelHealth, ProviderType } from "@apprentice/schemas";
import { ProviderResponseError, ProviderUnavailableError, type FetchImpl, type SleepImpl } from "./types.js";

export interface HttpOptions {
  readonly provider: ProviderType;
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly fetchImpl: FetchImpl;
  readonly timeoutMs: number;
  readonly maxAttempts: number;
  readonly sleep: SleepImpl;
}

export class HttpStatusError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpStatusError";
    this.status = status;
  }
}

export function joinUrl(baseUrl: string, path: string): string {
  return baseUrl.replace(/\/+$/, "") + "/" + path.replace(/^\/+/, "");
}

function headers(apiKey: string | undefined, withBody: boolean): Record<string, string> {
  return {
    ...(withBody ? { "content-type": "application/json" } : {}),
    accept: "application/json",
    ...(apiKey && apiKey.length > 0 ? { authorization: `Bearer ${apiKey}` } : {})
  };
}

/** One JSON request with a hard timeout. Throws HttpStatusError or the transport error. */
export async function requestJson(options: HttpOptions, method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  timer.unref?.();
  try {
    const response = await options.fetchImpl(joinUrl(options.baseUrl, path), {
      method,
      headers: headers(options.apiKey, body !== undefined),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new HttpStatusError(response.status, `HTTP ${response.status} from ${path}: ${text.slice(0, 200)}`);
    }
    return (await response.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

/** Mirrors the reference retryable set: transport/timeouts, 400, 429 and 5xx. */
export function isRetryable(error: unknown): boolean {
  if (error instanceof HttpStatusError) {
    return error.status === 400 || error.status === 429 || error.status >= 500;
  }
  return true;
}

export function backoffMs(attempt: number): number {
  return Math.min(5000 * attempt, 30000);
}

/** Retry loop equivalent to `call_llm`; throws ProviderUnavailableError once exhausted. */
export async function requestWithRetry(options: HttpOptions, method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      return await requestJson(options, method, path, body);
    } catch (error: unknown) {
      lastError = error;
      if (!isRetryable(error)) {
        break;
      }
      if (attempt < options.maxAttempts) {
        await options.sleep(backoffMs(attempt));
      }
    }
  }
  const status = lastError instanceof HttpStatusError ? lastError.status : undefined;
  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new ProviderUnavailableError(options.provider, `${method} ${path} failed after ${options.maxAttempts} attempt(s): ${detail}`, {
    cause: lastError,
    status,
    attempts: options.maxAttempts
  });
}

const ContentPartSchema = z.union([z.string(), z.array(z.union([z.object({ text: z.string().optional() }).loose(), z.unknown()]))]);

const ChatCompletionSchema = z
  .object({
    choices: z
      .array(
        z
          .object({
            message: z.object({ content: ContentPartSchema.nullable().optional() }).loose()
          })
          .loose()
      )
      .min(1)
  })
  .loose();

/** Port of `UIMateAgent._extract_content_text`. */
export function extractContentText(content: unknown): string {
  if (content === null || content === undefined) {
    return "";
  }
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => (part !== null && typeof part === "object" && "text" in part ? String((part as { text?: unknown }).text ?? "") : ""))
      .join("");
  }
  return String(content);
}

/** POST /chat/completions and return the assistant text (never the raw envelope). */
export async function chatCompletion(options: HttpOptions, payload: Record<string, unknown>): Promise<string> {
  const raw = await requestWithRetry(options, "POST", "chat/completions", payload);
  const parsed = ChatCompletionSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ProviderResponseError(
      options.provider,
      "chat completion reply is not an OpenAI-compatible envelope",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    );
  }
  return extractContentText(parsed.data.choices[0]?.message.content);
}

const ModelsSchema = z.union([
  z.object({ data: z.array(z.object({ id: z.string() }).loose()) }).loose(),
  z.array(z.object({ id: z.string() }).loose())
]);

/** GET /models -> model ids. */
export async function listModels(options: HttpOptions): Promise<readonly string[]> {
  const raw = await requestWithRetry({ ...options, maxAttempts: 1 }, "GET", "models");
  const parsed = ModelsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ProviderResponseError(options.provider, "GET /models reply is not a model list");
  }
  const list = Array.isArray(parsed.data) ? parsed.data : parsed.data.data;
  return list.map((entry) => entry.id);
}

export interface HealthProbeOptions {
  readonly http: HttpOptions;
  readonly model: string;
  readonly capabilities: ModelHealth["capabilities"];
  readonly now?: () => number;
}

/** Health check via GET /models: ok when the alias or any model is served. */
export async function probeHealth(options: HealthProbeOptions): Promise<ModelHealth> {
  const now = options.now ?? Date.now;
  const started = now();
  const base = {
    provider: options.http.provider,
    model: options.model,
    endpoint: options.http.baseUrl,
    capabilities: options.capabilities
  };
  try {
    const ids = await listModels(options.http);
    const latencyMs = Math.max(0, now() - started);
    if (ids.length === 0) {
      return { ...base, ok: false, latencyMs, message: "endpoint reachable but serves no models", checkedAt: now() };
    }
    const hasAlias = ids.includes(options.model);
    return {
      ...base,
      ok: true,
      latencyMs,
      message: hasAlias ? `model ${options.model} available` : `model ${options.model} not listed; serving ${ids.slice(0, 3).join(", ")}`,
      checkedAt: now()
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { ...base, ok: false, latencyMs: Math.max(0, now() - started), message: message.slice(0, 500), checkedAt: now() };
  }
}
