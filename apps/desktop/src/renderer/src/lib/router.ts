export const PAGE_NAMES = [
  "overview",
  "activity",
  "candidates",
  "skills",
  "runs",
  "feedback",
  "privacy",
  "settings",
  "teach",
  "onboarding"
] as const;
export type PageName = (typeof PAGE_NAMES)[number];

export interface Route {
  page: PageName;
  id?: string;
}

const pageSet = new Set<string>(PAGE_NAMES);

/** "#/skills/abc" -> { page: "skills", id: "abc" }. Unknown hashes go to overview. */
export function parseRoute(hash: string): Route {
  const cleaned = hash.replace(/^#\/?/, "").replace(/\/+$/, "");
  const [rawPage = "", rawId] = cleaned.split("/");
  const page = rawPage.toLowerCase();
  if (!pageSet.has(page)) return { page: "overview" };
  const id = rawId ? decodeURIComponent(rawId) : undefined;
  return id ? { page: page as PageName, id } : { page: page as PageName };
}

export function buildHash(page: PageName, id?: string): string {
  return id ? `#/${page}/${encodeURIComponent(id)}` : `#/${page}`;
}

/** Accepts either a full hash or a bare route string like "runs/123" from event:navigate. */
export function normalizeRouteInput(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith("#")) return trimmed;
  return `#/${trimmed.replace(/^\/+/, "")}`;
}

export function navigate(page: PageName, id?: string): void {
  window.location.hash = buildHash(page, id);
}
