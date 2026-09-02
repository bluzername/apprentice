import type { ActivityEvent } from "@apprentice/schemas";
import { generateConsumptionEpisode, generatePrivacyGapEvents, generateSensitiveEpisode } from "./filler.js";
import { createRng, mixSeed, type Rng } from "./prng.js";
import { eventId } from "./scenarios/builder.js";
import { SCENARIO_GENERATORS } from "./scenarios/index.js";
import {
  SCENARIO_NAMES,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
  type DemoDataset,
  type DemoSession,
  type GeneratedEpisode,
  type ScenarioName,
  type ScenarioOccurrence,
  type ScreenshotFixture
} from "./types.js";

export interface GenerateDemoDaysOptions {
  readonly days?: number;
  readonly seed?: number;
  readonly endTs?: number;
  readonly scenarios?: readonly ScenarioName[];
  readonly sessionIdPrefix?: string;
}

const WORKDAY_START_HOUR = 9;
const WORKDAY_END_HOUR = 18;
const FIRST_BLOCK_OFFSET_MIN = 10;
const BLOCK_SPACING_MIN = 62;
const BLOCK_JITTER_MIN = 15;
const CONSUMPTION_BLOCKS_PER_DAY = 2;
const PRIVACY_GAP_RUNS_PER_DAY = 2;
const MINUTE_MS = 60 * 1000;

type Block =
  | { readonly kind: "scenario"; readonly scenario: ScenarioName }
  | { readonly kind: "consumption" }
  | { readonly kind: "sensitive" }
  | { readonly kind: "privacyGaps" };

interface DayPlan {
  readonly session: DemoSession;
  readonly blocks: readonly { readonly block: Block; readonly startTs: number }[];
}

interface Accumulator {
  readonly events: readonly ActivityEvent[];
  readonly screenshots: readonly ScreenshotFixture[];
  readonly occurrences: readonly ScenarioOccurrence[];
  readonly seq: number;
  readonly counts: { readonly consumption: number; readonly sensitive: number; readonly privacyGapRuns: number };
}

function localDayAt(ts: number, hour: number): number {
  const date = new Date(ts);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, 0, 0, 0).getTime();
}

function isWeekend(ts: number): boolean {
  const day = new Date(ts).getDay();
  return day === 0 || day === 6;
}

function previousDay(ts: number): number {
  const date = new Date(ts);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1, 12, 0, 0, 0).getTime();
}

/** Walks backwards from endTs collecting `days` weekday start timestamps (09:00 local), oldest first. */
function workdayStarts(endTs: number, days: number): readonly number[] {
  const lastCandidate = endTs >= localDayAt(endTs, WORKDAY_END_HOUR) ? endTs : previousDay(endTs);
  const collect = (cursor: number, acc: readonly number[]): readonly number[] => {
    if (acc.length >= days) {
      return acc;
    }
    const next = isWeekend(cursor) ? acc : [localDayAt(cursor, WORKDAY_START_HOUR), ...acc];
    return collect(previousDay(cursor), next);
  };
  return collect(lastCandidate, []);
}

function shuffle<T>(items: readonly T[], rng: Rng): readonly T[] {
  return items
    .map((item) => ({ item, key: rng.next() }))
    .sort((a, b) => a.key - b.key)
    .map((entry) => entry.item);
}

function planDay(
  dayIndex: number,
  dayStartTs: number,
  scenarios: readonly ScenarioName[],
  prefix: string,
  rng: Rng
): DayPlan {
  const blocks: readonly Block[] = [
    ...scenarios.map((scenario): Block => ({ kind: "scenario", scenario })),
    ...Array.from({ length: CONSUMPTION_BLOCKS_PER_DAY }, (): Block => ({ kind: "consumption" })),
    { kind: "sensitive" },
    ...Array.from({ length: PRIVACY_GAP_RUNS_PER_DAY }, (): Block => ({ kind: "privacyGaps" }))
  ];
  const ordered = shuffle(blocks, rng);
  const placed = ordered.map((block, index) => ({
    block,
    startTs:
      dayStartTs + (FIRST_BLOCK_OFFSET_MIN + index * BLOCK_SPACING_MIN + rng.int(0, BLOCK_JITTER_MIN)) * MINUTE_MS
  }));
  return {
    session: {
      id: `${prefix}-day${dayIndex + 1}`,
      dayIndex,
      startTs: dayStartTs,
      endTs: localDayAt(dayStartTs, WORKDAY_END_HOUR)
    },
    blocks: placed
  };
}

function sessionEdge(session: DemoSession, type: "session_start" | "session_end", seq: number): ActivityEvent {
  return {
    id: eventId(session.id, seq),
    ts: type === "session_start" ? session.startTs : session.endTs,
    seq,
    sessionId: session.id,
    source: "system",
    type,
    privacy: "allowed",
    redaction: "none_needed",
    activeDurationMs: 0
  };
}

function toFixtures(episode: GeneratedEpisode): readonly ScreenshotFixture[] {
  return episode.screenshotRefs.map((ref) => ({ ...ref, width: SCREEN_WIDTH, height: SCREEN_HEIGHT }));
}

