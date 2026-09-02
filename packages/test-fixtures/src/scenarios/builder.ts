import type {
  ActivityEvent,
  ActivityEventType,
  AppRef,
  EventPayload,
  EventSource,
  PrivacyClassification,
  RedactionState,
  ScreenshotReason,
  SemanticElement
} from "@apprentice/schemas";
import type { Rng } from "../prng.js";
import type { ScreenshotFixtureRef, TemplateName } from "../types.js";
import { CHROME, MAX_GAP_S, MIN_GAP_S, MIN_SCREENSHOT_INTERVAL_MS } from "./constants.js";

/** Declarative description of one synthetic event. Gaps are seconds since the previous event. */
export interface StepSpec {
  readonly type: ActivityEventType;
  readonly gap: readonly [number, number];
  readonly source?: EventSource;
  readonly app?: AppRef;
  readonly domain?: string;
  readonly routePattern?: string;
  readonly element?: SemanticElement;
  readonly payload?: EventPayload;
  readonly shot?: TemplateName;
  readonly privacy?: PrivacyClassification;
  readonly redaction?: RedactionState;
}

export interface BuildOptions {
  readonly rng: Rng;
  readonly sessionId: string;
  readonly startTs: number;
  readonly seqStart: number;
}

export interface BuiltEpisode {
  readonly events: readonly ActivityEvent[];
  readonly screenshotRefs: readonly ScreenshotFixtureRef[];
}

interface BuildState {
  readonly events: readonly ActivityEvent[];
  readonly screenshotRefs: readonly ScreenshotFixtureRef[];
  readonly ts: number;
  readonly seq: number;
  readonly lastShotTs: number;
  readonly currentApp: AppRef;
}

const SHOT_REASONS: Partial<Record<ActivityEventType, ScreenshotReason>> = {
  app_activated: "app_change",
  window_title_changed: "window_change",
  navigation: "navigation",
  click: "click",
  form_submit: "form_submit"
};

export function eventId(sessionId: string, seq: number): string {
  return `${sessionId}-e${seq}`;
}

export function screenshotId(sessionId: string, seq: number): string {
  return `${sessionId}-s${seq}`;
}

function clampGapSeconds(spec: StepSpec, rng: Rng): number {
  const [lo, hi] = spec.gap;
  if (lo === 0 && hi === 0) {
    return 0;
  }
  const bounded: readonly [number, number] = [Math.max(MIN_GAP_S, lo), Math.min(MAX_GAP_S, hi)];
  return rng.int(bounded[0], bounded[1]);
}

function resolveSource(spec: StepSpec): EventSource {
  if (spec.source) {
    return spec.source;
  }
  return spec.domain ? "extension" : "native_helper";
}

function applyStep(state: BuildState, spec: StepSpec, opts: BuildOptions, index: number): BuildState {
  const gapMs = index === 0 ? 0 : clampGapSeconds(spec, opts.rng) * 1000;
  const ts = state.ts + gapMs;
  const seq = state.seq;
  const id = eventId(opts.sessionId, seq);
  const app = spec.app ?? (spec.privacy === "privacy_gap" ? undefined : state.currentApp);
  const reason = spec.shot ? SHOT_REASONS[spec.type] : undefined;
  const wantsShot = spec.shot !== undefined && reason !== undefined;
  const shotAllowed = wantsShot && ts - state.lastShotTs >= MIN_SCREENSHOT_INTERVAL_MS;
  const ref: ScreenshotFixtureRef | undefined =
    shotAllowed && spec.shot && reason
      ? {
          id: screenshotId(opts.sessionId, seq),
          eventId: id,
          ts,
          sessionId: opts.sessionId,
          fixtureName: spec.shot,
          reason,
          ...(app ? { app } : {}),
          ...(spec.domain ? { domain: spec.domain } : {})
        }
      : undefined;
  const event: ActivityEvent = {
    id,
    ts,
    seq,
    sessionId: opts.sessionId,
    source: resolveSource(spec),
    type: spec.type,
    ...(app ? { app } : {}),
    ...(spec.domain ? { domain: spec.domain } : {}),
    ...(spec.routePattern ? { routePattern: spec.routePattern } : {}),
    ...(spec.element ? { element: spec.element } : {}),
    ...(ref ? { screenshotRef: ref.id } : {}),
    privacy: spec.privacy ?? "allowed",
    redaction: spec.redaction ?? "none_needed",
    activeDurationMs: gapMs,
    ...(spec.payload ? { payload: spec.payload } : {})
  };
  return {
    events: [...state.events, event],
    screenshotRefs: ref ? [...state.screenshotRefs, ref] : state.screenshotRefs,
    ts,
    seq: seq + 1,
    lastShotTs: ref ? ts : state.lastShotTs,
    currentApp: spec.type === "app_activated" && spec.app ? spec.app : state.currentApp
  };
}

/** Folds step specs into ordered, sequenced events with sparse screenshot refs. */
export function buildEpisode(specs: readonly StepSpec[], opts: BuildOptions): BuiltEpisode {
  const initial: BuildState = {
    events: [],
    screenshotRefs: [],
    ts: opts.startTs,
    seq: opts.seqStart,
    lastShotTs: Number.NEGATIVE_INFINITY,
    currentApp: CHROME
  };
  const final = specs.reduce<BuildState>((state, spec, index) => applyStep(state, spec, opts, index), initial);
  return { events: final.events, screenshotRefs: final.screenshotRefs };
}

/** Includes `steps` only when the requested variant matches. */
export function onlyVariant(variant: number, wanted: number, steps: readonly StepSpec[]): readonly StepSpec[] {
  return variant === wanted ? steps : [];
}

/** Excludes `steps` when the requested variant matches. */
export function unlessVariant(variant: number, excluded: number, steps: readonly StepSpec[]): readonly StepSpec[] {
  return variant === excluded ? [] : steps;
}

const MEANINGFUL_TYPES: ReadonlySet<ActivityEventType> = new Set([
  "click",
  "form_submit",
  "field_input",
  "download",
  "copy",
  "paste",
  "shortcut"
]);

/** Counts actions the segmentation engine should treat as meaningful (scroll shortcuts excluded). */
export function countMeaningfulActions(events: readonly ActivityEvent[]): number {
  return events.filter((event) => {
    if (!MEANINGFUL_TYPES.has(event.type)) {
      return false;
    }
    return !(event.type === "shortcut" && event.payload?.intent === "scroll");
  }).length;
}

export function uniqueApps(events: readonly ActivityEvent[]): readonly string[] {
  return [...new Set(events.flatMap((event) => (event.app?.bundleId ? [event.app.bundleId] : [])))];
}

export function uniqueDomains(events: readonly ActivityEvent[]): readonly string[] {
  return [...new Set(events.flatMap((event) => (event.domain ? [event.domain] : [])))];
}

export function activeDuration(events: readonly ActivityEvent[]): number {
  const first = events[0];
  const last = events[events.length - 1];
  return first && last ? last.ts - first.ts : 0;
}
