const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Hex ids of at least 8 chars; at least one digit avoids eating words like "deadbeef". */
const HEX_ID_RE = /^(?=.*\d)[0-9a-f]{8,}$/i;
const LONG_NUMBER_RE = /^\d{4,}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:t\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:z|[+-]\d{2}:?\d{2})?)?$/i;
const EMAIL_RE = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/;
const ID_PLACEHOLDER = ":id";

export function isVolatileRouteSegment(segment: string): boolean {
  return (
    UUID_RE.test(segment) ||
    HEX_ID_RE.test(segment) ||
    LONG_NUMBER_RE.test(segment) ||
    ISO_DATE_RE.test(segment) ||
    EMAIL_RE.test(segment)
  );
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** Lowercases, strips query/fragment, replaces volatile segments with ":id". */
export function normalizeRoute(path: string): string {
  const withoutQuery = path.split(/[?#]/, 1)[0] ?? "";
  const decoded = safeDecode(withoutQuery);
  const segments = decoded
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .map((segment) => (isVolatileRouteSegment(segment) ? ID_PLACEHOLDER : segment.toLowerCase()));
  return `/${segments.join("/")}`;
}
