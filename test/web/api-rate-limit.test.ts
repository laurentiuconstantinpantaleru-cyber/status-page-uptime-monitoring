import { afterEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../../src/shared/clock.js';
import { RateLimiter } from '../../src/web/api/rate-limit.js';
import { apiGet, apiHarness, bearer, type ApiHarness } from './api-fake.js';
import { NOW } from './admin-fake.js';

describe('RateLimiter (D-025, D-039)', () => {
  it('allows 60 requests in 60 s and refuses the 61st with the seconds until one slot frees', () => {
    const clock = new FakeClock(NOW);
    const limiter = new RateLimiter(clock, 60, 60_000);

    for (let i = 0; i < 60; i += 1) {
      expect(limiter.take('k')).toEqual({ ok: true });
      clock.advance(500);
    }
    // The first request was 30 s ago, so its slot frees in 30 s.
    expect(limiter.take('k')).toEqual({ ok: false, retryAfterS: 30 });
  });

  it('the window slides: a slot frees exactly 60 s after its request', () => {
    const clock = new FakeClock(NOW);
    const limiter = new RateLimiter(clock, 60, 60_000);
    limiter.take('k');
    clock.advance(1000);
    for (let i = 0; i < 59; i += 1) limiter.take('k');

    clock.advance(58_999);
    expect(limiter.take('k')).toEqual({ ok: false, retryAfterS: 1 });
    clock.advance(1);
    // Only the first request has left the window; the other 59 leave in 1 s.
    expect(limiter.take('k')).toEqual({ ok: true });
    expect(limiter.take('k')).toEqual({ ok: false, retryAfterS: 1 });
  });

  it('a refused request does not count', () => {
    const clock = new FakeClock(NOW);
    const limiter = new RateLimiter(clock, 2, 60_000);
    limiter.take('k');
    limiter.take('k');
    for (let i = 0; i < 10; i += 1) limiter.take('k');

    clock.advance(60_000);
    expect(limiter.take('k')).toEqual({ ok: true });
    expect(limiter.take('k')).toEqual({ ok: true });
  });

  it('each key has its own limit', () => {
    const limiter = new RateLimiter(new FakeClock(NOW), 1, 60_000);

    expect(limiter.take('a')).toEqual({ ok: true });
    expect(limiter.take('a').ok).toBe(false);
    expect(limiter.take('b')).toEqual({ ok: true });
  });
});

// Each request verifies a real bcrypt hash (~70 ms), and these tests send 60 or more.
describe('429 from the API (D-025, D-039)', { timeout: 30_000 }, () => {
  let h: ApiHarness | undefined;
  afterEach(async () => {
    await h?.app.close();
    h = undefined;
  });

  it('request 61 in a minute gets 429 with Retry-After and a JSON error; a minute later it works again', async () => {
    h = apiHarness();
    for (let i = 0; i < 60; i += 1) {
      expect((await apiGet(h.app, '/api/v1/monitors', bearer('read'))).statusCode).toBe(200);
    }

    const refused = await apiGet(h.app, '/api/v1/monitors', bearer('read'));
    expect(refused.statusCode).toBe(429);
    expect(refused.headers['retry-after']).toBe('60');
    expect(refused.headers['content-type']).toMatch(/^application\/json/);
    expect(refused.json()).toEqual({
      error: 'rate_limited',
      message: 'This key made more than 60 requests in the last minute. Try again in 60 seconds.',
    });

    h.clock.advance(60_000);
    expect((await apiGet(h.app, '/api/v1/monitors', bearer('read'))).statusCode).toBe(200);
  });

  it('another key of the same organization is not limited by the first', async () => {
    h = apiHarness();
    for (let i = 0; i < 61; i += 1) await apiGet(h.app, '/api/v1/monitors', bearer('read'));

    expect((await apiGet(h.app, '/api/v1/monitors', bearer('write'))).statusCode).toBe(200);
  });

  it('a wrong secret gets 401 and uses none of the key\'s limit', async () => {
    h = apiHarness();
    const wrong = `Bearer ${bearer('read').slice(7, 19)}.${'x'.repeat(43)}`;
    for (let i = 0; i < 5; i += 1) expect((await apiGet(h.app, '/api/v1/monitors', wrong)).statusCode).toBe(401);

    for (let i = 0; i < 60; i += 1) {
      expect((await apiGet(h.app, '/api/v1/monitors', bearer('read'))).statusCode).toBe(200);
    }
  });

  it('the public badge is not limited', async () => {
    h = apiHarness();
    for (let i = 0; i < 70; i += 1) {
      expect((await apiGet(h.app, '/badge/10.svg')).statusCode).toBe(200);
    }
  });
});
