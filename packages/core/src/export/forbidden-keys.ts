import { FORBIDDEN_REMOTE_KEYS } from "@apprentice/schemas";

export interface ForbiddenKeyOptions {
  /** Paths to skip, with `[*]` matching any array index (e.g. "events[*].name"). */
  readonly ignorePaths?: readonly string[];
}

function normalizePath(path: string): string {
  return path.replace(/\[\d+\]/g, "[*]");
}

function walk(value: unknown, path: string, forbidden: ReadonlySet<string>, ignore: ReadonlySet<string>, out: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, forbidden, ignore, out));
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = path.length === 0 ? key : `${path}.${key}`;
    if (forbidden.has(key.toLowerCase()) && !ignore.has(normalizePath(childPath))) out.push(childPath);
    walk(child, childPath, forbidden, ignore, out);
  }
}

/** Deep, case-insensitive scan for forbidden keys. Returns dotted paths of every hit. */
export function findForbiddenKeys(
  obj: unknown,
  keys: readonly string[] = FORBIDDEN_REMOTE_KEYS,
  options: ForbiddenKeyOptions = {}
): string[] {
  const forbidden = new Set(keys.map((key) => key.toLowerCase()));
  const ignore = new Set((options.ignorePaths ?? []).map(normalizePath));
  const out: string[] = [];
  walk(obj, "", forbidden, ignore, out);
  return out;
}
