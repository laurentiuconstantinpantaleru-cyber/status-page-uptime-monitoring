import { afterEach, describe, expect, it } from 'vitest';
import { can } from '../../src/web/auth/access.js';
import { HOST, INCIDENT_A, MONITOR_A, USERS, get, harness, post, signIn, type Harness, type Who } from './admin-fake.js';
import { apiGet, apiHarness, apiPost, bearer, type ApiHarness, type KeyName } from './api-fake.js';

// Every route × every role (D-018, D-036). "ok" is the route's own success: 200 for a page,
// 303 back to the page for a form. "login" is 303 to /login.

type Expect = 'ok' | 'login' | 403 | 404;
interface Route {
  method: 'GET' | 'POST';
  url: string;
  fields?: Record<string, string>;
  ok: { status: number; location?: string };
  roles: Record<Who, Expect>;
}

const ALL_SIGNED_IN = { member: 'ok', orgAdmin: 'ok', otherAdmin: 'ok', global: 'ok' } as const;

const ROUTES: Route[] = [
  { method: 'GET', url: '/status', ok: { status: 200 },
    roles: { visitor: 'ok', ...ALL_SIGNED_IN } },
  { method: 'GET', url: '/login', ok: { status: 200 },
    roles: { visitor: 'ok', ...ALL_SIGNED_IN } },
  { method: 'GET', url: '/admin', ok: { status: 303, location: '/admin/monitors' },
    roles: { visitor: 'login', ...ALL_SIGNED_IN } },
  { method: 'GET', url: '/admin/monitors', ok: { status: 200 },
    roles: { visitor: 'login', ...ALL_SIGNED_IN } },
  { method: 'POST', url: `/admin/monitors/${MONITOR_A}/maintenance`, fields: { minutes: '15' },
    ok: { status: 303, location: `/admin/monitors?started=${MONITOR_A}&minutes=15` },
    roles: { visitor: 'login', member: 'ok', orgAdmin: 'ok', otherAdmin: 404, global: 'ok' } },
  { method: 'GET', url: `/admin/monitors/${MONITOR_A}/delete`, ok: { status: 200 },
    roles: { visitor: 'login', member: 403, orgAdmin: 'ok', otherAdmin: 404, global: 'ok' } },
  { method: 'POST', url: `/admin/monitors/${MONITOR_A}/delete`, fields: {},
    ok: { status: 303, location: '/admin/monitors?deleted=Bookings+API' },
    roles: { visitor: 'login', member: 403, orgAdmin: 'ok', otherAdmin: 404, global: 'ok' } },
  { method: 'GET', url: '/admin/incidents', ok: { status: 200 },
    roles: { visitor: 'login', ...ALL_SIGNED_IN } },
  { method: 'POST', url: `/admin/incidents/${INCIDENT_A}/updates`, fields: { stage: 'identified', body: 'Disk full; freeing space.' },
    ok: { status: 303, location: `/admin/incidents?posted=${INCIDENT_A}#incident-${INCIDENT_A}` },
    roles: { visitor: 'login', member: 'ok', orgAdmin: 'ok', otherAdmin: 404, global: 'ok' } },
  { method: 'GET', url: '/admin/reports', ok: { status: 200 },
    roles: { visitor: 'login', member: 403, orgAdmin: 'ok', otherAdmin: 'ok', global: 'ok' } },
  { method: 'GET', url: '/admin/reports/1/2026-10.pdf', ok: { status: 200 },
    roles: { visitor: 'login', member: 403, orgAdmin: 'ok', otherAdmin: 404, global: 'ok' } },
  { method: 'POST', url: '/logout', fields: {}, ok: { status: 303, location: '/login' },
    roles: { visitor: 'login', ...ALL_SIGNED_IN } },
];

let h: Harness | undefined;
afterEach(async () => {
  await h?.app.close();
  h = undefined;
});

const cases = ROUTES.flatMap((route) =>
  (Object.entries(route.roles) as [Who, Expect][]).map(([who, expected]) => ({ route, who, expected })));

