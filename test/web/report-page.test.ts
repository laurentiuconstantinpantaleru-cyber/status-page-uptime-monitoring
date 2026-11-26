import { afterEach, describe, expect, it } from 'vitest';
import { reportMonths, type ReportOrg } from '../../src/web/reports/months.js';
import { ORG_A, ORG_B, get, harness, signIn, type Harness } from './admin-fake.js';

// The monthly reports page (DS-p26-admin-reports, D-041, D-042). NOW in the harness is
// 26 Nov 2026 14:55 UTC, so October 2026 is the newest closed month.

const NOW = new Date('2026-11-26T14:55:00.000Z');
const org = (over: Partial<ReportOrg> = {}): ReportOrg => ({
  id: ORG_A, name: 'Campus projects', createdAt: new Date('2026-08-15T09:00:00.000Z'), reports: [], ...over,
});

describe('reportMonths', () => {
  it('lists every closed month since the organization was added, newest first', () => {
    expect(reportMonths(org(), NOW).map((m) => m.key)).toEqual(['2026-10', '2026-09', '2026-08']);
    expect(reportMonths(org(), NOW)[0]).toMatchObject({ year: 2026, month: 10, title: 'October 2026', href: `/admin/reports/${ORG_A}/2026-10.pdf` });
  });

  it('crosses the new year', () => {
    const months = reportMonths(org({ createdAt: new Date('2025-11-30T23:00:00.000Z') }), new Date('2026-02-01T00:00:00.000Z'));
    expect(months.map((m) => m.key)).toEqual(['2026-01', '2025-12', '2025-11']);
  });

  it('an organization added this month has no closed month yet', () => {
    expect(reportMonths(org({ createdAt: new Date('2026-11-01T00:00:00.000Z') }), NOW)).toEqual([]);
  });

  it('says how each month was sent', () => {
    const months = reportMonths(org({
      reports: [
        { month: '2026-10', emailedAt: null, emailedTo: null, lastError: 'SMTP 421' },
        { month: '2026-09', emailedAt: new Date('2026-10-01T00:00:05.000Z'), emailedTo: 2, lastError: null },
        { month: '2026-08', emailedAt: null, emailedTo: null, lastError: null },
      ],
    }), new Date('2026-12-02T00:00:00.000Z'));

    expect(months.map((m) => m.state)).toEqual([
      { kind: 'ondemand' }, // November: not stored
      { kind: 'failed' },
      { kind: 'emailed', at: new Date('2026-10-01T00:00:05.000Z'), to: 2 },
      { kind: 'waiting' },
    ]);
  });
});

