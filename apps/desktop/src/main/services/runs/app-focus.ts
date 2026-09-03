import { normalizeAppName } from "@apprentice/core";
import { APP_BUNDLE_ID, type Skill } from "@apprentice/schemas";

/**
 * Pure helpers that decide which app a run should act on. `allowedApps` may
 * hold full bundle ids or the normalized slugs core produces ("finder",
 * "preview"); subtasks name an app or a web domain in `appOrDomain`.
 */

/** Slug (as produced by core's normalizeAppName) to bundle id for common apps. */
export const KNOWN_APP_BUNDLE_IDS: Readonly<Record<string, string>> = {
  finder: "com.apple.finder",
  preview: "com.apple.Preview",
  textedit: "com.apple.TextEdit",
  chrome: "com.google.Chrome",
  safari: "com.apple.Safari",
  notes: "com.apple.Notes",
  mail: "com.apple.mail"
};

const APP_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  "com.apple.finder": "Finder",
  "com.apple.preview": "Preview",
  "com.apple.textedit": "TextEdit",
  "com.google.chrome": "Google Chrome",
  "com.apple.safari": "Safari",
  "com.apple.notes": "Notes",
  "com.apple.mail": "Mail"
};

const BROWSER_RE = /chrome|browser|brave|edge|safari|firefox|chromium/i;

export function isApprenticeApp(bundleId: string | undefined): boolean {
  return bundleId !== undefined && bundleId.toLowerCase() === APP_BUNDLE_ID.toLowerCase();
}

/** Apprentice itself is never an allowed target; an unknown frontmost app is tolerated as before. */
export function appAllowed(skill: Skill, bundleId: string | undefined): boolean {
  if (bundleId === undefined) return true;
  if (isApprenticeApp(bundleId)) return false;
  if (skill.allowedApps.length === 0) return true;
  const lowered = bundleId.toLowerCase();
  const slug = normalizeAppName(bundleId);
  return skill.allowedApps.some((entry) => entry.toLowerCase() === lowered || entry.toLowerCase() === slug);
}

/** Bundle id for an `allowedApps` entry: a known slug, a bundle id as given, or nothing for an unknown slug. */
export function bundleIdForEntry(entry: string): string | undefined {
  const trimmed = entry.trim();
  if (trimmed.length === 0) return undefined;
  const known = KNOWN_APP_BUNDLE_IDS[trimmed.toLowerCase()];
  if (known !== undefined) return known;
  return trimmed.includes(".") ? trimmed : undefined;
}

function sameApp(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase() || normalizeAppName(left) === normalizeAppName(right);
}

function browserEntry(skill: Skill): string | undefined {
  return skill.allowedApps.find((entry) => BROWSER_RE.test(entry) || BROWSER_RE.test(bundleIdForEntry(entry) ?? ""));
}

/**
 * The allowed app a subtask's `appOrDomain` points at: the matching allowed
 * app when it names one, the allowed browser when it names a web domain, or
 * nothing when the value cannot be mapped (the current target then stands).
 */
export function resolveAppTarget(skill: Skill, appOrDomain: string | undefined): string | undefined {
  const wanted = appOrDomain?.trim() ?? "";
  if (wanted.length === 0) return undefined;
  const match = skill.allowedApps.find((entry) => sameApp(entry, wanted));
  if (match !== undefined) return bundleIdForEntry(match) ?? bundleIdForEntry(wanted);
  if (wanted.includes(".")) {
    const browser = browserEntry(skill);
    return browser !== undefined ? bundleIdForEntry(browser) : undefined;
  }
  return undefined;
}

/** Target at run start: the frontmost allowed app, else the first mappable allowed app, else the first subtask's app. */
export function initialAppTarget(skill: Skill, frontmostBundleId: string | undefined): string | undefined {
  if (frontmostBundleId !== undefined && !isApprenticeApp(frontmostBundleId) && appAllowed(skill, frontmostBundleId)) return frontmostBundleId;
  for (const entry of skill.allowedApps) {
    const bundleId = bundleIdForEntry(entry);
    if (bundleId !== undefined) return bundleId;
  }
  return resolveAppTarget(skill, skill.subtasks[0]?.appOrDomain);
}

export function appDisplayName(bundleId: string): string {
  const known = APP_DISPLAY_NAMES[bundleId.toLowerCase()];
  if (known !== undefined) return known;
  const last = bundleId.split(".").filter((segment) => segment.length > 0).pop();
  return last !== undefined && last.length > 0 ? last : bundleId;
}
