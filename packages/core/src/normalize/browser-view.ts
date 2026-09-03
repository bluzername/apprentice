import type { ActivityEvent } from "@apprentice/schemas";
import { slugify } from "./app-name.js";
import { stripPersonNames } from "./names.js";

/**
 * Coarse, privacy-preserving view classes derived from browser window titles.
 * Raw title words never reach the token space: titles are encrypted at rest.
 */
export const BROWSER_VIEW_CLASSES = [
  "inbox",
  "search",
  "compose",
  "starred",
  "sent",
  "drafts",
  "document",
  "settings",
  "login",
  "checkout",
  "page"
] as const;
export type BrowserViewClass = (typeof BROWSER_VIEW_CLASSES)[number];

export interface BrowserView {
  readonly site: string;
  readonly view: BrowserViewClass;
  /** Login and checkout views: nothing should be captured or learned from them. */
  readonly sensitive: boolean;
}

export const BROWSER_BUNDLE_IDS: ReadonlySet<string> = new Set([
  "com.google.chrome",
  "com.google.chrome.canary",
  "org.chromium.chromium",
  "company.thebrowser.browser",
  "com.brave.browser",
  "com.microsoft.edgemac",
  "com.apple.safari",
  "org.mozilla.firefox",
  "com.vivaldi.vivaldi"
]);

export const UNKNOWN_SITE = "web";
const MAX_SITE_LENGTH = 32;
const MAX_SITE_WORDS = 3;
const SENSITIVE_VIEWS: ReadonlySet<BrowserViewClass> = new Set(["login", "checkout"]);
const DOCUMENT_SITES: ReadonlySet<string> = new Set(["google-sheets", "google-docs", "google-slides", "google-forms", "notion"]);
/** Chrome appends performance annotations such as "High memory usage - 880 MB" to titles. */
const CHROME_ANNOTATION_RE = /^(high memory usage|\d+(\.\d+)? ?[kmg]b)$/i;
const BROWSER_NAMES: ReadonlySet<string> = new Set(["google chrome", "chrome", "chromium", "brave", "microsoft edge", "safari", "arc", "firefox", "vivaldi"]);

