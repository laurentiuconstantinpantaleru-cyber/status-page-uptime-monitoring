import { describe, expect, it } from 'vitest';
import { parseNewMonitor } from '../../src/web/api/monitor-input.js';

describe('parseNewMonitor (Q-018, D-016, D-022)', () => {
  it('needs only name and url; the rest take their defaults', () => {
    expect(parseNewMonitor({ name: '  Bookings API ', url: 'https://api.bookings.example/health' })).toEqual({
      ok: true,
      monitor: {
        name: 'Bookings API',
        url: 'https://api.bookings.example/health',
        intervalMinutes: 5,
        expectedStatus: 200,
        timeoutMs: 30_000,
        keyword: null,
        checkTls: true,
        latencyThresholdMs: null,
      },
    });
  });

  it('takes every optional field; an http:// url checks no certificate', () => {
    expect(parseNewMonitor({
      name: 'Cafe Wien',
      url: 'http://cafewien.ro/',
      interval_minutes: 60,
      expected_status: 301,
      timeout_ms: 1000,
      keyword: 'Meniu',
      latency_threshold_ms: 800,
    })).toEqual({
      ok: true,
      monitor: {
        name: 'Cafe Wien',
        url: 'http://cafewien.ro/',
        intervalMinutes: 60,
        expectedStatus: 301,
        timeoutMs: 1000,
        keyword: 'Meniu',
        checkTls: false,
        latencyThresholdMs: 800,
      },
    });
  });

  it('null means "not set" for the optional fields', () => {
    const parsed = parseNewMonitor({
      name: 'X', url: 'https://x.example/', interval_minutes: null, expected_status: null, timeout_ms: null, keyword: null, latency_threshold_ms: null,
    });
    expect(parsed).toMatchObject({ ok: true, monitor: { intervalMinutes: 5, expectedStatus: 200, timeoutMs: 30_000, keyword: null, latencyThresholdMs: null } });
  });

  it.each([null, 'name=x', 42, ['a'], undefined])('refuses a body that is not a JSON object (%j)', (body) => {
    expect(parseNewMonitor(body)).toEqual({ ok: false, errors: { body: 'Send a JSON object.' } });
  });

  it('names every wrong field at once', () => {
    expect(parseNewMonitor({})).toEqual({
      ok: false,
      errors: { name: 'Give a name.', url: 'Give a url.' },
    });
  });

  it.each([
    [{ name: '   ' }, 'name', 'Give a name.'],
    [{ name: 7 }, 'name', 'Give the name as text.'],
    [{ name: 'x'.repeat(256) }, 'name', 'Keep the name to 255 characters.'],
    [{ url: 'not a url' }, 'url', 'Give a url that starts with http:// or https://.'],
    [{ url: 'ftp://files.example/' }, 'url', 'Give a url that starts with http:// or https://.'],
    [{ url: `https://x.example/${'a'.repeat(2048)}` }, 'url', 'Keep the url to 2048 characters.'],
    [{ interval_minutes: 0 }, 'interval_minutes', 'Give interval_minutes as a whole number from 1 to 60.'],
    [{ interval_minutes: 61 }, 'interval_minutes', 'Give interval_minutes as a whole number from 1 to 60.'],
    [{ interval_minutes: 2.5 }, 'interval_minutes', 'Give interval_minutes as a whole number from 1 to 60.'],
    [{ interval_minutes: '5' }, 'interval_minutes', 'Give interval_minutes as a whole number from 1 to 60.'],
    [{ expected_status: 99 }, 'expected_status', 'Give expected_status as a whole number from 100 to 599.'],
    [{ expected_status: 600 }, 'expected_status', 'Give expected_status as a whole number from 100 to 599.'],
    [{ timeout_ms: 999 }, 'timeout_ms', 'Give timeout_ms as a whole number from 1000 to 60000.'],
    [{ timeout_ms: 60_001 }, 'timeout_ms', 'Give timeout_ms as a whole number from 1000 to 60000.'],
    [{ keyword: '' }, 'keyword', 'Give the keyword as 1 to 255 characters, or leave it out.'],
    [{ keyword: 'x'.repeat(256) }, 'keyword', 'Give the keyword as 1 to 255 characters, or leave it out.'],
    [{ keyword: 3 }, 'keyword', 'Give the keyword as 1 to 255 characters, or leave it out.'],
    [{ latency_threshold_ms: 0 }, 'latency_threshold_ms', 'Give latency_threshold_ms as a whole number of at least 1, or leave it out.'],
    [{ latency_threshold_ms: -5 }, 'latency_threshold_ms', 'Give latency_threshold_ms as a whole number of at least 1, or leave it out.'],
  ])('refuses %j', (fields, field, message) => {
    const parsed = parseNewMonitor({ name: 'Valid', url: 'https://valid.example/', ...fields });
    expect(parsed).toEqual({ ok: false, errors: { [field]: message } });
  });
});
