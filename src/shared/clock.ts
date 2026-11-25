/** Source of the current time. Inject it instead of calling `Date.now()` or `new Date()`. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

/** Simulated clock for tests: time moves only when `advance` is called. */
export class FakeClock implements Clock {
  private currentMs: number;

  constructor(start: Date) {
    this.currentMs = start.getTime();
  }

  now(): Date {
    return new Date(this.currentMs);
  }

  advance(ms: number): void {
    this.currentMs += ms;
  }
}
