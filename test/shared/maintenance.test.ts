import { describe, expect, it } from 'vitest';
import { occurrences, quickWindow, type MaintenanceSchedule } from '../../src/shared/maintenance.js';

const MIN = 60_000;
const at = (iso: string) => new Date(`${iso}Z`);
const iso = (spans: { startsAt: Date; endsAt: Date }[]) =>
  spans.map((s) => [s.startsAt.toISOString(), s.endsAt.toISOString()]);
/** Whether the schedule holds maintenance at `t`. */
const inForce = (schedule: MaintenanceSchedule, t: Date) =>
  occurrences(schedule, t, new Date(t.getTime() + 1)).length > 0;

/** Every day 23:30–00:30 UTC, from 2026-11-20. */
const NIGHTLY: MaintenanceSchedule = {
  frequency: 'daily',
  weekdays: [],
  startMinute: 23 * 60 + 30,
  durationMinutes: 60,
  startsOn: at('2026-11-20T00:00:00'),
  endedAt: null,
};

/** Sundays and Thursdays 23:00–01:00 UTC. 2026-11-29 is a Sunday, 2026-11-26 a Thursday. */
const WEEKLY: MaintenanceSchedule = {
  frequency: 'weekly',
  weekdays: [0, 4],
  startMinute: 23 * 60,
  durationMinutes: 120,
  startsOn: at('2026-11-01T00:00:00'),
  endedAt: null,
};

describe('occurrences', () => {
  it('keeps a daily window that crosses midnight going into the next day', () => {
    expect(inForce(NIGHTLY, at('2026-11-26T23:29:59'))).toBe(false);
    expect(inForce(NIGHTLY, at('2026-11-26T23:30:00'))).toBe(true);
    expect(inForce(NIGHTLY, at('2026-11-27T00:15:00'))).toBe(true);
    expect(inForce(NIGHTLY, at('2026-11-27T00:30:00'))).toBe(false);
  });

  it("includes the previous day's window when the period starts at midnight", () => {
    expect(iso(occurrences(NIGHTLY, at('2026-11-27T00:00:00'), at('2026-11-28T00:00:00')))).toEqual([
      ['2026-11-26T23:30:00.000Z', '2026-11-27T00:30:00.000Z'],
      ['2026-11-27T23:30:00.000Z', '2026-11-28T00:30:00.000Z'],
    ]);
  });

  it('repeats a weekly window on each chosen UTC weekday, across midnight', () => {
    expect(iso(occurrences(WEEKLY, at('2026-11-26T00:00:00'), at('2026-12-01T00:00:00')))).toEqual([
      ['2026-11-26T23:00:00.000Z', '2026-11-27T01:00:00.000Z'],
      ['2026-11-29T23:00:00.000Z', '2026-11-30T01:00:00.000Z'],
    ]);
    expect(inForce(WEEKLY, at('2026-11-30T00:30:00'))).toBe(true);
    expect(inForce(WEEKLY, at('2026-11-30T01:00:00'))).toBe(false);
    expect(inForce(WEEKLY, at('2026-11-28T23:30:00'))).toBe(false);
  });

  it('starts on its first day, never before', () => {
    const spans = occurrences(NIGHTLY, at('2026-11-18T00:00:00'), at('2026-11-21T12:00:00'));

    expect(iso(spans)).toEqual([
      ['2026-11-20T23:30:00.000Z', '2026-11-21T00:30:00.000Z'],
    ]);
  });

  it('stops when the schedule ends, cutting a window in progress, and keeps the windows before', () => {
    const ended = { ...NIGHTLY, endedAt: at('2026-11-26T23:45:00') };

    expect(iso(occurrences(ended, at('2026-11-25T01:00:00'), at('2026-11-29T00:00:00')))).toEqual([
      ['2026-11-25T23:30:00.000Z', '2026-11-26T00:30:00.000Z'],
      ['2026-11-26T23:30:00.000Z', '2026-11-26T23:45:00.000Z'],
    ]);
  });
});

describe('quickWindow', () => {
  const NOW = at('2026-11-26T14:00:00');
  const plus = (minutes: number) => new Date(NOW.getTime() + minutes * MIN);

  it('runs from now for 15, 30 or 60 minutes', () => {
    for (const minutes of [15, 30, 60]) {
      expect(quickWindow(NOW, minutes, [])).toEqual({ startsAt: NOW, endsAt: plus(minutes) });
    }
  });

  it('refuses any other length', () => {
    expect(() => quickWindow(NOW, 20, [])).toThrow(/15, 30 or 60/);
    expect(() => quickWindow(NOW, 0, [])).toThrow(/15, 30 or 60/);
  });

  it('extends the maintenance already in force by the chosen length', () => {
    const quick = { startsAt: plus(-5), endsAt: plus(10) };

    expect(quickWindow(NOW, 30, [quick])).toEqual({ startsAt: NOW, endsAt: plus(40) });
  });

  it('extends past windows that follow on without a gap, and ignores later or ended ones', () => {
    const windows = [
      { startsAt: plus(-5), endsAt: plus(10) },
      { startsAt: plus(10), endsAt: plus(20) },
      { startsAt: plus(30), endsAt: plus(90) },
      { startsAt: plus(-60), endsAt: plus(-30) },
    ];

    expect(quickWindow(NOW, 15, windows)).toEqual({ startsAt: NOW, endsAt: plus(35) });
  });

  it('starts from now when a window only begins later', () => {
    expect(quickWindow(NOW, 15, [{ startsAt: plus(5), endsAt: plus(60) }])).toEqual({ startsAt: NOW, endsAt: plus(15) });
  });
});
