/**
 * Token bucket rate limiter.
 *
 * One bucket = one Interakt account. Capacity sets the burst limit; tokens
 * refill continuously at `refillPerSecond`. `acquire()` resolves when a token
 * is available — FIFO across concurrent callers so order is preserved.
 *
 * Uses `Date.now()` and `setTimeout` so vitest's fake timers can drive it
 * deterministically.
 */

export interface TokenBucketOptions {
  /** Maximum tokens available at once. */
  capacity: number;
  /** Continuous refill rate. */
  refillPerSecond: number;
}

export class TokenBucket {
  private tokens: number;
  private lastRefillMs: number;
  private waiters: Array<() => void> = [];
  private refillTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly opts: TokenBucketOptions) {
    if (opts.capacity <= 0) throw new Error('capacity must be > 0');
    if (opts.refillPerSecond <= 0) throw new Error('refillPerSecond must be > 0');
    this.tokens = opts.capacity;
    this.lastRefillMs = Date.now();
  }

  /**
   * Block until 1 token is available, then consume it.
   *
   * Waiters are released FIFO. Even if tokens > 1 right now, if there's a
   * queue ahead of us we line up behind it — otherwise a fresh caller could
   * leapfrog one that's been waiting.
   */
  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1 && this.waiters.length === 0) {
      this.tokens -= 1;
      return;
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
      this.ensureTimer();
    });
  }

  /** For tests / instrumentation. Returns current token count after refill. */
  available(): number {
    this.refill();
    return this.tokens;
  }

  /** For tests. Number of callers currently waiting. */
  queued(): number {
    return this.waiters.length;
  }

  private refill(): void {
    const now = Date.now();
    const elapsedMs = now - this.lastRefillMs;
    if (elapsedMs <= 0) return;
    const added = (elapsedMs / 1000) * this.opts.refillPerSecond;
    this.tokens = Math.min(this.opts.capacity, this.tokens + added);
    this.lastRefillMs = now;
  }

  private ensureTimer(): void {
    if (this.refillTimer || this.waiters.length === 0) return;
    const tokensNeeded = 1 - this.tokens;
    // Math.ceil so we don't fire before there's a full token. Min 1ms so
    // setTimeout doesn't reject 0.
    const waitMs = Math.max(1, Math.ceil((tokensNeeded / this.opts.refillPerSecond) * 1000));
    this.refillTimer = setTimeout(() => {
      this.refillTimer = null;
      this.tick();
    }, waitMs);
  }

  private tick(): void {
    this.refill();
    while (this.tokens >= 1 && this.waiters.length > 0) {
      this.tokens -= 1;
      const next = this.waiters.shift()!;
      next();
    }
    this.ensureTimer();
  }
}
