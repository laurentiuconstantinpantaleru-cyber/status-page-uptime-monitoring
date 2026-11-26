import { describe, expect, it } from 'vitest';
import { formatUptime, lastDays, uptime, utcMonth, type UptimeInput } from '../../src/shared/uptime.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (iso: string) => new Date(`${iso}Z`);
const NOVEMBER = utcMonth(2026, 11);
/** Well after November, so the whole month is measured. */
const LATER = at('2026-12-15T00:00:00');

function input(extra: Partial<UptimeInput>): UptimeInput {
  return {
    incidents: [],
    maintenance: [],
    ...NOVEMBER,
    now: LATER,
    historyStart: at('2026-01-01T00:00:00'),
    ...extra,
  };
}

/** The brief's example: an incident across the month boundary, maintenance over its first November hour. */
const CROSSING = {
  incidents: [{ startedAt: at('2026-10-31T23:00:00'), resolvedAt: at('2026-11-01T02:00:00') }],
  maintenance: [{ startsAt: at('2026-11-01T00:00:00'), endsAt: at('2026-11-01T01:00:00') }],
};

describe('uptime', () => {
  it('counts for November only the part of a crossing incident outside maintenance: (719 - 1) / 719', () => {
    const result = uptime(input(CROSSING));

    expect(result).toEqual({ measuredMs: 720 * HOUR, maintenanceMs: HOUR, downMs: HOUR, ratio: 718 / 719 });
    expect(formatUptime(result)).toBe('99.86%');
  });

  it('counts for October only the hour of the same incident inside October: 743 / 744', () => {
    const result = uptime(input({ ...CROSSING, ...utcMonth(2026, 10) }));

    expect(result).toEqual({ measuredMs: 744 * HOUR, maintenanceMs: 0, downMs: HOUR, ratio: 743 / 744 });
    expect(formatUptime(result)).toBe('99.86%');
  });

  it('subtracts only the part of an incident outside a maintenance window that covers its end', () => {
    const result = uptime(
      input({
        incidents: [{ startedAt: at('2026-11-10T10:00:00'), resolvedAt: at('2026-11-10T13:00:00') }],
        maintenance: [{ startsAt: at('2026-11-10T12:00:00'), endsAt: at('2026-11-10T14:00:00') }],
      }),
    );

    expect(result).toMatchObject({ maintenanceMs: 2 * HOUR, downMs: 2 * HOUR, ratio: (718 - 2) / 718 });
  });

  it('counts no downtime for an incident entirely inside maintenance', () => {
    const result = uptime(
      input({
        incidents: [{ startedAt: at('2026-11-10T10:15:00'), resolvedAt: at('2026-11-10T10:45:00') }],
        maintenance: [{ startsAt: at('2026-11-10T10:00:00'), endsAt: at('2026-11-10T11:00:00') }],
      }),
    );

    expect(result).toMatchObject({ downMs: 0, ratio: 1 });
    expect(formatUptime(result)).toBe('100.00%');
  });

  it('subtracts overlapping maintenance windows once', () => {
    const result = uptime(
      input({
        maintenance: [
          { startsAt: at('2026-11-05T10:00:00'), endsAt: at('2026-11-05T12:00:00') },
          { startsAt: at('2026-11-05T11:00:00'), endsAt: at('2026-11-05T13:00:00') },
        ],
        incidents: [{ startedAt: at('2026-11-05T09:00:00'), resolvedAt: at('2026-11-05T14:00:00') }],
      }),
    );

    expect(result).toMatchObject({ maintenanceMs: 3 * HOUR, downMs: 2 * HOUR, ratio: (717 - 2) / 717 });
  });

  it('counts an open incident until now and measures a month in progress only until now', () => {
    const now = at('2026-11-11T00:00:00');
    const result = uptime(
      input({ now, incidents: [{ startedAt: at('2026-11-10T18:00:00'), resolvedAt: null }] }),
    );

    expect(result).toEqual({ measuredMs: 10 * DAY, maintenanceMs: 0, downMs: 6 * HOUR, ratio: (240 - 6) / 240 });
  });

  it("measures from the monitor's history start", () => {
    const result = uptime(
      input({
        historyStart: at('2026-11-20T00:00:00'),
        incidents: [
          { startedAt: at('2026-11-05T00:00:00'), resolvedAt: at('2026-11-06T00:00:00') },
          { startedAt: at('2026-11-21T00:00:00'), resolvedAt: at('2026-11-21T01:00:00') },
        ],
      }),
    );

    expect(result).toEqual({ measuredMs: 11 * DAY, maintenanceMs: 0, downMs: HOUR, ratio: (264 - 1) / 264 });
  });

  it('has no value when maintenance takes the whole period, without history, or before the period', () => {
    expect(uptime(input({ maintenance: [{ startsAt: at('2026-10-30T00:00:00'), endsAt: at('2026-12-02T00:00:00') }] }))).toBeNull();
    expect(uptime(input({ historyStart: null }))).toBeNull();
    expect(uptime(input({ now: at('2026-10-20T00:00:00') }))).toBeNull();
    expect(uptime(input({ historyStart: at('2026-12-01T00:00:00') }))).toBeNull();
    expect(formatUptime(null)).toBe('—');
  });

  it('is 100 % without incidents and ignores an incident outside the period', () => {
    const result = uptime(
      input({ incidents: [{ startedAt: at('2026-10-20T00:00:00'), resolvedAt: at('2026-10-21T00:00:00') }] }),
    );

    expect(result).toMatchObject({ downMs: 0, ratio: 1 });
    expect(formatUptime(result)).toBe('100.00%');
  });

  it('truncates to 2 decimals and never shows 100.00 % with downtime', () => {
    // 720 h with 99.996 % available: 103.68 s down.
    const result = uptime(
      input({
        incidents: [{ startedAt: at('2026-11-10T00:00:00'), resolvedAt: new Date(at('2026-11-10T00:00:00').getTime() + 103_680) }],
      }),
    );

    expect(result?.ratio).toBeCloseTo(0.99996, 8);
    expect(formatUptime(result)).toBe('99.99%');
    expect(formatUptime({ measuredMs: 719, maintenanceMs: 0, downMs: 1, ratio: 718 / 719 })).toBe('99.86%');
  });

  it('counts over the last 30 days only the part of an incident across the month boundary inside them', () => {
    const now = at('2026-11-29T00:00:00');
    const result = uptime(
      input({
        ...lastDays(now, 30),
        now,
        historyStart: at('2026-01-01T00:00:00'),
        incidents: [{ startedAt: at('2026-10-30T00:00:00'), resolvedAt: at('2026-11-02T00:00:00') }],
      }),
    );

    expect(lastDays(now, 30)).toEqual({ from: at('2026-10-30T00:00:00'), to: now });
    expect(result).toEqual({ measuredMs: 30 * DAY, maintenanceMs: 0, downMs: 3 * DAY, ratio: 27 / 30 });
  });
});

describe('utcMonth', () => {
  it('spans a UTC calendar month, December into January', () => {
    expect(utcMonth(2026, 11)).toEqual({ from: at('2026-11-01T00:00:00'), to: at('2026-12-01T00:00:00') });
    expect(utcMonth(2026, 12)).toEqual({ from: at('2026-12-01T00:00:00'), to: at('2027-01-01T00:00:00') });
  });
});
