/** Issue reported to clients: a JSON path and a short code. Never carries values. */
export interface ValidationIssue {
  readonly path: string;
  readonly code: string;
}

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues: readonly ValidationIssue[];
  readonly extraHeaders: Readonly<Record<string, string>>;

  constructor(
    status: number,
    code: string,
    message: string,
    options: { issues?: readonly ValidationIssue[]; headers?: Record<string, string> } = {}
  ) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.issues = options.issues ?? [];
    this.extraHeaders = options.headers ?? {};
  }
}

export const badRequest = (message: string): HttpError => new HttpError(400, "bad_request", message);
export const unauthorized = (): HttpError =>
  new HttpError(401, "unauthorized", "Missing or invalid bearer token", {
    headers: { "www-authenticate": "Bearer" }
  });
export const notFound = (): HttpError => new HttpError(404, "not_found", "No such route");
export const methodNotAllowed = (allow: string): HttpError =>
  new HttpError(405, "method_not_allowed", "Method not allowed", { headers: { allow } });
export const payloadTooLarge = (limit: number): HttpError =>
  new HttpError(413, "payload_too_large", `Body exceeds ${limit} bytes`);
export const unprocessable = (issues: readonly ValidationIssue[]): HttpError =>
  new HttpError(422, "invalid_payload", "Payload rejected by schema policy", { issues });
export const tooManyRequests = (retryAfterSeconds: number): HttpError =>
  new HttpError(429, "rate_limited", "Rate limit exceeded", {
    headers: { "retry-after": String(retryAfterSeconds) }
  });

export const isUniqueConstraintError = (error: unknown): boolean =>
  error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
