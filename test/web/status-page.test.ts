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
