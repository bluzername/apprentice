import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionEvent } from "@apprentice/schemas";
import { LoopbackError } from "./errors.js";
import { backoffDelay, createEventQueue } from "./queue.js";

function event(index: number): ExtensionEvent {
  return { id: `evt-${index}`, ts: 1000 + index, type: "click", domain: "example.com", path: "/" };
}

describe("backoffDelay", () => {
  it("doubles per attempt and caps", () => {
    expect(backoffDelay(1, 2000, 60000)).toBe(2000);
    expect(backoffDelay(2, 2000, 60000)).toBe(4000);
    expect(backoffDelay(5, 2000, 60000)).toBe(32000);
    expect(backoffDelay(10, 2000, 60000)).toBe(60000);
  });
});

describe("createEventQueue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("flushes after the interval elapses", async () => {
    const send = vi.fn(async (events: readonly ExtensionEvent[]) => ({ accepted: events.length, dropped: 0 }));
    const queue = createEventQueue({ send, isPaired: () => true, onUnauthorized: vi.fn() });
    queue.enqueue(event(1));
    queue.enqueue(event(2));
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toHaveLength(2);
    expect(queue.size()).toBe(0);
    queue.dispose();
  });

  it("flushes immediately at 50 events", async () => {
    const send = vi.fn(async (events: readonly ExtensionEvent[]) => ({ accepted: events.length, dropped: 0 }));
    const queue = createEventQueue({ send, isPaired: () => true, onUnauthorized: vi.fn() });
    for (let index = 0; index < 50; index += 1) {
      queue.enqueue(event(index));
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toHaveLength(50);
    queue.dispose();
  });

  it("drops events while unpaired", async () => {
    const send = vi.fn();
    const onDropped = vi.fn();
    const queue = createEventQueue({ send, isPaired: () => false, onUnauthorized: vi.fn(), onDropped });
    queue.enqueue(event(1));
    await vi.advanceTimersByTimeAsync(5000);
    expect(send).not.toHaveBeenCalled();
    expect(onDropped).toHaveBeenCalledWith(1, "unpaired");
    expect(queue.size()).toBe(0);
    queue.dispose();
  });

  it("backs off exponentially on failure and recovers", async () => {
    let failures = 3;
    const send = vi.fn(async (events: readonly ExtensionEvent[]) => {
      if (failures > 0) {
        failures -= 1;
        throw new LoopbackError("network", "down");
      }
      return { accepted: events.length, dropped: 0 };
    });
    const onFailure = vi.fn();
    const queue = createEventQueue({ send, isPaired: () => true, onUnauthorized: vi.fn(), onFailure });
    queue.enqueue(event(1));
    await vi.advanceTimersByTimeAsync(2000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(queue.size()).toBe(1);
    await vi.advanceTimersByTimeAsync(1999);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3999);
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(8000);
    expect(send).toHaveBeenCalledTimes(4);
    expect(queue.size()).toBe(0);
    expect(queue.failures()).toBe(0);
    expect(onFailure).toHaveBeenCalledTimes(3);
    queue.dispose();
  });

  it("honors Retry-After from a 429 when it exceeds the backoff", async () => {
    let first = true;
    const send = vi.fn(async (events: readonly ExtensionEvent[]) => {
      if (first) {
        first = false;
        throw new LoopbackError("rate_limited", "slow", { status: 429, retryAfterMs: 10000 });
      }
      return { accepted: events.length, dropped: 0 };
    });
    const queue = createEventQueue({ send, isPaired: () => true, onUnauthorized: vi.fn() });
    queue.enqueue(event(1));
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(9999);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(2);
    queue.dispose();
  });

  it("never retries a 401: clears the queue and the pairing", async () => {
    const send = vi.fn(async () => {
      throw new LoopbackError("unauthorized", "bad token", { status: 401 });
    });
    const onUnauthorized = vi.fn();
    const queue = createEventQueue({ send, isPaired: () => true, onUnauthorized });
    queue.enqueue(event(1));
    queue.enqueue(event(2));
    await vi.advanceTimersByTimeAsync(2000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(queue.size()).toBe(0);
    await vi.advanceTimersByTimeAsync(120000);
    expect(send).toHaveBeenCalledTimes(1);
    queue.dispose();
  });

  it("caps pending events by dropping the oldest", async () => {
    const send = vi.fn(async () => {
      throw new LoopbackError("network", "down");
    });
    const onDropped = vi.fn();
    const queue = createEventQueue({ send, isPaired: () => true, onUnauthorized: vi.fn(), onDropped, maxPending: 3 });
    for (let index = 0; index < 5; index += 1) {
      queue.enqueue(event(index));
    }
    expect(queue.size()).toBe(3);
    expect(onDropped).toHaveBeenCalledWith(1, "overflow");
    queue.dispose();
  });
});
