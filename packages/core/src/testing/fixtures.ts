import type { ActivityEvent, Episode } from "@apprentice/schemas";

let seqCounter = 0;

/** Deterministic event builder for tests and fixtures. */
export function makeEvent(overrides: Partial<ActivityEvent> & { ts: number; type: ActivityEvent["type"] }): ActivityEvent {
  seqCounter += 1;
  const seq = overrides.seq ?? seqCounter;
  return {
    id: overrides.id ?? `evt_${String(seq).padStart(6, "0")}`,
    seq,
    sessionId: overrides.sessionId ?? "session_test",
    source: overrides.source ?? "native_helper",
    privacy: overrides.privacy ?? "allowed",
    redaction: overrides.redaction ?? "none_needed",
    ...overrides
  };
}

export function resetEventSequence(): void {
  seqCounter = 0;
}

export interface ClickSpec {
  readonly ts: number;
  readonly domain?: string;
  readonly route?: string;
  readonly name?: string;
  readonly role?: string;
  readonly bundleId?: string;
}

export function makeClick(spec: ClickSpec): ActivityEvent {
  return makeEvent({
    ts: spec.ts,
    type: "click",
    source: spec.domain !== undefined ? "extension" : "native_helper",
    app: { bundleId: spec.bundleId ?? "com.google.Chrome", name: "Google Chrome" },
    domain: spec.domain,
    routePattern: spec.route,
    element: spec.name !== undefined ? { role: spec.role ?? "button", name: spec.name } : undefined
  });
}

export type EpisodeOverrides = Omit<Partial<Episode>, "actionTokens"> & { id: string; actionTokens: readonly string[] };

export function makeEpisode(overrides: EpisodeOverrides): Episode {
  const tokens = [...overrides.actionTokens];
  return {
    sessionId: "session_test",
    startTs: 0,
    endTs: 120_000,
    eventIds: tokens.map((_, index) => `${overrides.id}_e${index}`),
    boundary: "inferred",
    boundaryReasons: ["session_edge"],
    apps: ["chrome"],
    domains: [],
    meaningfulActionCount: tokens.length,
    activeDurationMs: 120_000,
    privacyStatus: "clean",
    analysisStatus: "none",
    consumptionScore: 0,
    ...overrides,
    actionTokens: tokens
  };
}