describe('access matrix', () => {
  it.each(cases.map((c) => [`${c.route.method} ${c.route.url}`, c.who, c.expected, c] as const))(
    '%s as %s → %s',
    async (_, who, expected, { route }) => {
      h = harness();
      const cookie = who === 'visitor' ? undefined : await signIn(h.app, who);
      const response = route.method === 'GET'
        ? await get(h.app, route.url, cookie)
        : await post(h.app, route.url, route.fields ?? {}, cookie);

      if (expected === 'ok') {
        expect(response.statusCode).toBe(route.ok.status);
        if (route.ok.location) expect(response.headers.location).toBe(route.ok.location);
      } else if (expected === 'login') {
        expect(response.statusCode).toBe(303);
        expect(response.headers.location).toBe('/login');
      } else {
        expect(response.statusCode).toBe(expected);
      }
      // A refused write leaves nothing behind.
      if (expected !== 'ok') {
        expect(h.admin.maintenance).toEqual([]);
        expect(h.admin.deleted).toEqual([]);
        expect(h.admin.updates).toEqual([]);
      }
    },
  );

  it('a refused page says what happened in plain words', async () => {
    h = harness();
    const cookie = await signIn(h.app, 'member');

    const forbidden = await get(h.app, `/admin/monitors/${MONITOR_A}/delete`, cookie);
    expect(forbidden.body).toContain('Only an org admin can do this.');
    const missing = await get(h.app, '/admin/monitors/999/delete', await signIn(h.app, 'orgAdmin'));
    expect(missing.statusCode).toBe(404);
    expect(missing.body).toContain('This page does not exist');
  });

  it.each(['abc', '1e3', '-1', '10.5', '10%20OR%201=1'])('an id that is not a number (%s) is 404', async (id) => {
    h = harness();
    const cookie = await signIn(h.app, 'global');

    expect((await get(h.app, `/admin/monitors/${id}/delete`, cookie)).statusCode).toBe(404);
    expect((await post(h.app, `/admin/incidents/${id}/updates`, { stage: 'identified', body: 'x' }, cookie)).statusCode).toBe(404);
  });
});

describe('Origin check on POST (D-035)', () => {
  it.each([
    ['no Origin', undefined],
    ['another site', 'https://evil.example'],
    ['the same host on another port', `https://${HOST}:8443`],
    ['a malformed Origin', 'null'],
  ])('refuses %s with 403 before anything runs', async (_, origin) => {
    h = harness();
    const cookie = await signIn(h.app, 'global');
    const response = await h.app.inject({
      method: 'POST',
      url: `/admin/incidents/${INCIDENT_A}/updates`,
      headers: { host: HOST, cookie, 'content-type': 'application/x-www-form-urlencoded', ...(origin ? { origin } : {}) },
      payload: 'stage=identified&body=x',
    });

    expect(response.statusCode).toBe(403);
    expect(h.admin.updates).toEqual([]);
  });

  it('refuses a cross-site sign-in too', async () => {
    h = harness();
    const response = await h.app.inject({
      method: 'POST', url: '/login',
      headers: { host: HOST, origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' },
      payload: `email=${encodeURIComponent(USERS.member.email)}&password=x`,
    });

    expect(response.statusCode).toBe(403);
    expect(h.auth.sessions.size).toBe(0);
  });
});

describe('can (D-018)', () => {
  const user = (role: 'member' | 'org_admin' | 'global_admin') => ({ id: 1, displayName: 'x', role, organizationId: role === 'global_admin' ? null : 1 });

  it('members view, start maintenance and write updates; only admins manage monitors', () => {
    expect(can(user('member'), 'view')).toBe(true);
    expect(can(user('member'), 'maintenance')).toBe(true);
    expect(can(user('member'), 'write_update')).toBe(true);
    expect(can(user('member'), 'manage_monitors')).toBe(false);
    expect(can(user('org_admin'), 'manage_monitors')).toBe(true);
    expect(can(user('global_admin'), 'manage_monitors')).toBe(true);
  });
});

// Every API route × every kind of key (D-025, D-039). The API knows no roles or sessions.
type KeyCase = 'none' | KeyName;
interface ApiRoute {
  method: 'GET' | 'POST';
  url: string;
  body?: unknown;
  keys: Record<KeyCase, number>;
}

const API_ROUTES: ApiRoute[] = [
  { method: 'GET', url: '/api/v1/monitors',
    keys: { none: 401, read: 200, write: 200, otherWrite: 200, revoked: 401 } },
  { method: 'POST', url: '/api/v1/monitors', body: { name: 'Matrix', url: 'https://matrix.example/' },
    keys: { none: 401, read: 403, write: 201, otherWrite: 201, revoked: 401 } },
  { method: 'GET', url: `/badge/${MONITOR_A}.svg`,
    keys: { none: 200, read: 200, write: 200, otherWrite: 200, revoked: 200 } },
];

describe('API access matrix', () => {
  let a: ApiHarness | undefined;
  afterEach(async () => {
    await a?.app.close();
    a = undefined;
  });

  const apiCases = API_ROUTES.flatMap((route) =>
    (Object.entries(route.keys) as [KeyCase, number][]).map(([key, expected]) => [`${route.method} ${route.url}`, key, expected, route] as const));

  it.each(apiCases)('%s with key %s → %i', async (_, key, expected, route) => {
    a = apiHarness();
    const authorization = key === 'none' ? undefined : bearer(key);
    const response = route.method === 'GET'
      ? await apiGet(a.app, route.url, authorization)
      : await apiPost(a.app, route.url, route.body, authorization);

    expect(response.statusCode).toBe(expected);
    if (expected !== 201) expect(a.api.created).toEqual([]);
  });
});
