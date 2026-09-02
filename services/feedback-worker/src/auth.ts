const encoder = new TextEncoder();

/** Constant-time string comparison. Length mismatch returns false without leaking content. */
export const constantTimeEqual = (a: string, b: string): boolean => {
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  if (bufA.byteLength !== bufB.byteLength) return false;
  if (bufA.byteLength === 0) return true;
  return crypto.subtle.timingSafeEqual(bufA, bufB);
};

export const extractBearer = (request: Request): string | null => {
  const header = request.headers.get("authorization");
  if (header === null) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
};

/** True when a bearer token is present and equals `expected`. An unset `expected` never matches. */
export const bearerMatches = (request: Request, expected: string | undefined): boolean => {
  if (expected === undefined || expected.length === 0) return false;
  const provided = extractBearer(request);
  return provided !== null && constantTimeEqual(provided, expected);
};
