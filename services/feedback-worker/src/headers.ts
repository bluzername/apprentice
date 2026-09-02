import type { HttpError } from "./errors.js";

const BASE_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=()"
};

const JSON_CSP = "default-src 'none'; frame-ancestors 'none'";

/**
 * The dashboard needs inline script/style and a same-origin fetch to the summary endpoint.
 * connect-src 'self' is required because default-src 'none' would otherwise block that fetch.
 */
export const ADMIN_PAGE_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const withHeaders = (
  contentType: string,
  csp: string,
  extra: Readonly<Record<string, string>> = {}
): Headers => {
  const headers = new Headers({ ...BASE_SECURITY_HEADERS, "content-type": contentType, "content-security-policy": csp });
  for (const [key, value] of Object.entries(extra)) headers.set(key, value);
  return headers;
};

export const jsonResponse = (
  body: unknown,
  status = 200,
  extra: Readonly<Record<string, string>> = {}
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: withHeaders("application/json; charset=utf-8", JSON_CSP, extra)
  });

export const htmlResponse = (html: string, status = 200): Response =>
  new Response(html, { status, headers: withHeaders("text/html; charset=utf-8", ADMIN_PAGE_CSP) });

export const errorResponse = (error: HttpError): Response =>
  jsonResponse(
    {
      ok: false,
      error: error.code,
      message: error.message,
      ...(error.issues.length > 0 ? { issues: error.issues } : {})
    },
    error.status,
    error.extraHeaders
  );

/** OPTIONS answers with the allowed methods only. No CORS allow headers are ever emitted. */
export const optionsResponse = (allow: string): Response =>
  new Response(null, { status: 204, headers: withHeaders("application/json; charset=utf-8", JSON_CSP, { allow }) });
