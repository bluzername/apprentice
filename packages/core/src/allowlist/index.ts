import {
  DEFAULT_DENY_APP_BUNDLE_PATTERNS,
  DEFAULT_DENY_DOMAIN_PATTERNS,
  type AllowedApp,
  type LearningState,
  type PrivacyClassification
} from "@apprentice/schemas";

export type AllowlistAppEntry = AllowedApp | string;

function bundleOf(entry: AllowlistAppEntry): string {
  return (typeof entry === "string" ? entry : entry.bundleId).toLowerCase();
}

export function matchesDenyPattern(value: string, denyPatterns: readonly string[]): string | undefined {
  const lowered = value.toLowerCase();
  return denyPatterns.find((pattern) => pattern.length > 0 && lowered.includes(pattern.toLowerCase()));
}

export function isAppDenied(bundleId: string, denyPatterns: readonly string[] = DEFAULT_DENY_APP_BUNDLE_PATTERNS): boolean {
  return matchesDenyPattern(bundleId, denyPatterns) !== undefined;
}

export function isDomainDenied(domain: string, denyPatterns: readonly string[] = DEFAULT_DENY_DOMAIN_PATTERNS): boolean {
  return matchesDenyPattern(domain, denyPatterns) !== undefined;
}

/** Deny patterns always win. Otherwise the bundle id must be on the allowlist (case-insensitive). */
export function isAppAllowed(
  bundleId: string,
  allowlist: readonly AllowlistAppEntry[],
  denyPatterns: readonly string[] = DEFAULT_DENY_APP_BUNDLE_PATTERNS
): boolean {
  const lowered = bundleId.trim().toLowerCase();
  if (lowered.length === 0) return false;
  if (isAppDenied(lowered, denyPatterns)) return false;
  return allowlist.some((entry) => bundleOf(entry) === lowered);
}

/** Subdomains of an allowed domain are allowed. Deny patterns (substring) always win. */
export function isDomainAllowed(
  domain: string,
  allowedDomains: readonly string[],
  denyPatterns: readonly string[] = DEFAULT_DENY_DOMAIN_PATTERNS
): boolean {
  const lowered = domain.trim().toLowerCase();
  if (lowered.length === 0) return false;
  if (isDomainDenied(lowered, denyPatterns)) return false;
  return allowedDomains.some((allowed) => {
    const candidate = allowed.trim().toLowerCase();
    return candidate.length > 0 && (lowered === candidate || lowered.endsWith(`.${candidate}`));
  });
}

export interface ContextClassificationInput {
  readonly bundleId?: string;
  readonly domain?: string;
  readonly isPrivateWindow?: boolean;
  readonly isSecureInput?: boolean;
  readonly learningState: LearningState;
  readonly allowlist: { readonly apps: readonly AllowlistAppEntry[]; readonly domains: readonly string[] };
  readonly denyAppPatterns?: readonly string[];
  readonly denyDomainPatterns?: readonly string[];
}

/**
 * Decides whether a focus context may be captured. Paused, private, and stopped
 * learning states always exclude; denied and secure contexts are sensitive;
 * everything outside the allowlist is a privacy gap.
 */
export function classifyContext(input: ContextClassificationInput): PrivacyClassification {
  if (input.learningState !== "learning") return "excluded";
  if (input.isPrivateWindow === true || input.isSecureInput === true) return "sensitive";
  const denyApps = input.denyAppPatterns ?? DEFAULT_DENY_APP_BUNDLE_PATTERNS;
  const denyDomains = input.denyDomainPatterns ?? DEFAULT_DENY_DOMAIN_PATTERNS;
  if (input.bundleId !== undefined && isAppDenied(input.bundleId, denyApps)) return "sensitive";
  if (input.domain !== undefined && isDomainDenied(input.domain, denyDomains)) return "sensitive";
  if (input.domain !== undefined && input.domain.length > 0) {
    return isDomainAllowed(input.domain, input.allowlist.domains, denyDomains) ? "allowed" : "privacy_gap";
  }
  if (input.bundleId !== undefined && isAppAllowed(input.bundleId, input.allowlist.apps, denyApps)) {
    return "allowed";
  }
  return "privacy_gap";
}
