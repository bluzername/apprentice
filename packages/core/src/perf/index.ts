export interface TimingSummary {
  readonly count: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
  readonly last: number;
}

export type MetricsSnapshot = Readonly<Record<string, TimingSummary>>;

const DEFAULT_MAX_SAMPLES = 1000;

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index]!;
}

/** In-memory timing histogram (bounded samples) plus counters. */
export class MetricsRecorder {
  private readonly samples = new Map<string, number[]>();
  private readonly counts = new Map<string, number>();
  private readonly maxSamples: number;

  constructor(options: { maxSamples?: number } = {}) {
    if (options.maxSamples !== undefined && options.maxSamples <= 0) throw new Error("MetricsRecorder: maxSamples must be positive");
    this.maxSamples = options.maxSamples ?? DEFAULT_MAX_SAMPLES;
  }

  record(name: string, ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) throw new Error(`MetricsRecorder: invalid duration for ${name}`);
    const existing = this.samples.get(name) ?? [];
    const next = existing.length >= this.maxSamples ? [...existing.slice(1), ms] : [...existing, ms];
    this.samples.set(name, next);
  }

  increment(name: string, by = 1): void {
    if (!Number.isFinite(by)) throw new Error(`MetricsRecorder: invalid increment for ${name}`);
    this.counts.set(name, (this.counts.get(name) ?? 0) + by);
  }

  snapshot(): MetricsSnapshot {
    const out: Record<string, TimingSummary> = {};
    for (const [name, values] of this.samples) {
      const sorted = [...values].sort((a, b) => a - b);
      out[name] = {
        count: values.length,
        p50: percentile(sorted, 0.5),
        p95: percentile(sorted, 0.95),
        max: sorted[sorted.length - 1] ?? 0,
        last: values[values.length - 1] ?? 0
      };
    }
    return out;
  }

  counters(): Readonly<Record<string, number>> {
    return Object.fromEntries(this.counts);
  }

  /** Flat numeric view for the perf:metrics IPC channel. */
  flat(): Readonly<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const [name, summary] of Object.entries(this.snapshot())) {
      out[`${name}.count`] = summary.count;
      out[`${name}.p50`] = summary.p50;
      out[`${name}.p95`] = summary.p95;
      out[`${name}.max`] = summary.max;
      out[`${name}.last`] = summary.last;
    }
    for (const [name, value] of this.counts) out[`counter.${name}`] = value;
    return out;
  }

  reset(): void {
    this.samples.clear();
    this.counts.clear();
  }
}
