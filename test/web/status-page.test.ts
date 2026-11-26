import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { FakeClock } from '../../src/shared/clock.js';
import { buildApp } from '../../src/web/app.js';
import type { MonitorData, StatusData } from '../../src/web/status/model.js';

const NOW = new Date('2026-11-26T14:55:00.000Z');
const HOUR = 60 * 60 * 1000;

function monitor(name: string, overrides: Partial<MonitorData> = {}): MonitorData {
  return {
    name,
    createdAt: new Date('2026-11-20T00:00:00.000Z'),
    latencyThresholdMs: null,
    firstCheckAt: new Date('2026-11-25T10:00:00.000Z'),
    lastCheck: { checkedAt: new Date('2026-11-26T14:50:00.000Z'), latencyMs: 120 },
    incidents: [],
    maintenance: [],
    ...overrides,
  };
}

const NO_CHECKS: Partial<MonitorData> = { firstCheckAt: null, lastCheck: null };
const OPEN_INCIDENT: Partial<MonitorData> = { incidents: [{ startedAt: new Date('2026-11-26T14:02:00.000Z'), resolvedAt: null }] };
const IN_MAINTENANCE: Partial<MonitorData> = { maintenance: [{ startsAt: new Date(NOW.getTime() - HOUR), endsAt: new Date(NOW.getTime() + HOUR) }] };
const SLOW: Partial<MonitorData> = { latencyThresholdMs: 100 };

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function get(data: StatusData | (() => Promise<StatusData>)) {
  const load = typeof data === 'function' ? data : async () => data;
  app = buildApp({}, { clock: new FakeClock(NOW), status: { load, readVersion: async () => 1 } });
  return app.inject({ method: 'GET', url: '/status' });
}

const count = (html: string, needle: string) => html.split(needle).length - 1;
const h1 = (html: string) => /<h1 id="overall-title">([^<]*)<\/h1>/.exec(html)?.[1];

