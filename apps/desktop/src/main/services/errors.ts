/** Typed error raised by services; the IPC layer maps `code` to the envelope. */
export class ServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "ServiceError";
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
