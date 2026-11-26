import { describe, expect, it } from 'vitest';
import { buildReport, previousMonth, type ReportMonitorInput } from '../../src/shared/report.js';

// The monthly report (D-019, D-041): uptime per monitor (D-030), top 3 causes by downtime,
// the slowest monitor by mean latency. Months are UTC calendar months.

const at = (iso: string) => new Date(iso);
const NOW = at('2026-12-01T00:30:00.000Z');
const HOUR = 3_600_000;

const monitor = (over: Partial<ReportMonitorInput> = {}): ReportMonitorInput => ({
  name: 'Bookings API',
  url: 'https://api.bookings.example/health',
  historyStart: at('2026-10-01T00:00:00.000Z'),
  incidents: [],
  maintenance: [],
  latency: { meanMs: 200, checks: 8640 },
  ...over,
});

const report = (monitors: ReportMonitorInput[]) =>
  buildReport({ organization: 'Campus projects', year: 2026, month: 11, monitors }, NOW);

describe('previousMonth', () => {
  it.each([
    ['2026-12-01T00:00:00.000Z', { year: 2026, month: 11 }],
    ['2026-11-30T23:59:59.999Z', { year: 2026, month: 10 }],
    ['2027-01-01T00:00:00.000Z', { year: 2026, month: 12 }],
    ['2026-03-15T12:00:00.000Z', { year: 2026, month: 2 }],
  ])('at %s is %j', (now, expected) => {
    expect(previousMonth(at(now))).toEqual(expected);
  });
});

describe('buildReport (D-019, D-041)', () => {
  it('names the organization and the UTC month', () => {
    const r = report([]);

    expect(r.organization).toBe('Campus projects');
    expect(r.month).toBe('2026-11');
    expect(r.title).toBe('November 2026');
    expect(r.from).toEqual(at('2026-11-01T00:00:00.000Z'));
    expect(r.to).toEqual(at('2026-12-01T00:00:00.000Z'));
    expect(r.generatedAt).toEqual(NOW);
  });

  it('uptime per monitor over the calendar month, with an incident that crosses into it (D-030)', () => {
    // 3 h down on 1 Nov (the incident started on 31 Oct), 30 days in November.
    const r = report([monitor({
      incidents: [{ startedAt: at('2026-10-31T22:00:00.000Z'), resolvedAt: at('2026-11-01T03:00:00.000Z'), cause: 'timeout' }],
    })]);

    expect(r.monitors).toEqual([{
      name: 'Bookings API',
      url: 'https://api.bookings.example/health',
      uptime: '99.58%', // (720 − 3) / 720 = 99.583…, truncated
      incidents: 1,
      downtime: '3 h',
      meanLatency: '200 ms',
    }]);
  });

  it('leaves maintenance out of the uptime and out of the downtime', () => {
    const r = report([monitor({
      incidents: [{ startedAt: at('2026-11-10T10:00:00.000Z'), resolvedAt: at('2026-11-10T12:00:00.000Z'), cause: 'http_5xx' }],
      maintenance: [{ startsAt: at('2026-11-10T11:00:00.000Z'), endsAt: at('2026-11-10T13:00:00.000Z') }],
    })]);

    // 1 h down outside maintenance, out of 720 − 2 h.
    expect(r.monitors[0]).toMatchObject({ uptime: '99.86%', downtime: '1 h' });
    expect(r.topCauses).toEqual([{ cause: 'Server errors (5xx)', downtime: '1 h', incidents: 1 }]);
  });

  it('a monitor created in the middle of the month is measured from its history start', () => {
    const r = report([monitor({
      historyStart: at('2026-11-16T00:00:00.000Z'),
      incidents: [{ startedAt: at('2026-11-20T00:00:00.000Z'), resolvedAt: at('2026-11-20T03:36:00.000Z'), cause: 'dns' }],
    })]);

    // 3.6 h of 15 days = 1 %.
    expect(r.monitors[0].uptime).toBe('99.00%');
  });

  it('a monitor without history in the month shows "—"', () => {
    const r = report([monitor({ historyStart: null, latency: null })]);

    expect(r.monitors[0]).toMatchObject({ uptime: '—', incidents: 0, downtime: '—', meanLatency: '—' });
  });

  it('top causes: at most 3, by downtime in the month across all monitors, with the number of incidents', () => {
    const inc = (cause: string, start: string, hours: number) =>
      ({ startedAt: at(start), resolvedAt: new Date(at(start).getTime() + hours * HOUR), cause });
    const r = report([
      monitor({ incidents: [inc('timeout', '2026-11-02T00:00:00.000Z', 1), inc('dns', '2026-11-03T00:00:00.000Z', 5)] }),
      monitor({
        name: 'Library',
        incidents: [inc('timeout', '2026-11-04T00:00:00.000Z', 1), inc('timeout', '2026-11-05T00:00:00.000Z', 1),
          inc('tls', '2026-11-06T00:00:00.000Z', 2), inc('connection', '2026-11-07T00:00:00.000Z', 0.5)],
      }),
    ]);

    expect(r.topCauses).toEqual([
      { cause: 'DNS failure', downtime: '5 h', incidents: 1 },
      { cause: 'Timeout', downtime: '3 h', incidents: 3 },
      { cause: 'TLS certificate problem', downtime: '2 h', incidents: 1 },
    ]);
  });

  it('equal downtime: more incidents first, then the cause name', () => {
    const inc = (cause: string, start: string, hours: number) =>
      ({ startedAt: at(start), resolvedAt: new Date(at(start).getTime() + hours * HOUR), cause });
    const r = report([monitor({
      incidents: [
        inc('unknown', '2026-11-02T00:00:00.000Z', 2),
        inc('tls', '2026-11-03T00:00:00.000Z', 2),
        inc('timeout', '2026-11-04T00:00:00.000Z', 1), inc('timeout', '2026-11-05T00:00:00.000Z', 1),
      ],
    })]);

    expect(r.topCauses.map((c) => c.cause)).toEqual(['Timeout', 'TLS certificate problem', 'Unknown']);
  });

  it('an incident still open at the end of the month counts until the month ends', () => {
    const r = report([monitor({
      incidents: [{ startedAt: at('2026-11-30T22:00:00.000Z'), resolvedAt: null, cause: 'keyword_missing' }],
    })]);

    expect(r.topCauses).toEqual([{ cause: 'Expected text missing', downtime: '2 h', incidents: 1 }]);
  });

  it('a month without incidents has no top causes', () => {
    expect(report([monitor()]).topCauses).toEqual([]);
  });

  it('the slowest monitor has the highest mean latency; monitors without checks are skipped', () => {
    const r = report([
      monitor({ name: 'Fast', latency: { meanMs: 120.4, checks: 100 } }),
      monitor({ name: 'Slow', latency: { meanMs: 1834.6, checks: 100 } }),
      monitor({ name: 'Unchecked', latency: null }),
    ]);

    expect(r.slowest).toEqual({ name: 'Slow', meanLatency: '1835 ms' });
  });

  it('no checks with a response: no slowest monitor', () => {
    expect(report([monitor({ latency: null })]).slowest).toBeNull();
    expect(report([]).slowest).toBeNull();
  });

  it('keeps the names as given, diacritics included', () => {
    const r = buildReport({ organization: 'Școala Țară', year: 2026, month: 11, monitors: [monitor({ name: 'Bibliotecă' })] }, NOW);

    expect(r.organization).toBe('Școala Țară');
    expect(r.monitors[0].name).toBe('Bibliotecă');
  });
});
