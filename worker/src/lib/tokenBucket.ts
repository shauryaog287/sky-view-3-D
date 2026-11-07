/**
 * Classic token bucket. `capacity` tokens max, refilled continuously at `refillPerSec`.
 * Each upstream provider gets one, shared by every user (the FlightHub Durable Object is a singleton).
 */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    readonly capacity: number,
    readonly refillPerSec: number,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = capacity;
    this.last = now();
  }

  private refill() {
    const t = this.now();
    const dt = Math.max(0, t - this.last) / 1000;
    this.last = t;
    this.tokens = Math.min(this.capacity, this.tokens + dt * this.refillPerSec);
  }

  get available(): number {
    this.refill();
    return this.tokens;
  }

  tryTake(cost = 1): boolean {
    this.refill();
    if (this.tokens + 1e-9 >= cost) {
      this.tokens -= cost;
      return true;
    }
    return false;
  }

  /** Milliseconds until `cost` tokens will be available (0 if available now; Infinity if never). */
  msUntil(cost = 1): number {
    this.refill();
    if (this.tokens >= cost) return 0;
    if (this.refillPerSec <= 0 || cost > this.capacity) return Infinity;
    return Math.ceil(((cost - this.tokens) / this.refillPerSec) * 1000);
  }
}
