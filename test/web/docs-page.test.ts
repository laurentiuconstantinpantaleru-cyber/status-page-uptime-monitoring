import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/web/app.js';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function get(url: string) {
  app = buildApp();
  return app.inject({ method: 'GET', url });
}

const SECTIONS = ['checks', 'incidents', 'maintenance', 'uptime', 'alerts'];
const sectionsIn = (html: string) => SECTIONS.filter((id) => html.includes(`<section class="doc" id="${id}"`));

describe('GET /docs', () => {
  it('renders all five sections with sidebar anchors', async () => {
    const response = await get('/docs');

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/html/);
    expect(response.body).toContain('<h1>How monitoring works</h1>');
    expect(sectionsIn(response.body)).toEqual(SECTIONS);
    for (const id of SECTIONS) expect(response.body).toContain(`<a href="#${id}">`);
  });

  it('marks Docs as the current page, links Status to /status and has the theme toggle', async () => {
    const body = (await get('/docs')).body;

    expect(body).toContain('<a class="nav-link" href="/docs" aria-current="page">Docs</a>');
    expect(body).toContain('<a class="nav-link" href="/status">Status</a>');
    expect(body).toContain('id="theme-btn"');
    expect(body).toContain('<a href="/status">Back to the status page</a>');
  });

  it('has a search form that sends the term to the server', async () => {
    const body = (await get('/docs')).body;

    expect(body).toMatch(/<form class="search" role="search" method="get" action="\/docs#results">/);
    expect(body).toContain('<input id="q" name="q" type="search"');
  });

  it('shows only the matching section, highlighted, with a count', async () => {
    const body = (await get('/docs?q=escalation')).body;

    expect(sectionsIn(body)).toEqual(['alerts']);
    expect(body).toContain('<mark>escalation</mark>');
    expect(body).toContain('1 section matches');
    expect(body).toContain('value="escalation"');
    expect(body).not.toContain('<a href="#checks">');
  });

  it('says so when nothing matches and offers to clear the search', async () => {
    const body = (await get('/docs?q=kubernetes')).body;

    expect(sectionsIn(body)).toEqual([]);
    expect(body).toContain('No section matches');
    expect(body).toContain('<a href="/docs">clear the search</a>');
  });

  it('escapes the search term', async () => {
    const body = (await get('/docs?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E')).body;

    expect(body).not.toContain('<script>alert(1)</script>');
    expect(body).toContain('value="&lt;script&gt;alert(1)&lt;/script&gt;"');
  });

  it('includes no script other than the theme toggle (D-024)', async () => {
    const body = (await get('/docs')).body;
    const scripts = body.match(/<script>[\s\S]*?<\/script>/g) ?? [];

    expect(scripts).toHaveLength(2);
    for (const s of scripts) expect(s).toMatch(/Theme/);
  });
});