describe('GET /status', () => {
  it('renders the empty state with no monitors', async () => {
    const response = await get({ groups: [] });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/html/);
    expect(h1(response.body)).toBe('No components yet');
    expect(response.body).toContain('Components will appear here after their first check');
    expect(count(response.body, 'class="component"')).toBe(0);
  });

  it('renders one monitor with its status badge and 90 daily bars', async () => {
    const response = await get({ groups: [{ name: 'Hug The Mug', monitors: [monitor('Hug The Mug')] }] });

    expect(h1(response.body)).toBe('All components operational');
    expect(count(response.body, 'class="component"')).toBe(1);
    expect(response.body).toContain('<span>Operational</span>');
    expect(count(response.body, '<li class="d-')).toBe(90);
    expect(response.body).toContain('1 component<');
    expect(response.body).toContain('Updated <time datetime="2026-11-26T14:55:00.000Z">14:55 UTC</time>');
  });

  it('renders several monitors in one card per organization, in order', async () => {
    const response = await get({
      groups: [
        { name: 'Hug The Mug', monitors: [monitor('Hug The Mug')] },
        { name: 'Cafe Wien Sibiu', monitors: [monitor('Cafe Wien Sibiu'), monitor('Cafe Wien bookings')] },
      ],
    });
    const body = response.body;

    expect(count(body, 'class="component"')).toBe(3);
    expect(count(body, '<li class="d-')).toBe(270);
    expect(body.indexOf('Hug The Mug')).toBeLessThan(body.indexOf('Cafe Wien Sibiu'));
    expect(body).toContain('2 components<');
  });

  it('shows "No data yet" and grey bars for a monitor without checks', async () => {
    const response = await get({ groups: [{ name: 'Campus', monitors: [monitor('Library seat map', NO_CHECKS)] }] });

    expect(response.body).toContain('<span>No data yet</span>');
    expect(count(response.body, '<li class="d-nodata')).toBe(90);
    expect(h1(response.body)).toBe('No data yet');
  });

  it.each([
    ['operational', {}, 'Operational', 'All components operational'],
    ['degraded', SLOW, 'Degraded', 'Some components are slow'],
    ['down', OPEN_INCIDENT, 'Down', 'All components are down'],
    ['maintenance', IN_MAINTENANCE, 'Maintenance', 'Maintenance in progress'],
  ] as const)('shows the %s state on the badge and in the banner', async (_name, overrides, badge, headline) => {
    const response = await get({ groups: [{ name: 'Campus', monitors: [monitor('Bookings API', overrides)] }] });

    expect(response.body).toContain(`<span>${badge}</span>`);
    expect(h1(response.body)).toBe(headline);
  });

  it('puts the worst status in the banner and names the down component', async () => {
    const response = await get({
      groups: [{ name: 'Campus', monitors: [
        monitor('Corner bakery website'),
        monitor('Bookings API', OPEN_INCIDENT),
        monitor('Campus events app', SLOW),
        monitor('Bistro table bookings', IN_MAINTENANCE),
      ] }],
    });

    expect(h1(response.body)).toBe('Some components are down');
    expect(response.body).toContain('Bookings API is down; 1 slow, 1 in maintenance. Everything else is working.');
  });

  it('shows the 90- and 30-day uptime of each component, and "—" without checks', async () => {
    const response = await get({ groups: [{ name: 'Campus', monitors: [
      monitor('Corner bakery website', {
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        firstCheckAt: new Date('2026-11-19T00:00:00.000Z'),
        incidents: [{ startedAt: new Date('2026-10-10T11:08:00.000Z'), resolvedAt: new Date('2026-10-10T11:46:00.000Z') }],
      }),
      monitor('Library seat map', NO_CHECKS),
    ] }] });
    const uptimes = [...response.body.matchAll(/<span class="num">([^<]*)<\/span><span class="label">uptime, (\d+) days<\/span>/g)]
      .map((m) => `${m[2]}:${m[1]}`);

    expect(uptimes).toEqual(['90:99.97%', '30:100.00%', '90:—', '30:—']);
    expect(response.body).not.toContain('uptime over 90 days');
  });

  describe('incidents (D-014)', () => {
    const at = (iso: string) => new Date(`${iso}Z`);
    const active = (updates: { stage: 'investigating' | 'identified' | 'monitoring' | 'resolved'; body: string; createdAt: Date }[]) =>
      monitor('Bookings API', { incidents: [{ startedAt: at('2026-11-26T14:02:00'), resolvedAt: null, cause: 'timeout', updates }] });

    it('shows an active incident with its updates, newest first, and the newest stage on top', async () => {
      const response = await get({ groups: [{ name: 'Campus', monitors: [active([
        { stage: 'identified', body: 'The hosting provider confirmed a failed storage volume.', createdAt: at('2026-11-26T14:31:00') },
        { stage: 'investigating', body: 'Requests to the Bookings API time out.', createdAt: at('2026-11-26T14:09:00') },
      ])] }] });
      const body = response.body;

      expect(body).toContain('Active incident · Identified');
      expect(body).toContain('<h2 id="active-title-0">Bookings API timed out</h2>');
      expect(body).toContain('Affects Bookings API · Started <time datetime="2026-11-26T14:02:00.000Z">14:02 UTC</time> · Down for <span class="num">53 min</span>');
      expect(body).toContain('Updates (2)');
      expect(body.indexOf('failed storage volume')).toBeLessThan(body.indexOf('Requests to the Bookings API time out'));
      expect(body).toContain('<time datetime="2026-11-26T14:31:00.000Z">14:31 UTC</time>');
    });

    it('shows an active incident without updates as such, with no written text', async () => {
      const body = (await get({ groups: [{ name: 'Campus', monitors: [active([])] }] })).body;

      expect(body).toContain('<p class="eyebrow">Active incident</p>');
      expect(body).toContain('No updates yet.');
      expect(body).not.toContain('class="timeline"');
    });

    it('lists past incidents by day, newest first, with how long they lasted and their latest update', async () => {
      const response = await get({ groups: [{ name: 'Campus', monitors: [monitor('Corner bakery website', { incidents: [
        { startedAt: at('2026-11-18T11:08:00'), resolvedAt: at('2026-11-18T11:46:00'), cause: 'http_5xx', updates: [
          { stage: 'resolved', body: 'The site is back.', createdAt: at('2026-11-18T11:46:00') },
          { stage: 'investigating', body: 'The website does not load.', createdAt: at('2026-11-18T11:08:00') },
        ] },
        { startedAt: at('2026-11-24T09:12:00'), resolvedAt: at('2026-11-24T09:37:00'), cause: 'timeout', updates: [] },
      ] })] }] });
      const body = response.body;

      expect(body).toContain('<h2 id="past-title">Past incidents</h2>');
      expect(body).toContain('Last 90 days, newest first');
      const past = body.slice(body.indexOf('id="past-title"'));
      expect(past.indexOf('Tue 24 Nov 2026')).toBeLessThan(past.indexOf('Wed 18 Nov 2026'));
      expect(body).toContain('Resolved · Lasted <span class="num">38 min</span> · Affects Corner bakery website');
      expect(body).toContain('<p>The site is back.</p>');
      expect(body).toContain('Show all 2 updates');
      expect(count(body, 'class="past"')).toBe(2);
    });

    it('says so when there were no incidents in the last 90 days', async () => {
      const body = (await get({ groups: [{ name: 'Campus', monitors: [monitor('Corner bakery website')] }] })).body;

      expect(body).toContain('No incidents in the last 90 days.');
      expect(body).not.toContain('Active incident');
    });

    it('escapes the text of an update', async () => {
      const body = (await get({ groups: [{ name: 'Campus', monitors: [active([
        { stage: 'investigating', body: '<img src=x onerror=alert(1)>', createdAt: at('2026-11-26T14:09:00') },
      ])] }] })).body;

      expect(body).not.toContain('<img src=x');
      expect(body).toContain('&lt;img src=x onerror=alert(1)&gt;');
    });
  });

  it('shows a new incident update within 30 seconds of a status version bump, and not before (Q-007)', async () => {
    const clock = new FakeClock(NOW);
    let version = 1;
    const updates: { stage: 'investigating'; body: string; createdAt: Date }[] = [];
    const load = async (): Promise<StatusData> => ({ groups: [{ name: 'Campus', monitors: [monitor('Bookings API', {
      incidents: [{ startedAt: new Date('2026-11-26T14:02:00.000Z'), resolvedAt: null, cause: 'timeout', updates: [...updates] }],
    })] }] });
    app = buildApp({}, { clock, status: { load, readVersion: async () => version } });
    const page = async () => (await app!.inject({ method: 'GET', url: '/status' })).body;

    expect(await page()).toContain('No updates yet.');
    updates.push({ stage: 'investigating', body: 'We are looking at the API.', createdAt: NOW });
    clock.advance(30_000);
    expect(await page()).not.toContain('We are looking at the API.');
    version += 1;
    clock.advance(30_000);
    expect(await page()).toContain('We are looking at the API.');
  });

  it('serves a cached page without loading the data again, in under 100 ms', async () => {
    let loads = 0;
    const data: StatusData = { groups: [{ name: 'Campus', monitors: [monitor('Bookings API')] }] };
    await get(async () => { loads += 1; return data; });

    const started = performance.now();
    const response = await app!.inject({ method: 'GET', url: '/status' });
    const elapsedMs = performance.now() - started;

    expect(response.statusCode).toBe(200);
    expect(loads).toBe(1);
    expect(elapsedMs).toBeLessThan(100);
  });

  it('escapes text from the database', async () => {
    const response = await get({ groups: [{ name: '<b>Org</b>', monitors: [monitor('<script>alert(1)</script>')] }] });

    expect(response.body).not.toContain('<script>alert(1)</script>');
    expect(response.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(response.body).not.toContain('<b>Org</b>');
  });

  it('answers 503 with the error state when the database fails and nothing is cached', async () => {
    const response = await get(async () => { throw new Error('connect ECONNREFUSED'); });

    expect(response.statusCode).toBe(503);
    expect(h1(response.body)).toBe('Status could not load');
    expect(response.body).not.toContain('ECONNREFUSED');
  });

  it('has a theme toggle next to the product name that saves the choice (D-024)', async () => {
    const response = await get({ groups: [] });
    const body = response.body;

    expect(body).toMatch(/<div class="brand-group">\s*<a class="brand" href="#top"[^>]*>[\s\S]*?<\/a>\s*<button class="icon-btn theme-btn" type="button" id="theme-btn" aria-label="Switch to dark theme">/);
    expect(body).toContain("localStorage.getItem('theme')");
    expect(body).toContain("localStorage.setItem('theme'");
    expect(body).toContain("matchMedia('(prefers-color-scheme: dark)')");
  });

  it('links Status to the top and API and the API docs pill to the footer section', async () => {
    const body = (await get({ groups: [] })).body;

    expect(body).toContain('<a class="nav-link" href="#top" aria-current="page">Status</a>');
    expect(body).toContain('<a class="nav-link" href="#api-docs">API</a>');
    expect(body).toContain('<a class="pill" href="#api-docs">API docs</a>');
    expect(body).toMatch(/<footer class="site-footer" id="api-docs"/);
  });

  it('keeps the header and theme toggle on the error page', async () => {
    const body = (await get(async () => { throw new Error('down'); })).body;

    expect(body).toContain('id="theme-btn"');
    expect(body).toContain('<a class="pill" href="#api-docs">API docs</a>');
  });

  it('is not registered without a status source', async () => {
    app = buildApp();

    const response = await app.inject({ method: 'GET', url: '/status' });

    expect(response.statusCode).toBe(404);
  });
});
