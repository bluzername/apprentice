/** Fixed-window counter per key; immutable snapshots are not needed because entries expire. */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number
  ) {}

  /** Returns true when the request is allowed; false when the window is exhausted. */
  allow(key: string): boolean {
    const current = this.now();
    const entry = this.windows.get(key);
    if (!entry || current - entry.start >= this.windowMs) {
      this.windows.set(key, { start: current, count: 1 });
      this.prune(current);
      return true;
    }
    if (entry.count >= this.limit) return false;
    this.windows.set(key, { start: entry.start, count: entry.count + 1 });
    return true;
  }

  retryAfterSeconds(key: string): number {
    const entry = this.windows.get(key);
    if (!entry) return 0;
    return Math.max(1, Math.ceil((entry.start + this.windowMs - this.now()) / 1000));
  }

  private prune(current: number): void {
    if (this.windows.size < 1000) return;
    for (const [key, entry] of this.windows) {
      if (current - entry.start >= this.windowMs) this.windows.delete(key);
    }
  }
}
