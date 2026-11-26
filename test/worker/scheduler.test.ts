import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../src/shared/clock.js';
import { Scheduler, slotOffsetMs } from '../../src/worker/scheduler.js';

const HOUR = new Date('2026-11-26T10:00:00.000Z');
const MINUTE_MS = 60_000;

/**
 * Drives the scheduler the way the worker loop does: wake at the next slot, start what is due,
 * finish each check `durationMs` later. Returns the start times per monitor.
 */
function simulate(
  scheduler: Scheduler,
  clock: FakeClock,
  untilMs: number,
  durationMs = 0,
): Map<number, number[]> {
  const starts = new Map<number, number[]>();
  const running: { id: number; endsAt: number }[] = [];
  for (;;) {
    const nextWake = scheduler.nextWakeAt()?.getTime() ?? Infinity;
    const nextEnd = Math.min(...running.map((r) => r.endsAt), Infinity);
    const at = Math.min(nextWake, nextEnd);
    if (at >= untilMs) return starts;
    clock.advance(Math.max(0, at - clock.now().getTime()));
    for (const r of running.filter((r) => r.endsAt <= at)) {
      scheduler.finished(r.id);
      running.splice(running.indexOf(r), 1);
    }
    for (const id of scheduler.due()) {
      starts.set(id, [...(starts.get(id) ?? []), clock.now().getTime() - HOUR.getTime()]);
      if (durationMs === 0) scheduler.finished(id);
      else running.push({ id, endsAt: at + durationMs });
    }
  }
}

const END_OF_HOUR = HOUR.getTime() + 60 * MINUTE_MS;

describe('Scheduler', () => {
  it('runs a 1-minute monitor exactly 60 times in an hour', () => {
    const clock = new FakeClock(HOUR);
    const scheduler = new Scheduler(clock);
    scheduler.setMonitors([{ id: 60, intervalMinutes: 1 }]);

    const starts = simulate(scheduler, clock, END_OF_HOUR);

    expect(starts.get(60)).toHaveLength(60);
  });

  it('keeps every start on the grid when checks take 40 seconds', () => {
    const clock = new FakeClock(HOUR);
    const scheduler = new Scheduler(clock);
    scheduler.setMonitors([{ id: 60, intervalMinutes: 1 }]);

    const starts = simulate(scheduler, clock, END_OF_HOUR, 40_000);

    expect(starts.get(60)).toEqual(Array.from({ length: 60 }, (_, k) => k * MINUTE_MS));
  });

  it('skips a slot while the previous check of the monitor still runs', () => {
    const clock = new FakeClock(HOUR);
    const scheduler = new Scheduler(clock);
    scheduler.setMonitors([{ id: 60, intervalMinutes: 1 }]);

    const starts = simulate(scheduler, clock, HOUR.getTime() + 6 * MINUTE_MS, 90_000);

    expect(starts.get(60)).toEqual([0, 2, 4].map((m) => m * MINUTE_MS));
  });

  it('runs once after a 10-minute pause instead of catching up every missed slot', () => {
    const clock = new FakeClock(HOUR);
    const scheduler = new Scheduler(clock);
    scheduler.setMonitors([{ id: 60, intervalMinutes: 1 }]);
    expect(scheduler.due()).toEqual([60]);
    scheduler.finished(60);

    clock.advance(10 * MINUTE_MS + 5_000);

    expect(scheduler.due()).toEqual([60]);
    scheduler.finished(60);
    expect(scheduler.due()).toEqual([]);
    expect(scheduler.nextWakeAt()?.getTime()).toBe(HOUR.getTime() + 11 * MINUTE_MS);
  });

  it('runs 300 1-minute monitors 60 times each in an hour, spread over the minute', () => {
    const clock = new FakeClock(HOUR);
    const scheduler = new Scheduler(clock);
    const ids = Array.from({ length: 300 }, (_, i) => i + 1);
    scheduler.setMonitors(ids.map((id) => ({ id, intervalMinutes: 1 })));

    const starts = simulate(scheduler, clock, END_OF_HOUR, 30_000);

    expect(ids.every((id) => starts.get(id)?.length === 60)).toBe(true);
    const secondsOfFirstStart = new Set(ids.map((id) => starts.get(id)![0]));
    expect(secondsOfFirstStart.size).toBe(60);
  });

  it('places a monitor at (id x 1000 ms) mod interval', () => {
    expect(slotOffsetMs(7, 1)).toBe(7_000);
    expect(slotOffsetMs(61, 1)).toBe(1_000);
    expect(slotOffsetMs(301, 5)).toBe(1_000);
  });

  it('applies a changed interval from the next slot and drops a removed monitor', () => {
    const clock = new FakeClock(HOUR);
    const scheduler = new Scheduler(clock);
    scheduler.setMonitors([
      { id: 60, intervalMinutes: 1 },
      { id: 120, intervalMinutes: 1 },
    ]);
    expect(scheduler.due().sort()).toEqual([120, 60].sort());
    scheduler.finished(60);
    scheduler.finished(120);

    clock.advance(30_000);
    scheduler.setMonitors([{ id: 60, intervalMinutes: 5 }]);

    const starts = simulate(scheduler, clock, END_OF_HOUR);
    expect(starts.get(60)?.slice(0, 2)).toEqual([5 * MINUTE_MS, 10 * MINUTE_MS]);
    expect(starts.has(120)).toBe(false);
  });
});
