/** Small public-suffix list: second-level suffixes where the registrable domain has three labels. */
export const PUBLIC_SUFFIXES: ReadonlySet<string> = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "ltd.uk", "plc.uk",
  "com.au", "net.au", "org.au", "edu.au", "gov.au",
  "co.nz", "org.nz", "net.nz",
  "co.jp", "ne.jp", "or.jp", "ac.jp",
  "com.br", "net.br", "org.br",
  "co.in", "net.in", "org.in",
  "com.mx", "com.ar", "com.co", "com.sg", "com.hk", "com.tw", "com.cn",
  "co.za", "co.kr", "co.il", "com.tr",
  "github.io", "gitlab.io", "herokuapp.com", "vercel.app", "netlify.app", "pages.dev", "web.app"
]);

/** Returns the registrable domain (eTLD+1) using the small suffix list above. */
export function registrableDomain(host: string): string {
  const cleaned = host.trim().toLowerCase().replace(/\.$/, "");
  const labels = cleaned.split(".").filter((label) => label.length > 0);
  if (labels.length <= 2) return labels.join(".");
  const lastTwo = labels.slice(-2).join(".");
  if (PUBLIC_SUFFIXES.has(lastTwo)) return labels.slice(-3).join(".");
  return lastTwo;
}

export interface StrippedUrl {
  readonly domain: string;
  readonly path: string;
}

/** Lowercased host and path without query, fragment, or credentials. Punycode hosts are kept. */
export function stripUrl(url: string): StrippedUrl {
  const trimmed = url.trim();
  if (trimmed.length === 0) throw new Error("stripUrl: empty url");
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error("stripUrl: invalid url");
  }
  const domain = parsed.hostname.toLowerCase();
  if (domain.length === 0) throw new Error("stripUrl: url has no host");
  const path = parsed.pathname.length > 0 ? parsed.pathname.toLowerCase() : "/";
  return { domain, path };
}
