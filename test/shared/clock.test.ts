import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../src/shared/clock.js';

const START = new Date('2026-10-31T23:00:00.000Z');

describe('FakeClock', () => {
  it('returns the start time until advanced', () => {
    const clock = new FakeClock(START);

    expect(clock.now().toISOString()).toBe('2026-10-31T23:00:00.000Z');
  });

  it('advances by exactly the given milliseconds, cumulatively', () => {
    const clock = new FakeClock(START);

    clock.advance(60 * 60 * 1000);
    clock.advance(2 * 60 * 60 * 1000 + 500);

    expect(clock.now().toISOString()).toBe('2026-11-01T02:00:00.500Z');
  });

  it('returns a copy, so mutating the result does not move the clock', () => {
    const clock = new FakeClock(START);

    clock.now().setTime(0);

    expect(clock.now().toISOString()).toBe('2026-10-31T23:00:00.000Z');
  });

  it('is not affected by its start Date being mutated later', () => {
    const start = new Date(START);
    const clock = new FakeClock(start);

    start.setTime(0);

    expect(clock.now().toISOString()).toBe('2026-10-31T23:00:00.000Z');
  });
});