let h: Harness | undefined;
afterEach(async () => {
  await h?.app.close();
  h = undefined;
});

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe('GET /admin/reports (DS-p26-admin-reports)', () => {
  it('shows an org admin the closed months of their organization, each with how it was sent and a download', async () => {
    h = harness();
    const response = await get(h.app, '/admin/reports', await signIn(h.app, 'orgAdmin'));

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<h1>Monthly reports</h1>');
    expect(response.body).toContain('<p class="org">Campus projects</p>');
    expect(response.body).not.toContain('Local businesses');
    expect(count(response.body, 'class="month"')).toBe(3);
    expect(response.body).toContain('<h3>October 2026</h3>');
    expect(response.body).toContain('Not emailed yet: the mail server did not take it. It is tried again every hour.');
    expect(response.body).toContain('Emailed to 2 org admins on 1 Oct 2026, 00:00 UTC.');
    expect(response.body).toContain('Made when you download it. Months before reports existed were not emailed.');
    expect(response.body).toContain(
      `<a class="pill download" href="/admin/reports/${ORG_A}/2026-10.pdf" download>Download PDF<span class="visually-hidden"> for Campus projects, October 2026</span></a>`,
    );
  });

  it('a month stored but not emailed and without an error says it waits', async () => {
    h = harness();
    h.reports.orgs[0].reports = [{ month: '2026-10', emailedAt: null, emailedTo: null, lastError: null }];
    const response = await get(h.app, '/admin/reports', await signIn(h.app, 'orgAdmin'));

    expect(response.body).toContain('Not emailed yet. It is tried again every hour.');
  });

  it('one org admin is "1 org admin"', async () => {
    h = harness();
    h.reports.orgs[0].reports = [{ month: '2026-10', emailedAt: new Date('2026-11-01T00:00:00.000Z'), emailedTo: 1, lastError: null }];
    const response = await get(h.app, '/admin/reports', await signIn(h.app, 'orgAdmin'));

    expect(response.body).toContain('Emailed to 1 org admin on 1 Nov 2026, 00:00 UTC.');
  });

  it('shows a global admin every organization under its name', async () => {
    h = harness();
    const response = await get(h.app, '/admin/reports', await signIn(h.app, 'global'));

    expect(response.body).toContain('<p class="org">All organizations</p>');
    expect(response.body).toContain('<h2>Campus projects</h2>');
    expect(response.body).toContain('<h2>Local businesses</h2>');
    expect(response.body).toContain(`href="/admin/reports/${ORG_B}/2026-10.pdf"`);
  });

  it('more than 12 months: the older ones are folded away', async () => {
    h = harness();
    h.reports.orgs[0].createdAt = new Date('2025-08-01T00:00:00.000Z');
    const response = await get(h.app, '/admin/reports', await signIn(h.app, 'orgAdmin'));

    expect(count(response.body, 'class="month"')).toBe(15);
    expect(response.body).toContain('<details class="older"><summary>Older months (3)</summary>');
  });

  it('an organization added this month: no month yet, and when the first report comes', async () => {
    h = harness();
    h.reports.orgs[0].createdAt = new Date('2026-11-10T00:00:00.000Z');
    const response = await get(h.app, '/admin/reports', await signIn(h.app, 'orgAdmin'));

    expect(response.body).toContain('No month has ended since this organization was added. The first report comes by email on 1 December 2026.');
    expect(count(response.body, 'class="month"')).toBe(0);
  });

  it('names stay text (XSS)', async () => {
    h = harness();
    h.reports.orgs[0].name = '<script>alert(1)</script>';
    const response = await get(h.app, '/admin/reports', await signIn(h.app, 'orgAdmin'));

    expect(response.body).not.toContain('<script>alert(1)</script>');
    expect(response.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('a database failure gets 503 with a message', async () => {
    h = harness();
    h.reports.fail = true;
    const response = await get(h.app, '/admin/reports', await signIn(h.app, 'orgAdmin'));

    expect(response.statusCode).toBe(503);
    expect(response.body).toContain('The reports could not load.');
  });

  it('one organization: the months have their own h2, so the outline goes h1, h2, h3', async () => {
    h = harness();
    const response = await get(h.app, '/admin/reports', await signIn(h.app, 'orgAdmin'));

    expect(response.body).toContain('<section class="section" aria-labelledby="months-title"><h2 id="months-title" class="visually-hidden">Months</h2>');
    expect(response.body).not.toContain('aria-label="Months"');
  });

  it('header: Reports is current', async () => {
    h = harness();
    const response = await get(h.app, '/admin/reports', await signIn(h.app, 'orgAdmin'));

    expect(response.body).toContain('<a class="nav-link" href="/admin/reports" aria-current="page">Reports</a>');
  });
});

describe('the Reports link in the admin header (D-042)', () => {
  it.each(['orgAdmin', 'global'] as const)('%s sees it on the dashboard and the incidents page', async (who) => {
    h = harness();
    const cookie = await signIn(h.app, who);

    for (const url of ['/admin/monitors', '/admin/incidents']) {
      expect((await get(h.app, url, cookie)).body).toContain('<a class="nav-link" href="/admin/reports">Reports</a>');
    }
  });

  it('a member, who cannot download reports, does not see it', async () => {
    h = harness();
    const cookie = await signIn(h.app, 'member');

    for (const url of ['/admin/monitors', '/admin/incidents']) {
      expect((await get(h.app, url, cookie)).body).not.toContain('href="/admin/reports"');
    }
  });
});
