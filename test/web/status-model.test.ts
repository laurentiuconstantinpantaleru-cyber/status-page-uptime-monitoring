import { describe, expect, it } from 'vitest';
import { quickWindow } from '../../src/shared/maintenance.js';
import { days, monitorStatus, nextChange, worstOf, type MonitorData } from '../../src/web/status/model.js';

const NOW = new Date('2026-11-26T14:55:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function monitor(overrides: Partial<MonitorData> = {}): MonitorData {
  return {
    name: 'Corner bakery website',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    latencyThresholdMs: null,
    firstCheckAt: new Date('2026-11-25T10:00:00.000Z'),
    lastCheck: { checkedAt: new Date('2026-11-26T14:50:00.000Z'), latencyMs: 120 },
    incidents: [],
    maintenance: [],
    ...overrides,
  };
}

describe('monitorStatus', () => {
  it('is no data when the monitor has no checks yet', () => {
    expect(monitorStatus(monitor({ firstCheckAt: null, lastCheck: null }), NOW)).toBe('nodata');
  });

  it('is operational when the last check passed', () => {
    expect(monitorStatus(monitor(), NOW)).toBe('ok');
  });

  it('stays operational when the last check failed without an open incident (not confirmed yet, D-006)', () => {
    expect(monitorStatus(monitor({ lastCheck: { checkedAt: NOW, latencyMs: null } }), NOW)).toBe('ok');
  });

  it('is down while an incident is open', () => {
    const m = monitor({ incidents: [{ startedAt: new Date('2026-11-26T14:02:00.000Z'), resolvedAt: null }] });
    expect(monitorStatus(m, NOW)).toBe('outage');
  });

  it('is not down for a resolved incident', () => {
    const m = monitor({ incidents: [{ startedAt: new Date(NOW.getTime() - 2 * HOUR), resolvedAt: new Date(NOW.getTime() - HOUR) }] });
    expect(monitorStatus(m, NOW)).toBe('ok');
  });

  it('is in maintenance inside a window, and not after it ends', () => {
    const window = { startsAt: new Date('2026-11-26T14:30:00.000Z'), endsAt: new Date('2026-11-26T16:00:00.000Z') };
    expect(monitorStatus(monitor({ maintenance: [window] }), NOW)).toBe('maint');
    expect(monitorStatus(monitor({ maintenance: [window] }), new Date('2026-11-26T16:00:00.000Z'))).toBe('ok');
  });

  it('is degraded when the last check is slower than the threshold', () => {
    expect(monitorStatus(monitor({ latencyThresholdMs: 100 }), NOW)).toBe('degraded');
    expect(monitorStatus(monitor({ latencyThresholdMs: 120 }), NOW)).toBe('ok');
  });

  it('is never degraded without a threshold (Q-010)', () => {
    expect(monitorStatus(monitor({ lastCheck: { checkedAt: NOW, latencyMs: 9000 } }), NOW)).toBe('ok');
  });

  it('puts an open incident above maintenance', () => {
    const m = monitor({
      incidents: [{ startedAt: new Date(NOW.getTime() - HOUR), resolvedAt: null }],
      maintenance: [{ startsAt: new Date(NOW.getTime() - HOUR), endsAt: new Date(NOW.getTime() + HOUR) }],
    });
    expect(monitorStatus(m, NOW)).toBe('outage');
  });
});

describe('worstOf', () => {
  it('orders down, degraded, maintenance, operational (Q-015)', () => {
    expect(worstOf(['ok', 'maint', 'degraded', 'outage'])).toBe('outage');
    expect(worstOf(['ok', 'maint', 'degraded'])).toBe('degraded');
    expect(worstOf(['ok', 'maint'])).toBe('maint');
    expect(worstOf(['ok'])).toBe('ok');
  });

  it('counts no data only when nothing else has data', () => {
    expect(worstOf(['nodata', 'ok'])).toBe('ok');
    expect(worstOf(['nodata'])).toBe('nodata');
    expect(worstOf([])).toBe('nodata');
  });
});