function appendEpisode(acc: Accumulator, episode: GeneratedEpisode): Accumulator {
  return {
    ...acc,
    events: [...acc.events, ...episode.events],
    screenshots: [...acc.screenshots, ...toFixtures(episode)],
    seq: acc.seq + episode.events.length
  };
}

function applyBlock(
  acc: Accumulator,
  entry: DayPlan["blocks"][number],
  session: DemoSession,
  seed: number,
  scenarioOccurrence: (scenario: ScenarioName) => number
): Accumulator {
  const { block, startTs } = entry;
  const base = { startTs, sessionId: session.id, seqStart: acc.seq };
  if (block.kind === "scenario") {
    const occurrence = scenarioOccurrence(block.scenario);
    const variant = (occurrence - 1) % 3;
    const episode = SCENARIO_GENERATORS[block.scenario]({ ...base, seed, occurrence, variant });
    const last = episode.events[episode.events.length - 1];
    const record: ScenarioOccurrence = {
      scenario: block.scenario,
      occurrence,
      variant,
      sessionId: session.id,
      startTs,
      endTs: last ? last.ts : startTs,
      firstSeq: acc.seq,
      lastSeq: acc.seq + episode.events.length - 1,
      expected: episode.expected
    };
    const next = appendEpisode(acc, episode);
    return { ...next, occurrences: [...next.occurrences, record] };
  }
  if (block.kind === "consumption") {
    const occurrence = acc.counts.consumption + 1;
    const next = appendEpisode(acc, generateConsumptionEpisode({ ...base, seed, occurrence, variant: session.dayIndex }));
    return { ...next, counts: { ...next.counts, consumption: occurrence } };
  }
  if (block.kind === "sensitive") {
    const occurrence = acc.counts.sensitive + 1;
    const next = appendEpisode(acc, generateSensitiveEpisode({ ...base, seed, occurrence }));
    return { ...next, counts: { ...next.counts, sensitive: occurrence } };
  }
  const gaps = generatePrivacyGapEvents({ ...base, seed });
  return {
    ...acc,
    events: [...acc.events, ...gaps],
    seq: acc.seq + gaps.length,
    counts: { ...acc.counts, privacyGapRuns: acc.counts.privacyGapRuns + 1 }
  };
}

function applyDay(acc: Accumulator, plan: DayPlan, seed: number): Accumulator {
  const started: Accumulator = { ...acc, events: [...acc.events, sessionEdge(plan.session, "session_start", acc.seq)], seq: acc.seq + 1 };
  const occurrenceFor = (scenario: ScenarioName): number =>
    acc.occurrences.filter((occurrence) => occurrence.scenario === scenario).length + 1;
  const filled = plan.blocks.reduce<Accumulator>(
    (state, entry) => applyBlock(state, entry, plan.session, seed, occurrenceFor),
    started
  );
  return { ...filled, events: [...filled.events, sessionEdge(plan.session, "session_end", filled.seq)], seq: filled.seq + 1 };
}

function countByScenario(occurrences: readonly ScenarioOccurrence[]): Record<ScenarioName, number> {
  return Object.fromEntries(
    SCENARIO_NAMES.map((name) => [name, occurrences.filter((occurrence) => occurrence.scenario === name).length])
  ) as Record<ScenarioName, number>;
}

/**
 * Simulates `days` workdays (09:00-18:00 local, weekdays only) with one occurrence of each
 * selected scenario per day plus consumption filler, a sensitive visit, and privacy gaps.
 */
export function generateDemoDays(opts: GenerateDemoDaysOptions = {}): DemoDataset {
  const days = opts.days ?? 3;
  const seed = opts.seed ?? 42;
  const endTs = opts.endTs ?? Date.now();
  const scenarios = opts.scenarios ?? SCENARIO_NAMES;
  const prefix = opts.sessionIdPrefix ?? "demo";
  if (!Number.isInteger(days) || days < 2) {
    throw new Error(`generateDemoDays: days must be an integer >= 2 (got ${String(opts.days)})`);
  }
  if (scenarios.length === 0) {
    throw new Error("generateDemoDays: at least one scenario is required");
  }
  const rng = createRng(mixSeed(seed, days, 777));
  const plans = workdayStarts(endTs, days).map((dayStartTs, dayIndex) =>
    planDay(dayIndex, dayStartTs, scenarios, prefix, rng)
  );
  const initial: Accumulator = {
    events: [],
    screenshots: [],
    occurrences: [],
    seq: 0,
    counts: { consumption: 0, sensitive: 0, privacyGapRuns: 0 }
  };
  const result = plans.reduce<Accumulator>((acc, plan) => applyDay(acc, plan, seed), initial);
  const firstSession = plans[0]?.session;
  const lastSession = plans[plans.length - 1]?.session;
  return {
    version: 1,
    seed,
    days,
    startTs: firstSession ? firstSession.startTs : endTs,
    endTs: lastSession ? lastSession.endTs : endTs,
    sessions: plans.map((plan) => plan.session),
    events: [...result.events],
    screenshots: [...result.screenshots],
    occurrences: [...result.occurrences],
    episodesExpected: countByScenario(result.occurrences),
    fillerExpected: result.counts
  };
}
