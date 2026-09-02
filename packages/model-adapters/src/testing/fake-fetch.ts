/**
 * Test-only fetch double that records every request body and lets a test
 * script the responses (including transport errors and abort-aware hangs).
 */
import type { FetchImpl } from "../providers/types.js";

export interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly signal: AbortSignal | null;
}

export type FakeResponder = (request: RecordedRequest, callIndex: number) => Response | Promise<Response>;

export interface FakeFetch {
  readonly fetchImpl: FetchImpl;
  readonly requests: readonly RecordedRequest[];
}

function normalizeHeaders(init: RequestInit | undefined): Record<string, string> {
  const raw = init?.headers;
  if (!raw) {
    return {};
  }
  if (raw instanceof Headers) {
    return Object.fromEntries([...raw.entries()]);
  }
  if (Array.isArray(raw)) {
    return Object.fromEntries(raw.map(([k, v]) => [k.toLowerCase(), v]));
  }
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.toLowerCase(), String(v)]));
}

export function createFakeFetch(responder: FakeResponder): FakeFetch {
  const requests: RecordedRequest[] = [];
  const fetchImpl: FetchImpl = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const bodyText = typeof init?.body === "string" ? init.body : undefined;
    const request: RecordedRequest = {
      url,
      method: init?.method ?? "GET",
      headers: normalizeHeaders(init),
      body: bodyText === undefined ? undefined : (JSON.parse(bodyText) as unknown),
      signal: init?.signal ?? null
    };
    requests.push(request);
    return Promise.resolve(responder(request, requests.length - 1));
  };
  return { fetchImpl, requests };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export function chatReply(content: string): Response {
  return jsonResponse({ choices: [{ message: { role: "assistant", content } }] });
}

export function modelsReply(ids: readonly string[]): Response {
  return jsonResponse({ object: "list", data: ids.map((id) => ({ id, object: "model" })) });
}

/** A response that never resolves until the request's abort signal fires. */
export function hangUntilAbort(request: RecordedRequest): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const signal = request.signal;
    if (!signal) {
      reject(new Error("no abort signal supplied"));
      return;
    }
    if (signal.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  });
}

/** Route by path: GET models vs POST chat/completions. */
export function routeByPath(handlers: {
  readonly models?: (request: RecordedRequest, callIndex: number) => Response | Promise<Response>;
  readonly chat?: (request: RecordedRequest, callIndex: number) => Response | Promise<Response>;
}): FakeResponder {
  return (request, callIndex) => {
    if (request.url.endsWith("/models") && handlers.models) {
      return handlers.models(request, callIndex);
    }
    if (request.url.endsWith("/chat/completions") && handlers.chat) {
      return handlers.chat(request, callIndex);
    }
    return jsonResponse({ error: "unexpected request" }, 404);
  };
}

/** Count image blocks in a recorded chat request body. */
export function countImagesInBody(body: unknown): number {
  const messages = (body as { messages?: readonly { content?: unknown }[] }).messages ?? [];
  return messages.reduce((total, message) => {
    const content = message.content;
    if (!Array.isArray(content)) {
      return total;
    }
    return total + content.filter((block) => (block as { type?: string }).type === "image_url").length;
  }, 0);
}
