import { afterEach, describe, expect, it } from 'vitest';
import { newApiKey } from '../../src/web/api/keys.js';
import { HOST, INCIDENT_A, MONITOR_A, NOW, ORG_A, ORIGIN, signIn } from './admin-fake.js';
import { KEYS, MONITOR_B, apiGet, apiHarness, apiPost, bearer, setStatus, type ApiHarness } from './api-fake.js';

let h: ApiHarness | undefined;
afterEach(async () => {
  await h?.app.close();
  h = undefined;
});

const NEW = { name: 'Library catalogue', url: 'https://library.example/' };

describe('Bearer keys (D-025, D-039)', () => {
  it.each([
    ['no Authorization header', undefined],
    ['a malformed header', 'Bearer not-a-key'],
    ['another scheme', `Basic ${KEYS.read.plaintext}`],
    ['an unknown public id', `Bearer ${newApiKey().plaintext}`],
    ['a wrong secret', `Bearer ${KEYS.read.publicId}.${newApiKey().secret}`],
    ['a revoked key', bearer('revoked')],
  ])('%s gets 401 with a JSON error and WWW-Authenticate', async (_, authorization) => {
    h = apiHarness();
    const response = await apiGet(h.app, '/api/v1/monitors', authorization);

    expect(response.statusCode).toBe(401);
    expect(response.headers['www-authenticate']).toBe('Bearer');
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(response.json()).toEqual({
      error: 'unauthorized',
      message: 'Send a valid API key as Authorization: Bearer <public_id>.<secret>.',
    });
  });

  it('a session cookie is not a key: a signed-in global admin without a key gets 401', async () => {
    h = apiHarness();
    const cookie = await signIn(h.app, 'global');
    const response = await h.app.inject({ method: 'GET', url: '/api/v1/monitors', headers: { host: HOST, cookie } });

    expect(response.statusCode).toBe(401);
  });

  it('a wrong key on a POST is refused before the body is read', async () => {
    h = apiHarness();
    const response = await h.app.inject({
      method: 'POST', url: '/api/v1/monitors', headers: { host: HOST, 'content-type': 'application/json' }, payload: '{not json',
    });

    expect(response.statusCode).toBe(401);
    expect(h.api.created).toEqual([]);
  });
});

describe('GET /api/v1/monitors (Q-018)', () => {
  it.each(['read', 'write'] as const)('a %s key lists its organization\'s monitors with their status', async (key) => {
    h = apiHarness();
    const response = await apiGet(h.app, '/api/v1/monitors', bearer(key));

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(response.json()).toEqual({
      monitors: [{ id: MONITOR_A, name: 'Bookings API', url: 'https://api.bookings.example/health', interval_minutes: 1, status: 'outage' }],
    });
  });

  it('a key of another organization sees only that organization', async () => {
    h = apiHarness();
    const response = await apiGet(h.app, '/api/v1/monitors', bearer('otherWrite'));

    expect(response.json().monitors.map((m: { id: number }) => m.id)).toEqual([MONITOR_B]);
  });

  it.each([
    ['ok', 'operational'],
    ['degraded', 'degraded'],
    ['outage', 'outage'],
    ['maint', 'maintenance'],
    ['nodata', 'no_data'],
  ] as const)('status %s is sent as %s', async (status, sent) => {
    h = apiHarness();
    const original = h.api.monitors.bind(h.api);
    h.api.monitors = async (orgId, now) => (await original(orgId, now)).map((m) => ({ ...m, status }));

    expect((await apiGet(h.app, '/api/v1/monitors', bearer('read'))).json().monitors[0].status).toBe(sent);
  });

  it('a database failure gets 500 with a JSON error', async () => {
    h = apiHarness();
    h.api.fail.monitors = true;
    const response = await apiGet(h.app, '/api/v1/monitors', bearer('read'));

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'internal', message: 'Something went wrong on our side. Try again later.' });
  });
});

