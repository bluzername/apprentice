/**
 * Pure helpers for the offline GUI-grounding accuracy benchmark: manifest
 * validation, coordinate mapping, hit scoring, aggregation and report
 * formatting. Nothing here touches the network, the filesystem or macOS, so it
 * runs in the normal unit suite (bench/grounding-score.test.ts).
 *
 * The manifest is produced by scripts/make-grounding-cases.mjs from real
 * accessibility rectangles; the evaluation driver lives in
 * bench/grounding-eval.test.ts.
 */
import { z } from "zod";

export const GroundingRectSchema = z.object({
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  width: z.number().positive(),
  height: z.number().positive()
});
export type GroundingRect = z.infer<typeof GroundingRectSchema>;

export const GroundingActionSchema = z.enum(["click", "double_click"]);
export type GroundingAction = z.infer<typeof GroundingActionSchema>;

export const GroundingCaseSchema = z.object({
  id: z.string().min(1).max(200),
  app: z.string().min(1).max(120),
  /** PNG path; relative entries resolve against the manifest directory. */
  image: z.string().min(1).max(1024),
  imageWidth: z.number().int().positive(),
  imageHeight: z.number().int().positive(),
  instruction: z.string().min(1).max(500),
  /** Ground-truth rectangle in image pixels. */
  rect: GroundingRectSchema,
  role: z.string().min(1).max(120),
  label: z.string().min(1).max(300),
  expectedAction: GroundingActionSchema.default("click")
});
export type GroundingCase = z.infer<typeof GroundingCaseSchema>;

export const GroundingManifestSchema = z.object({
  cases: z.array(GroundingCaseSchema).min(1)
});
export type GroundingManifest = z.infer<typeof GroundingManifestSchema>;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Dims {
  readonly width: number;
  readonly height: number;
}

/** One model proposal, flattened to what scoring needs. */
export interface GroundingProposal {
  readonly type: string;
  /** Absent for actions that carry no coordinate (type_text, done, ...). */
  readonly x?: number;
  readonly y?: number;
  /** Pixel space the coordinates are expressed in (action.sourceScreenshot). */
  readonly sourceWidth: number;
  readonly sourceHeight: number;
}

export interface CaseScore {
  readonly hit: boolean;
  readonly actionType: string | null;
  readonly actionTypeMatches: boolean;
  readonly point: Point | null;
  readonly mappedPoint: Point | null;
  /** Distance in manifest pixels to the rect (0 inside); null without a point. */
  readonly distancePx: number | null;
}

export interface GroundingOutcome {
  readonly id: string;
  readonly app: string;
  readonly role: string;
  readonly label: string;
  readonly instruction: string;
  readonly expectedAction: GroundingAction;
  readonly actionType: string | null;
  readonly actionTypeMatches: boolean;
  readonly hit: boolean;
  /** False when the reply could not be parsed into an action at all. */
  readonly parsed: boolean;
  readonly point: Point | null;
  readonly mappedPoint: Point | null;
  readonly distancePx: number | null;
  readonly latencyMs: number;
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly parseErrors?: readonly string[];
  readonly error?: string;
}

export interface GroupStat {
  readonly key: string;
  readonly total: number;
  readonly hits: number;
  readonly hitRate: number;
}

export interface ActionCount {
  readonly key: string;
  readonly total: number;
}

export interface GroundingSummary {
  readonly total: number;
  readonly hits: number;
  readonly hitRate: number;
  readonly parseFailures: number;
  readonly errors: number;
  readonly actionTypeMatches: number;
  readonly medianLatencyMs: number;
  readonly medianPromptTokens: number;
  readonly medianCompletionTokens: number;
  readonly byApp: readonly GroupStat[];
  readonly byRole: readonly GroupStat[];
  readonly actionCounts: readonly ActionCount[];
}

/** Map a point from the pixel space the provider reported into manifest pixels. */
export function mapPoint(point: Point, from: Dims, to: Dims): Point {
  if (from.width <= 0 || from.height <= 0) {
    throw new RangeError("source dimensions must be positive");
  }
  return { x: (point.x * to.width) / from.width, y: (point.y * to.height) / from.height };
}

