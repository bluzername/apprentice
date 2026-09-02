import type { ActivityEvent } from "@apprentice/schemas";
import { createRng, mixSeed } from "./prng.js";
import {
  activeDuration,
  buildEpisode,
  eventId,
  uniqueApps,
  uniqueDomains,
  type StepSpec
} from "./scenarios/builder.js";
import { CHROME, DOMAINS } from "./scenarios/constants.js";
import type { GeneratedEpisode, GenerateEpisodeOptions } from "./types.js";

const CONSUMPTION_SALT = 404;
const SENSITIVE_SALT = 505;
const PRIVACY_GAP_SALT = 606;

function scrollStep(domain: string, routePattern: string, gap: readonly [number, number]): StepSpec {
  return { type: "shortcut", domain, routePattern, payload: { keys: "pagedown", intent: "scroll" }, gap };
}

/** News, video, and social browsing: navigations and scrolls, no outcome event. */
export function generateConsumptionEpisode(opts: GenerateEpisodeOptions): GeneratedEpisode {
  const variant = opts.variant ?? 0;
  const rng = createRng(mixSeed(opts.seed, opts.occurrence, CONSUMPTION_SALT, variant));
  const articleId = rng.hex(8);
  const videoId = rng.hex(11);
  const articleRoute = `/article/${articleId}`;
  const videoRoute = `/watch/${videoId}`;
  const specs: readonly StepSpec[] = [
    { type: "app_activated", app: CHROME, gap: [0, 0], shot: "newsFeed" },
    { type: "navigation", domain: DOMAINS.news, routePattern: "/", gap: [3, 6], shot: "newsFeed" },
    { type: "page_title", domain: DOMAINS.news, routePattern: "/", payload: { title: "Front page - News" }, gap: [2, 4] },
    scrollStep(DOMAINS.news, "/", [8, 20]),
    scrollStep(DOMAINS.news, "/", [8, 20]),
    { type: "click", domain: DOMAINS.news, routePattern: "/", element: { role: "link", name: "Read more" }, gap: [5, 12] },
    { type: "navigation", domain: DOMAINS.news, routePattern: articleRoute, gap: [2, 4], shot: "newsFeed" },
    scrollStep(DOMAINS.news, articleRoute, [20, 40]),
    scrollStep(DOMAINS.news, articleRoute, [20, 40]),
    { type: "navigation", domain: DOMAINS.video, routePattern: videoRoute, gap: [6, 12], shot: "genericBlank" },
    { type: "page_title", domain: DOMAINS.video, routePattern: videoRoute, payload: { title: "Watch - Video" }, gap: [2, 4] },
    { type: "idle_changed", payload: { idle: false }, gap: [30, 40] },
    { type: "navigation", domain: DOMAINS.social, routePattern: "/feed", gap: [10, 20], shot: "genericBlank" },
    scrollStep(DOMAINS.social, "/feed", [10, 25]),
    scrollStep(DOMAINS.social, "/feed", [10, 25]),
    scrollStep(DOMAINS.social, "/feed", [10, 25])
  ];
  const built = buildEpisode(specs, { rng, sessionId: opts.sessionId, startTs: opts.startTs, seqStart: opts.seqStart });
  return {
    events: [...built.events],
    screenshotRefs: [...built.screenshotRefs],
    expected: {
      apps: [...uniqueApps(built.events)],
      domains: [...uniqueDomains(built.events)],
      outcomeType: "none",
      activeDurationMs: activeDuration(built.events)
    }
  };
}

/** Banking visit: sensitive navigation, secure field focus, then privacy gaps until the user leaves. */
export function generateSensitiveEpisode(opts: GenerateEpisodeOptions): GeneratedEpisode {
  const rng = createRng(mixSeed(opts.seed, opts.occurrence, SENSITIVE_SALT));
  const gapSteps: readonly StepSpec[] = Array.from({ length: rng.int(2, 4) }, () => ({
    type: "privacy_gap" as const,
    source: "extension" as const,
    privacy: "privacy_gap" as const,
    redaction: "redacted" as const,
    payload: { reason: "sensitive_page" },
    gap: [15, 40] as const
  }));
  const specs: readonly StepSpec[] = [
    { type: "app_activated", app: CHROME, gap: [0, 0], shot: "genericBlank" },
    {
      type: "navigation",
      domain: DOMAINS.bank,
      privacy: "sensitive",
      redaction: "redacted",
      gap: [3, 6]
    },
    {
      type: "secure_field_focused",
      domain: DOMAINS.bank,
      privacy: "sensitive",
      redaction: "redacted",
      payload: { reason: "password_field" },
      gap: [4, 10]
    },
    ...gapSteps,
    { type: "idle_changed", payload: { idle: false }, gap: [5, 10] }
  ];
  const built = buildEpisode(specs, { rng, sessionId: opts.sessionId, startTs: opts.startTs, seqStart: opts.seqStart });
  return {
    events: [...built.events],
    screenshotRefs: [...built.screenshotRefs],
    expected: {
      apps: [...uniqueApps(built.events)],
      domains: [...uniqueDomains(built.events)],
      outcomeType: "none",
      activeDurationMs: activeDuration(built.events)
    }
  };
}

export interface PrivacyGapOptions {
  readonly seed: number;
  readonly startTs: number;
  readonly sessionId: string;
  readonly seqStart: number;
  readonly count?: number;
}

/** Focus on non-allowlisted apps: privacy_gap events only, no app identity, no screenshots. */
export function generatePrivacyGapEvents(opts: PrivacyGapOptions): readonly ActivityEvent[] {
  const rng = createRng(mixSeed(opts.seed, opts.seqStart, PRIVACY_GAP_SALT));
  const count = opts.count ?? rng.int(2, 5);
  const gaps = Array.from({ length: count }, (_, index) => (index === 0 ? 0 : rng.int(20, 90) * 1000));
  const timestamps = gaps.reduce<readonly number[]>(
    (acc, gap) => [...acc, (acc[acc.length - 1] ?? opts.startTs) + gap],
    []
  );
  return timestamps.map((ts, index) => ({
    id: eventId(opts.sessionId, opts.seqStart + index),
    ts,
    seq: opts.seqStart + index,
    sessionId: opts.sessionId,
    source: "native_helper",
    type: "privacy_gap",
    privacy: "privacy_gap",
    redaction: "none_needed",
    activeDurationMs: gaps[index] ?? 0,
    payload: { reason: "app_not_allowlisted" }
  }));
}