describe('POST /api/v1/monitors (Q-018, D-039)', () => {
  it('a write key creates a monitor in its organization: 201 with the monitor, and the status version is bumped', async () => {
    h = apiHarness();
    const response = await apiPost(h.app, '/api/v1/monitors', { ...NEW, interval_minutes: 10 }, bearer('write'));

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ id: 100, name: 'Library catalogue', url: 'https://library.example/', interval_minutes: 10, status: 'no_data' });
    expect(h.api.created).toEqual([{
      organizationId: ORG_A,
      monitor: {
        name: 'Library catalogue', url: 'https://library.example/', intervalMinutes: 10, expectedStatus: 200,
        timeoutMs: 30_000, keyword: null, checkTls: true, latencyThresholdMs: null,
      },
      at: NOW,
    }]);
    expect(h.api.bumps).toBe(1);

    const listed = (await apiGet(h.app, '/api/v1/monitors', bearer('read'))).json().monitors;
    expect(listed.map((m: { id: number }) => m.id)).toEqual([MONITOR_A, 100]);
  });

  it('a read key gets 403 and nothing is created', async () => {
    h = apiHarness();
    const response = await apiPost(h.app, '/api/v1/monitors', NEW, bearer('read'));

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'forbidden', message: 'This key can only read. Create a write key to change monitors.' });
    expect(h.api.created).toEqual([]);
  });

  it('an invalid body gets 400 with a message per field', async () => {
    h = apiHarness();
    const response = await apiPost(h.app, '/api/v1/monitors', { name: '', url: 'ftp://x', interval_minutes: 0 }, bearer('write'));

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'invalid_request',
      message: 'Some fields are wrong; see fields.',
      fields: {
        name: 'Give a name.',
        url: 'Give a url that starts with http:// or https://.',
        interval_minutes: 'Give interval_minutes as a whole number from 1 to 60.',
      },
    });
    expect(h.api.created).toEqual([]);
  });

  it.each([
    ['broken JSON', 'application/json', '{"name": '],
    ['a form instead of JSON', 'application/x-www-form-urlencoded', 'name=x&url=https%3A%2F%2Fx.example%2F'],
    ['an unknown content type', 'text/plain', 'hello'],
  ])('%s gets 400 with a JSON error', async (_, contentType, payload) => {
    h = apiHarness();
    const response = await h.app.inject({
      method: 'POST', url: '/api/v1/monitors', headers: { host: HOST, 'content-type': contentType, authorization: bearer('write') }, payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_request', message: 'Send a JSON object with Content-Type: application/json.' });
    expect(h.api.created).toEqual([]);
  });

  it('needs no Origin header: a script sends none (D-040)', async () => {
    h = apiHarness();
    const response = await apiPost(h.app, '/api/v1/monitors', NEW, bearer('write'));

    expect(response.request.headers.origin).toBeUndefined();
    expect(response.statusCode).toBe(201);
  });

  it('a POST from another site is judged only by its key: without one it gets 401', async () => {
    h = apiHarness();
    const response = await h.app.inject({
      method: 'POST', url: '/api/v1/monitors',
      headers: { host: HOST, origin: 'https://evil.example', 'content-type': 'application/json' },
      payload: JSON.stringify(NEW),
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('the Origin check still covers every POST outside /api/ (D-040)', () => {
  it('an admin form POST without Origin gets 403', async () => {
    h = apiHarness();
    const cookie = await signIn(h.app, 'global');
    const response = await h.app.inject({
      method: 'POST', url: `/admin/incidents/${INCIDENT_A}/updates`,
      headers: { host: HOST, cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'stage=identified&body=x',
    });

    expect(response.statusCode).toBe(403);
    expect(h.admin.updates).toEqual([]);
  });

  it.each(['/apiv1/monitors', '/login'])('%s is not under /api/, so a POST without Origin gets 403', async (url) => {
    h = apiHarness();
    const response = await h.app.inject({ method: 'POST', url, headers: { host: HOST, 'content-type': 'application/x-www-form-urlencoded' }, payload: '' });

    expect(response.statusCode).toBe(403);
  });

  it('with Origin the admin form still works', async () => {
    h = apiHarness();
    const cookie = await signIn(h.app, 'global');
    const response = await h.app.inject({
      method: 'POST', url: `/admin/incidents/${INCIDENT_A}/updates`,
      headers: { host: HOST, origin: ORIGIN, cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'stage=identified&body=x',
    });

    expect(response.statusCode).toBe(303);
  });
});

describe('GET /badge/:monitor_id.svg (D-025, D-039)', () => {
  it('is public: an SVG image with the status, no key, not cached', async () => {
    h = apiHarness();
    const response = await apiGet(h.app, `/badge/${MONITOR_B}.svg`);

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/svg+xml; charset=utf-8');
    expect(response.headers['cache-control']).toBe('no-cache');
    expect(response.body).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(response.body).toContain('aria-label="Status: operational"');
    expect(response.body).toContain('<title>Status: operational</title>');
    expect(response.body).toContain('>operational</text>');
  });

  it.each([
    ['ok', 'operational', '#059669'],
    ['degraded', 'degraded', '#d97706'],
    ['outage', 'outage', '#dc2626'],
    ['maint', 'maintenance', '#7c3aed'],
    ['nodata', 'no data', '#64748b'],
  ] as const)('status %s shows "%s" with its icon color', async (status, label, color) => {
    h = apiHarness();
    await setStatus(h.api, MONITOR_A, status);
    const response = await apiGet(h.app, `/badge/${MONITOR_A}.svg`);

    expect(response.body).toContain(`>${label}</text>`);
    expect(response.body).toContain(`color="${color}"`);
    // Standalone SVG: no CSS variables, which an <img> would not resolve.
    expect(response.body).not.toContain('var(--');
  });

  it('a monitor of any organization has a badge', async () => {
    h = apiHarness();
    expect((await apiGet(h.app, `/badge/${MONITOR_A}.svg`)).statusCode).toBe(200);
    expect((await apiGet(h.app, `/badge/${MONITOR_B}.svg`)).statusCode).toBe(200);
  });

  it.each(['999.svg', 'abc.svg', '10.png', '10', '-1.svg', '1e3.svg', '10.svg.svg', '0.svg', '010.svg'])('/badge/%s gets 404', async (file) => {
    h = apiHarness();
    const response = await apiGet(h.app, `/badge/${file}`);

    expect(response.statusCode).toBe(404);
    expect(response.body).toBe('No monitor with this id.');
  });
});
