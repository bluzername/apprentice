/** Injectable time source so services can be driven deterministically in tests. */
export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = Object.freeze({
  now: () => Date.now(),
  sleep: (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      timer.unref?.();
    })
});

/** Clock for tests: time advances only when told to; sleeps resolve immediately. */
export function createManualClock(start = 1_760_000_000_000): Clock & { advance(ms: number): void; set(ts: number): void } {
  let current = start;
  return {
    now: () => current,
    sleep: async () => undefined,
    advance: (ms) => {
      current += ms;
    },
    set: (ts) => {
      current = ts;
    }
  };
}
