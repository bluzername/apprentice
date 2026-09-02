import type { PairRequest } from "@apprentice/schemas";

export type BrowserKind = PairRequest["browser"];

export interface BrowserSignals {
  readonly brands: readonly string[];
  readonly hasBraveApi: boolean;
}

/** Maps user-agent client hints to the browser enum used by the pairing protocol. */
export function detectBrowser(signals: BrowserSignals): BrowserKind {
  if (signals.hasBraveApi) {
    return "brave";
  }
  const brands = signals.brands.map((brand) => brand.toLowerCase());
  if (brands.some((brand) => brand.includes("brave"))) {
    return "brave";
  }
  if (brands.some((brand) => brand.includes("edge"))) {
    return "edge";
  }
  if (brands.some((brand) => brand.includes("google chrome"))) {
    return "chrome";
  }
  if (brands.some((brand) => brand.includes("chromium"))) {
    return "chromium";
  }
  return "unknown";
}

interface NavigatorWithHints {
  readonly userAgentData?: { readonly brands?: ReadonlyArray<{ readonly brand: string }> };
  readonly brave?: unknown;
}

export function detectBrowserFromNavigator(nav: unknown): BrowserKind {
  const candidate = (nav ?? {}) as NavigatorWithHints;
  const brands = (candidate.userAgentData?.brands ?? []).map((entry) => entry.brand);
  return detectBrowser({ brands, hasBraveApi: candidate.brave !== undefined });
}
