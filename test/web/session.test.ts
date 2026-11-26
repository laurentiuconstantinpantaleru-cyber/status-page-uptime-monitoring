import { afterEach, describe, expect, it } from 'vitest';
import { IDLE_MS, MAX_MS, readCookie, sessionAlive } from '../../src/web/auth/session.js';
import { NOW, get, harness, signIn, type Harness } from './admin-fake.js';

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

describe('sessionAlive (D-035)', () => {
  it('ends 8 hours after the last request or 7 days after sign-in', () => {
    expect(IDLE_MS).toBe(8 * HOUR);
    expect(MAX_MS).toBe(7 * 24 * HOUR);
    const s = { createdAt: NOW, lastSeenAt: NOW };

    expect(sessionAlive(s, new Date(NOW.getTime() + IDLE_MS - 1))).toBe(true);
    expect(sessionAlive(s, new Date(NOW.getTime() + IDLE_MS))).toBe(false);
    const busy = { createdAt: NOW, lastSeenAt: new Date(NOW.getTime() + MAX_MS - HOUR) };
    expect(sessionAlive(busy, new Date(NOW.getTime() + MAX_MS - 1))).toBe(true);
    expect(sessionAlive(busy, new Date(NOW.getTime() + MAX_MS))).toBe(false);
  });
});

describe('readCookie', () => {
  it('finds one cookie among several and ignores the rest', () => {
    expect(readCookie('theme=dark; sid=abc_-1; other=x', 'sid')).toBe('abc_-1');
    expect(readCookie('xsid=nope', 'sid')).toBeNull();
    expect(readCookie(undefined, 'sid')).toBeNull();
    expect(readCookie('sid=', 'sid')).toBeNull();
  });
});

let h: Harness | undefined;
afterEach(async () => {
  await h?.app.close();
  h = undefined;
});

describe('sessions over time (simulated clock, D-004)', () => {
  it('an idle session ends after 8 hours and its row is deleted', async () => {
    h = harness();
    const cookie = await signIn(h.app, 'member');

    h.clock.advance(IDLE_MS - MINUTE);
    expect((await get(h.app, '/admin/monitors', cookie)).statusCode).toBe(200);

    h.clock.advance(IDLE_MS);
    const response = await get(h.app, '/admin/monitors', cookie);
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe('/login');
    expect(h.auth.sessions.size).toBe(0);
  });

  it('each request moves the idle limit, but not past 7 days after sign-in', async () => {
    h = harness();
    const cookie = await signIn(h.app, 'member');

    // A request every 7 hours keeps the session for 7 days, not longer.
    let elapsed = 0;
    while (elapsed + 7 * HOUR < MAX_MS) {
      h.clock.advance(7 * HOUR);
      elapsed += 7 * HOUR;
      expect((await get(h.app, '/admin/monitors', cookie)).statusCode).toBe(200);
    }
    h.clock.advance(MAX_MS - elapsed);
    expect((await get(h.app, '/admin/monitors', cookie)).headers.location).toBe('/login');
  });

  it('a made-up token gets no session', async () => {
    h = harness();
    const response = await get(h.app, '/admin/monitors', 'sid=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');

    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe('/login');
  });
});
