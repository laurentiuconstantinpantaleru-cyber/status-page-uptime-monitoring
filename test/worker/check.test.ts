import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../src/shared/clock.js';
import {
  DEFAULT_TIMEOUT_MS,
  runCheck,
  type CheckConfig,
  type HttpClient,
  type HttpRequest,
  type HttpResponse,
} from '../../src/worker/check.js';

const START = new Date('2026-11-26T18:00:00.000Z');

const BASE: CheckConfig = {
  url: 'https://example.test/',
  expectedStatus: 200,
  timeoutMs: 10_000,
  keyword: null,
  checkTls: false,
  latencyThresholdMs: null,
};

/** Answers every request after `latencyMs` of simulated time, never touching the network. */
function fakeClient(
  clock: FakeClock,
  answer: HttpResponse | Error,
  latencyMs = 120,
): HttpClient & { requests: HttpRequest[] } {
  const requests: HttpRequest[] = [];
  return {
    requests,
    async request(request) {
      requests.push(request);
      clock.advance(latencyMs);
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
}

function nodeError(code: string, name = 'Error'): Error {
  const error = new Error(code) as Error & { code: string };
  error.name = name;
  error.code = code;
  return error;
}

describe('runCheck: check kinds', () => {
  it('is up when the expected status code comes back', async () => {
    const clock = new FakeClock(START);
    const client = fakeClient(clock, { status: 200, body: 'ok' });

    const result = await runCheck(BASE, { client, clock });

    expect(result).toMatchObject({ outcome: 'up', httpStatus: 200, errorCause: null });
  });

  it('is up when the keyword is in the body', async () => {
    const clock = new FakeClock(START);
    const client = fakeClient(clock, { status: 200, body: '<h1>Meniu</h1>' });

    const result = await runCheck({ ...BASE, keyword: 'Meniu' }, { client, clock });

    expect(result).toMatchObject({ outcome: 'up', errorCause: null });
  });

  it('measures latency with the clock and is not slow under the threshold', async () => {
    const clock = new FakeClock(START);
    const client = fakeClient(clock, { status: 200, body: 'ok' }, 450);

    const result = await runCheck({ ...BASE, latencyThresholdMs: 500 }, { client, clock });

    expect(result).toMatchObject({ outcome: 'up', latencyMs: 450, slow: false });
  });

  it('stays up but is slow above the latency threshold', async () => {
    const clock = new FakeClock(START);
    const client = fakeClient(clock, { status: 200, body: 'ok' }, 501);

    const result = await runCheck({ ...BASE, latencyThresholdMs: 500 }, { client, clock });

    expect(result).toMatchObject({ outcome: 'up', latencyMs: 501, slow: true, errorCause: null });
  });

  it('reports the certificate expiry and the whole days left until it', async () => {
    const clock = new FakeClock(START);
    const tlsExpiresAt = new Date('2026-12-10T12:00:00.000Z');
    const client = fakeClient(clock, { status: 200, body: 'ok', tlsExpiresAt }, 0);

    const result = await runCheck({ ...BASE, checkTls: true }, { client, clock });

    expect(result.tlsExpiresAt?.toISOString()).toBe('2026-12-10T12:00:00.000Z');
    expect(result.tlsDaysRemaining).toBe(13);
  });

  it('waits 30 seconds by default and the monitor timeout when one is set', async () => {
    const clock = new FakeClock(START);
    const client = fakeClient(clock, { status: 200, body: 'ok' });

    await runCheck({ ...BASE, timeoutMs: undefined }, { client, clock });
    await runCheck({ ...BASE, timeoutMs: 5_000 }, { client, clock });

    expect(DEFAULT_TIMEOUT_MS).toBe(30_000);
    expect(client.requests.map((request) => request.timeoutMs)).toEqual([30_000, 5_000]);
  });
});

describe('runCheck: failure causes', () => {
  it('timeout', async () => {
    const clock = new FakeClock(START);
    const error = new Error('The operation was aborted due to timeout');
    error.name = 'TimeoutError';
    const client = fakeClient(clock, error, 30_000);

    const result = await runCheck(BASE, { client, clock });

    expect(result).toMatchObject({ outcome: 'down', errorCause: 'timeout', httpStatus: null, latencyMs: null });
  });

  it('http_5xx', async () => {
    const clock = new FakeClock(START);
    const client = fakeClient(clock, { status: 503, body: 'Service Unavailable' });

    const result = await runCheck(BASE, { client, clock });

    expect(result).toMatchObject({ outcome: 'down', errorCause: 'http_5xx', httpStatus: 503 });
  });

  it('http_5xx wins over a missing keyword', async () => {
    const clock = new FakeClock(START);
    const client = fakeClient(clock, { status: 500, body: 'error' });

    const result = await runCheck({ ...BASE, keyword: 'Meniu' }, { client, clock });

    expect(result.errorCause).toBe('http_5xx');
  });

  it('unexpected_status', async () => {
    const clock = new FakeClock(START);
    const client = fakeClient(clock, { status: 404, body: 'Not Found' });

    const result = await runCheck(BASE, { client, clock });

    expect(result).toMatchObject({ outcome: 'down', errorCause: 'unexpected_status', httpStatus: 404 });
  });

  it('keyword_missing, matched case-sensitively', async () => {
    const clock = new FakeClock(START);
    const client = fakeClient(clock, { status: 200, body: '<h1>meniu</h1>' });

    const result = await runCheck({ ...BASE, keyword: 'Meniu' }, { client, clock });

    expect(result).toMatchObject({ outcome: 'down', errorCause: 'keyword_missing', httpStatus: 200 });
  });

  it('dns', async () => {
    const clock = new FakeClock(START);
    const client = fakeClient(clock, nodeError('ENOTFOUND'));

    const result = await runCheck(BASE, { client, clock });

    expect(result).toMatchObject({ outcome: 'down', errorCause: 'dns' });
  });

  it('tls', async () => {
    const clock = new FakeClock(START);
    const client = fakeClient(clock, nodeError('CERT_HAS_EXPIRED'));

    const result = await runCheck({ ...BASE, checkTls: true }, { client, clock });

    expect(result).toMatchObject({ outcome: 'down', errorCause: 'tls' });
  });

  it('connection', async () => {
    const clock = new FakeClock(START);
    const client = fakeClient(clock, nodeError('ECONNREFUSED'));

    const result = await runCheck(BASE, { client, clock });

    expect(result).toMatchObject({ outcome: 'down', errorCause: 'connection' });
  });

  it('unknown', async () => {
    const clock = new FakeClock(START);
    const client = fakeClient(clock, new Error('something else'));

    const result = await runCheck(BASE, { client, clock });

    expect(result).toMatchObject({ outcome: 'down', errorCause: 'unknown' });
  });
});
