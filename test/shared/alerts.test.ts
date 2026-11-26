import { describe, expect, it } from 'vitest';
import { alertMessage, dueKinds, type AlertIncident } from '../../src/shared/alerts.js';

// Which alerts an incident is due and what they say (D-007, D-013, D-044). Pure: plain dates.

const at = (iso: string) => new Date(`${iso}Z`);
const MIN = 60_000;

const incident = (over: Partial<AlertIncident> = {}): AlertIncident => ({
  id: 20,
  organizationId: 1,
  organization: 'Campus projects',
  monitor: 'Bookings API',
  url: 'https://api.bookings.example/health',
  cause: 'timeout',
  httpStatus: null,
  startedAt: at('2026-12-01T10:02:00'),
  resolvedAt: null,
  acknowledgedAt: null,
  lastSuccessAt: at('2026-12-01T09:57:00'),
  openedSentAt: null,
  escalationMinutes: 15,
  ...over,
});

describe('dueKinds', () => {
  it('an open incident is due its opened alert', () => {
    expect(dueKinds(incident(), at('2026-12-01T10:12:00'))).toEqual(['opened']);
  });

  it('escalates 15 minutes after the opened alert went out, not after the incident started', () => {
    const i = incident({ openedSentAt: at('2026-12-01T10:12:30') });

    expect(dueKinds(i, new Date(at('2026-12-01T10:12:30').getTime() + 15 * MIN - 1))).toEqual(['opened']);
    expect(dueKinds(i, new Date(at('2026-12-01T10:12:30').getTime() + 15 * MIN))).toEqual(['opened', 'escalated']);
  });

  it('follows the organization\'s timeout (D-007: up to an hour)', () => {
    const i = incident({ openedSentAt: at('2026-12-01T10:12:00'), escalationMinutes: 60 });

    expect(dueKinds(i, at('2026-12-01T11:11:59'))).toEqual(['opened']);
    expect(dueKinds(i, at('2026-12-01T11:12:00'))).toEqual(['opened', 'escalated']);
  });

  it('an acknowledged incident is not escalated', () => {
    const i = incident({ openedSentAt: at('2026-12-01T10:12:00'), acknowledgedAt: at('2026-12-01T10:26:59') });

    expect(dueKinds(i, at('2026-12-01T11:00:00'))).toEqual(['opened']);
  });

  it('nothing escalates before an opened alert went out', () => {
    expect(dueKinds(incident(), at('2026-12-01T12:00:00'))).toEqual(['opened']);
  });

  it('a resolved incident is due its resolved alert only', () => {
    expect(dueKinds(incident({ resolvedAt: at('2026-12-01T11:07:00'), openedSentAt: at('2026-12-01T10:12:00') }), at('2026-12-01T11:08:00')))
      .toEqual(['resolved']);
  });
});

describe('alertMessage (D-013)', () => {
  const NOW = at('2026-12-01T10:12:00');

  it('opened: the monitor, its URL, the error, the cause, the time since the last success and the acknowledge link', () => {
    const m = alertMessage('opened', incident(), NOW, 'https://status.example/ack/abc');

    expect(m.subject).toBe('[DOWN] Bookings API: Timeout');
    expect(m.text).toBe([
      'Bookings API is down: Timeout.',
      'URL: https://api.bookings.example/health',
      'Error: no HTTP response',
      'Down since: 2026-12-01 10:02 UTC',
      'Last successful check: 15 min ago (2026-12-01 09:57 UTC)',
      'Acknowledge: https://status.example/ack/abc',
      'Organization: Campus projects',
    ].join('\n'));
  });

  it('the HTTP code when there was one', () => {
    const m = alertMessage('opened', incident({ cause: 'http_5xx', httpStatus: 503 }), NOW, null);

    expect(m.subject).toBe('[DOWN] Bookings API: Server errors (5xx)');
    expect(m.text).toContain('Error: HTTP 503');
  });

  it('no successful check yet; no link without a public URL', () => {
    const m = alertMessage('opened', incident({ lastSuccessAt: null }), NOW, null);

    expect(m.text).toContain('Last successful check: none yet');
    expect(m.text).toContain('Acknowledge: in the admin panel, Incidents');
    expect(m.text).not.toContain('http://');
  });

  it('escalated: says how long and that nobody acknowledged it', () => {
    const m = alertMessage('escalated', incident(), at('2026-12-01T10:30:00'), 'https://status.example/ack/def');

    expect(m.subject).toBe('[ESCALATED] Bookings API: Timeout');
    expect(m.text.split('\n')[0]).toBe('Bookings API has been down for 28 min and nobody has acknowledged it: Timeout.');
    expect(m.text).toContain('Acknowledge: https://status.example/ack/def');
  });

  it('resolved: how long it was down, no acknowledge link', () => {
    const m = alertMessage('resolved', incident({ resolvedAt: at('2026-12-01T11:07:00') }), at('2026-12-01T11:07:30'), null);

    expect(m.subject).toBe('[RESOLVED] Bookings API is up again');
    expect(m.text).toBe([
      'Bookings API is up again after 1 h 5 min.',
      'URL: https://api.bookings.example/health',
      'Down from 2026-12-01 10:02 UTC to 2026-12-01 11:07 UTC (Timeout).',
      'Organization: Campus projects',
    ].join('\n'));
  });

  it('an unknown cause reads as Unknown', () => {
    expect(alertMessage('opened', incident({ cause: 'mystery' }), NOW, null).subject).toBe('[DOWN] Bookings API: Unknown');
  });
});
