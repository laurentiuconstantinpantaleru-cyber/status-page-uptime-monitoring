import type { Clock } from '../../shared/clock.js';

// Requests per key in a sliding window, in this process's memory (D-025, D-039).
// A refused request is not recorded, so retrying does not push the wait further out.

export type Take = { ok: true } | { ok: false; retryAfterS: number };

export class RateLimiter {
  /** Per key, the times of the requests still inside the window, oldest first. */
  private readonly times = new Map<string, number[]>();

  constructor(
    private readonly clock: Clock,
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  take(key: string): Take {
    const now = this.clock.now().getTime();
    const times = (this.times.get(key) ?? []).filter((t) => t > now - this.windowMs);
    if (times.length >= this.limit) {
      this.times.set(key, times);
      return { ok: false, retryAfterS: Math.ceil((times[0] + this.windowMs - now) / 1000) };
    }
    times.push(now);
    this.times.set(key, times);
    return { ok: true };
  }
}