/** Distance from a point to the nearest point of the rect (0 when inside). */
export function distanceToRect(point: Point, rect: GroundingRect): number {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

export function pointInRect(point: Point, rect: GroundingRect, tolerancePx = 0): boolean {
  return distanceToRect(point, rect) <= tolerancePx;
}

const MISS: CaseScore = { hit: false, actionType: null, actionTypeMatches: false, point: null, mappedPoint: null, distancePx: null };

/** Score one proposal against the ground-truth rectangle of a case. */
export function scoreCase(testCase: GroundingCase, proposal: GroundingProposal | null, tolerancePx = 0): CaseScore {
  if (proposal === null) {
    return MISS;
  }
  const actionTypeMatches = proposal.type === testCase.expectedAction;
  if (proposal.x === undefined || proposal.y === undefined) {
    return { hit: false, actionType: proposal.type, actionTypeMatches, point: null, mappedPoint: null, distancePx: null };
  }
  const point = { x: proposal.x, y: proposal.y };
  const mappedPoint = mapPoint(
    point,
    { width: proposal.sourceWidth, height: proposal.sourceHeight },
    { width: testCase.imageWidth, height: testCase.imageHeight }
  );
  const distancePx = distanceToRect(mappedPoint, testCase.rect);
  return { hit: distancePx <= tolerancePx, actionType: proposal.type, actionTypeMatches, point, mappedPoint, distancePx };
}

export function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? 0;
  }
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function groupBy(outcomes: readonly GroundingOutcome[], pick: (outcome: GroundingOutcome) => string): readonly GroupStat[] {
  const totals = new Map<string, { total: number; hits: number }>();
  for (const outcome of outcomes) {
    const key = pick(outcome);
    const current = totals.get(key) ?? { total: 0, hits: 0 };
    totals.set(key, { total: current.total + 1, hits: current.hits + (outcome.hit ? 1 : 0) });
  }
  return [...totals.entries()]
    .map(([key, value]) => ({ key, total: value.total, hits: value.hits, hitRate: value.hits / value.total }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function aggregate(outcomes: readonly GroundingOutcome[]): GroundingSummary {
  const hits = outcomes.filter((outcome) => outcome.hit).length;
  const actionCounts = new Map<string, number>();
  for (const outcome of outcomes) {
    if (outcome.actionType !== null) {
      actionCounts.set(outcome.actionType, (actionCounts.get(outcome.actionType) ?? 0) + 1);
    }
  }
  const definedTokens = (pick: (outcome: GroundingOutcome) => number | undefined): number[] =>
    outcomes.map(pick).filter((value): value is number => typeof value === "number");
  return {
    total: outcomes.length,
    hits,
    hitRate: outcomes.length === 0 ? 0 : hits / outcomes.length,
    parseFailures: outcomes.filter((outcome) => !outcome.parsed).length,
    errors: outcomes.filter((outcome) => outcome.error !== undefined).length,
    actionTypeMatches: outcomes.filter((outcome) => outcome.actionTypeMatches).length,
    medianLatencyMs: median(outcomes.map((outcome) => outcome.latencyMs)),
    medianPromptTokens: median(definedTokens((outcome) => outcome.promptTokens)),
    medianCompletionTokens: median(definedTokens((outcome) => outcome.completionTokens)),
    byApp: groupBy(outcomes, (outcome) => outcome.app),
    byRole: groupBy(outcomes, (outcome) => outcome.role),
    actionCounts: [...actionCounts.entries()]
      .map(([key, total]) => ({ key, total }))
      .sort((a, b) => a.key.localeCompare(b.key))
  };
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function statRows(label: string, stats: readonly GroupStat[]): readonly string[] {
  return stats.length === 0 ? [] : [`| **${label}** | | | |`, ...stats.map((stat) => `| ${stat.key} | ${stat.total} | ${stat.hits} | ${percent(stat.hitRate)} |`)];
}

/** Markdown summary printed at the end of the benchmark run. */
export function formatSummaryMarkdown(summary: GroundingSummary): string {
  const lines = [
    "| Scope | Cases | Hits | Hit rate |",
    "| --- | --- | --- | --- |",
    `| overall | ${summary.total} | ${summary.hits} | ${percent(summary.hitRate)} |`,
    ...statRows("by app", summary.byApp),
    ...statRows("by role", summary.byRole),
    "",
    `median latency ${Math.round(summary.medianLatencyMs)} ms | median prompt tokens ${Math.round(summary.medianPromptTokens)} | median completion tokens ${Math.round(summary.medianCompletionTokens)}`,
    `parse failures ${summary.parseFailures} | call errors ${summary.errors} | expected action type ${summary.actionTypeMatches}/${summary.total}`,
    `actions: ${summary.actionCounts.map((entry) => `${entry.key}=${entry.total}`).join(", ") || "none"}`
  ];
  return lines.join("\n");
}

/** Per-case detail table, printed after the summary. */
export function formatOutcomesMarkdown(outcomes: readonly GroundingOutcome[]): string {
  const rows = outcomes.map((outcome) => {
    const point = outcome.mappedPoint ? `${Math.round(outcome.mappedPoint.x)},${Math.round(outcome.mappedPoint.y)}` : "-";
    const distance = outcome.distancePx === null ? "-" : Math.round(outcome.distancePx).toString();
    const note = outcome.error ?? (outcome.parseErrors?.length ? `parseErrors=${outcome.parseErrors.length}` : "");
    return `| ${outcome.id} | ${outcome.app} | ${outcome.role} | ${outcome.label} | ${outcome.actionType ?? "-"} | ${point} | ${distance} | ${outcome.hit ? "hit" : "miss"} | ${Math.round(outcome.latencyMs)} | ${note} |`;
  });
  return ["| Case | App | Role | Label | Action | Point | Dist px | Result | ms | Note |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |", ...rows].join("\n");
}
