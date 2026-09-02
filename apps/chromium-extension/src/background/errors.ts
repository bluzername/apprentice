export type LoopbackErrorKind = "unauthorized" | "forbidden" | "rate_limited" | "http" | "network" | "protocol";

/** Typed failure raised by the loopback client so callers can branch on the cause. */
export class LoopbackError extends Error {
  readonly kind: LoopbackErrorKind;
  readonly status: number | undefined;
  readonly retryAfterMs: number | undefined;

  constructor(kind: LoopbackErrorKind, message: string, options: { status?: number; retryAfterMs?: number } = {}) {
    super(message);
    this.name = "LoopbackError";
    this.kind = kind;
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
  }
}

export function isLoopbackError(value: unknown): value is LoopbackError {
  return value instanceof LoopbackError;
}
