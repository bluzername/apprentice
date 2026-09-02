/**
 * URL helpers used by every extension context. Kept dependency-free so they
 * can run inside content scripts, the service worker, and Node tests.
 */
import { MAX_PATH_LENGTH } from "./constants.js";

/** Small public-suffix list: second-level suffixes where the registrable domain has three labels. */
const MULTI_LABEL_SUFFIXES: ReadonlySet<string> = new Set([
  "co.uk",
  "org.uk",
  "com.au",
  "co.jp",
  "com.br",
  "co.nz"
]);

export interface StrippedUrl {
  readonly domain: string;
  readonly host: string;
  readonly path: string;
  readonly href: string;
}

/**
 * Returns the registrable domain (eTLD+1) for a host name, lower-cased and
 * without a trailing dot. IP literals and single-label hosts are returned as-is.
 */
export function registrableDomain(hostname: string): string {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (host.length === 0) {
    return "";
  }
  if (/^[0-9.]+$/.test(host) || host.startsWith("[")) {
    return host;
  }
  const labels = host.split(".");
  if (labels.length <= 2) {
    return host;
  }
  const lastTwo = labels.slice(-2).join(".");
  const take = MULTI_LABEL_SUFFIXES.has(lastTwo) ? 3 : 2;
  return labels.slice(-take).join(".");
}

/**
 * Strips credentials, query string, and fragment from a URL. Returns null for
 * anything that is not an http(s) URL so callers never capture internal pages.
 */
export function stripUrl(input: string): StrippedUrl | null {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.slice(0, MAX_PATH_LENGTH);
  return {
    domain: registrableDomain(host),
    host,
    path,
    href: `${parsed.protocol}//${host}${parsed.port ? `:${parsed.port}` : ""}${path}`
  };
}

/** True when `domain` is one of, or a subdomain of, the allowlisted registrable domains. */
export function isDomainAllowlisted(domain: string, allowlist: readonly string[]): boolean {
  const normalized = registrableDomain(domain);
  if (normalized.length === 0) {
    return false;
  }
  return allowlist.some((entry) => registrableDomain(entry) === normalized);
}

/** Host permission patterns for a registrable domain. Explicit schemes keep Chrome's containment check happy. */
export function originPatternsForDomain(domain: string): readonly string[] {
  const normalized = registrableDomain(domain);
  if (normalized.length === 0 || !/^[a-z0-9.-]+$/.test(normalized)) {
    return [];
  }
  return [`https://*.${normalized}/*`, `http://*.${normalized}/*`];
}
