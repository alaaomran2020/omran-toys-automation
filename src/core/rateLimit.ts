/**
 * In-memory sliding-window rate limiter (per key).
 *
 * Single-process service → in-memory is sufficient (no Redis needed).
 * Protects: webhook (spam), AI calls (cost/loops), publish (loops).
 */
export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** Returns true when the action is allowed, false when rate-limited. */
  allow(key: string, limit: number, windowMs: number): boolean {
    const t = this.now();
    const windowStart = t - windowMs;
    const recent = (this.hits.get(key) ?? []).filter((x) => x > windowStart);
    if (recent.length >= limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(t);
    this.hits.set(key, recent);
    return true;
  }

  /** Test helper. */
  clear(key?: string): void {
    if (key === undefined) this.hits.clear();
    else this.hits.delete(key);
  }
}