describe('days', () => {
  it('returns 90 UTC days, oldest first, ending today', () => {
    const result = days(monitor(), NOW);

    expect(result).toHaveLength(90);
    expect(result[89].date.toISOString()).toBe('2026-11-26T00:00:00.000Z');
    expect(result[0].date.toISOString()).toBe('2026-08-29T00:00:00.000Z');
  });

  it('is all no data for a monitor without checks', () => {
    const result = days(monitor({ firstCheckAt: null, lastCheck: null }), NOW);

    expect(new Set(result.map((d) => d.status))).toEqual(new Set(['nodata']));
    expect(result[89].detail).toBe('No checks yet');
  });

  it('shows no data before the first check and operational from its day on', () => {
    const result = days(monitor(), NOW);

    expect(result[87]).toMatchObject({ status: 'nodata', detail: 'No checks this day' });
    expect(result[88]).toMatchObject({ status: 'ok', detail: 'No incidents' });
    expect(result[89].status).toBe('ok');
  });

  it('uses the creation date once raw checks older than the retention are gone (D-011)', () => {
    const m = monitor({ createdAt: new Date('2026-10-01T09:00:00.000Z'), firstCheckAt: new Date(NOW.getTime() - 7 * DAY + HOUR) });
    const result = days(m, NOW);
    const firstWithData = result.findIndex((d) => d.status !== 'nodata');

    expect(result[firstWithData].date.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('marks a day with an incident as down, with its duration that day', () => {
    const m = monitor({
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      firstCheckAt: new Date(NOW.getTime() - 7 * DAY + HOUR),
      incidents: [{ startedAt: new Date('2026-11-18T11:08:00.000Z'), resolvedAt: new Date('2026-11-18T11:46:00.000Z') }],
    });
    const result = days(m, NOW);

    expect(result[81]).toMatchObject({ status: 'outage', detail: 'Down for 38 min' });
  });

  it('splits an incident across midnight between the two days', () => {
    const m = monitor({
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      firstCheckAt: new Date(NOW.getTime() - 7 * DAY + HOUR),
      incidents: [{ startedAt: new Date('2026-11-20T23:00:00.000Z'), resolvedAt: new Date('2026-11-21T02:00:00.000Z') }],
    });
    const result = days(m, NOW);

    expect(result[83].detail).toBe('Down for 1 h');
    expect(result[84].detail).toBe('Down for 2 h');
  });

  it('says since when an incident still open today began', () => {
    const m = monitor({ incidents: [{ startedAt: new Date('2026-11-26T14:02:00.000Z'), resolvedAt: null }] });

    expect(days(m, NOW)[89]).toMatchObject({ status: 'outage', detail: 'Down since 14:02 UTC' });
  });

  it('marks a maintenance day, and a down day wins over it', () => {
    const m = monitor({
      maintenance: [{ startsAt: new Date('2026-11-25T12:00:00.000Z'), endsAt: new Date('2026-11-25T13:00:00.000Z') },
        { startsAt: new Date('2026-11-26T09:00:00.000Z'), endsAt: new Date('2026-11-26T10:00:00.000Z') }],
      incidents: [{ startedAt: new Date('2026-11-26T12:00:00.000Z'), resolvedAt: new Date('2026-11-26T12:10:00.000Z') }],
    });
    const result = days(m, NOW);

    expect(result[88]).toMatchObject({ status: 'maint', detail: 'Maintenance for 1 h' });
    expect(result[89]).toMatchObject({ status: 'outage', detail: 'Down for 10 min' });
  });
});

describe('nextChange', () => {
  it('is the next UTC midnight when nothing is scheduled sooner', () => {
    expect(nextChange({ groups: [{ name: 'A', monitors: [monitor()] }] }, NOW).toISOString()).toBe('2026-11-27T00:00:00.000Z');
  });

  it('is the next maintenance start or end before midnight', () => {
    const m = monitor({ maintenance: [{ startsAt: new Date('2026-11-26T15:30:00.000Z'), endsAt: new Date('2026-11-26T16:00:00.000Z') }] });

    expect(nextChange({ groups: [{ name: 'A', monitors: [m] }] }, NOW).toISOString()).toBe('2026-11-26T15:30:00.000Z');
  });
});

describe('quick maintenance (D-012)', () => {
  it('shows maintenance until the window expires, then operational, and re-renders when it expires', () => {
    const m = monitor({ maintenance: [quickWindow(NOW, 15, [])] });
    const expires = new Date(NOW.getTime() + 15 * 60_000);

    expect(monitorStatus(m, NOW)).toBe('maint');
    expect(monitorStatus(m, new Date(expires.getTime() - 1000))).toBe('maint');
    expect(monitorStatus(m, expires)).toBe('ok');
    expect(nextChange({ groups: [{ name: 'A', monitors: [m] }] }, NOW)).toEqual(expires);
  });
});
