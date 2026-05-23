import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TokenBucket } from './rate-limiter';

describe('TokenBucket', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects invalid options', () => {
    expect(() => new TokenBucket({ capacity: 0, refillPerSecond: 1 })).toThrow();
    expect(() => new TokenBucket({ capacity: 1, refillPerSecond: 0 })).toThrow();
  });

  it('starts at full capacity', () => {
    const b = new TokenBucket({ capacity: 5, refillPerSecond: 1 });
    expect(b.available()).toBe(5);
  });

  it('allows up to capacity without waiting', async () => {
    const b = new TokenBucket({ capacity: 5, refillPerSecond: 1 });
    for (let i = 0; i < 5; i++) await b.acquire();
    expect(Math.floor(b.available())).toBe(0);
  });

  it('queues when exhausted and releases as tokens refill', async () => {
    const b = new TokenBucket({ capacity: 2, refillPerSecond: 1 });
    await b.acquire();
    await b.acquire();

    let resolved = false;
    const next = b.acquire().then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(500);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(600);
    await next;
    expect(resolved).toBe(true);
  });

  it('preserves FIFO order across waiters', async () => {
    const b = new TokenBucket({ capacity: 1, refillPerSecond: 1 });
    await b.acquire(); // drain

    const order: number[] = [];
    const p1 = b.acquire().then(() => order.push(1));
    const p2 = b.acquire().then(() => order.push(2));
    const p3 = b.acquire().then(() => order.push(3));

    await vi.advanceTimersByTimeAsync(3500);
    await Promise.all([p1, p2, p3]);

    expect(order).toEqual([1, 2, 3]);
  });

  it('serializes a burst of 100 against a 35-per-minute limit', async () => {
    const b = new TokenBucket({ capacity: 35, refillPerSecond: 35 / 60 });

    let completed = 0;
    const promises = Array.from({ length: 100 }, () =>
      b.acquire().then(() => {
        completed += 1;
      }),
    );

    // Initial burst clears 35 immediately (subject to microtask flush).
    await vi.advanceTimersByTimeAsync(0);
    expect(completed).toBe(35);
    expect(b.queued()).toBe(65);

    // 60s refill → ~35 more tokens dispensed → ~70 done.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(completed).toBeGreaterThanOrEqual(69);
    expect(completed).toBeLessThanOrEqual(71);

    // Another 60s → enough for the remaining 30+ waiters.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(completed).toBe(100);
    expect(b.queued()).toBe(0);

    await Promise.all(promises);
  });

  it('does not refill above capacity during idle periods', async () => {
    const b = new TokenBucket({ capacity: 5, refillPerSecond: 1 });
    // Long idle period — accumulated tokens must still cap at capacity.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(b.available()).toBe(5);
  });

  it('refills partial tokens proportionally', async () => {
    const b = new TokenBucket({ capacity: 10, refillPerSecond: 10 });
    // Drain.
    for (let i = 0; i < 10; i++) await b.acquire();
    expect(Math.floor(b.available())).toBe(0);

    // 500ms at 10/sec → 5 tokens back.
    await vi.advanceTimersByTimeAsync(500);
    expect(Math.round(b.available())).toBe(5);
  });
});