/** " - ", " | ", " middle dot ", en dash and em dash surrounded by spaces. */
const SEGMENT_SEPARATOR_RE = /\s+(?:-|\||\u00b7|\u2013|\u2014)\s+/;
const COUNT_RE = /\(\s*\d[\d,.]*\s*\)/g;
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const SITE_WORD_RE = /^[a-z][a-z.']*$/i;

/** Checked against every segment: a login or checkout anywhere in the title makes the view sensitive. */
const SENSITIVE_RULES: ReadonlyArray<readonly [BrowserViewClass, RegExp]> = [
  ["login", /(^|[^a-z])(sign[ -]?in|log[ -]?in|log[ -]?on|authenticate|two[ -]factor|2fa|verification code|password|passcode)($|[^a-z])/i],
  ["checkout", /(^|[^a-z])(check[ -]?out|payment|pay now|place order|billing)($|[^a-z])/i]
];

/** Checked against the first segment only. Folder-like views must start the segment. */
const VIEW_RULES: ReadonlyArray<readonly [BrowserViewClass, RegExp]> = [
  ["settings", /(^|[^a-z])(settings|preferences)($|[^a-z])/i],
  ["search", /(^|[^a-z])(search results?|results for|search)($|[^a-z])/i],
  ["compose", /^(compose|new message|new mail|new email)($|[^a-z])/i],
  ["inbox", /^inbox($|[^a-z])/i],
  ["starred", /^starred($|[^a-z])/i],
  ["sent", /^sent( mail| items)?($|[^a-z])/i],
  ["drafts", /^drafts?($|[^a-z])/i]
];

export function isBrowserBundleId(bundleId: string | undefined): boolean {
  return bundleId !== undefined && BROWSER_BUNDLE_IDS.has(bundleId.trim().toLowerCase());
}

export function isBrowserViewClass(value: unknown): value is BrowserViewClass {
  return typeof value === "string" && (BROWSER_VIEW_CLASSES as readonly string[]).includes(value);
}

function cleanSegment(segment: string): string {
  return segment.replace(COUNT_RE, " ").replace(/\s+/g, " ").trim();
}

function splitSegments(title: string): readonly string[] {
  const segments = title
    .split(SEGMENT_SEPARATOR_RE)
    .map((segment) => cleanSegment(segment))
    .filter((segment) => segment.length > 0 && !EMAIL_RE.test(segment) && !CHROME_ANNOTATION_RE.test(segment));
  // Browsers append their own name and, in Chrome, the profile name after it
  // ("Inbox - Gmail - Google Chrome - Alex"). Keep only the page-side segments.
  const browserIndex = segments.findIndex((segment, index) => index > 0 && BROWSER_NAMES.has(segment.toLowerCase()));
  if (browserIndex > 0) return segments.slice(0, browserIndex);
  return segments;
}

/** A segment names a site only when it is short, alphabetic, and not a person name. */
function siteFromSegment(segment: string): string | undefined {
  const words = segment.split(" ");
  if (words.length === 0 || words.length > MAX_SITE_WORDS) return undefined;
  if (!words.every((word) => SITE_WORD_RE.test(word))) return undefined;
  if (stripPersonNames(segment).count > 0) return undefined;
  const slug = slugify(segment);
  if (slug.length === 0 || slug.length > MAX_SITE_LENGTH) return undefined;
  return slug;
}

function matchRule(rules: ReadonlyArray<readonly [BrowserViewClass, RegExp]>, text: string): BrowserViewClass | undefined {
  return rules.find(([, pattern]) => pattern.test(text))?.[0];
}

function classifyView(segments: readonly string[], site: string): BrowserViewClass {
  const sensitive = segments.map((segment) => matchRule(SENSITIVE_RULES, segment)).find((view) => view !== undefined);
  if (sensitive !== undefined) return sensitive;
  const first = segments[0] ?? "";
  const byRule = matchRule(VIEW_RULES, first);
  if (byRule !== undefined) return byRule;
  return DOCUMENT_SITES.has(site) ? "document" : "page";
}

/**
 * Derives a coarse `{ site, view }` from a browser window title. Returns null for
 * non-browser bundle ids and empty titles. Never returns raw title words.
 */
export function browserViewFromTitle(title: string, bundleId: string | undefined): BrowserView | null {
  if (!isBrowserBundleId(bundleId)) return null;
  const segments = splitSegments(title);
  if (segments.length === 0) return null;
  const last = segments[segments.length - 1]!;
  const site = siteFromSegment(last) ?? UNKNOWN_SITE;
  const view = classifyView(segments, site);
  // A lone segment that describes a view ("Inbox (3)") is not a site name.
  const resolvedSite = segments.length === 1 && view !== "page" && view !== "document" ? UNKNOWN_SITE : site;
  return { site: resolvedSite, view, sensitive: SENSITIVE_VIEWS.has(view) };
}

/**
 * View for a stored `window_title_changed` event. Prefers the coarse `site`/`view`
 * payload written at ingestion (the title itself is encrypted at rest), and falls
 * back to deriving from a plain `title` when one is present.
 */
export function browserViewFromEvent(event: ActivityEvent): BrowserView | null {
  const bundleId = event.app?.bundleId;
  if (!isBrowserBundleId(bundleId)) return null;
  const site = event.payload?.["site"];
  const view = event.payload?.["view"];
  if (typeof site === "string" && site.length > 0 && isBrowserViewClass(view)) {
    return { site, view, sensitive: SENSITIVE_VIEWS.has(view) };
  }
  const title = event.payload?.["title"];
  return typeof title === "string" ? browserViewFromTitle(title, bundleId) : null;
}
