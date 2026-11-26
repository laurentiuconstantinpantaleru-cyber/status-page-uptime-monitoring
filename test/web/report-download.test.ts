import { afterEach, describe, expect, it } from 'vitest';
import { ORG_A, ORG_B, get, harness, signIn, type Harness } from './admin-fake.js';

// Downloading a monthly report (D-019, D-041): org admins of the organization and global admins,
// closed UTC months only. NOW in the harness is 26 Nov 2026, so October is the last closed month.

let h: Harness | undefined;
afterEach(async () => {
  await h?.app.close();
  h = undefined;
});

describe('GET /admin/reports/:org_id/:month.pdf', () => {
  it('sends the PDF as a download named after the month', async () => {
    h = harness();
    const response = await get(h.app, `/admin/reports/${ORG_A}/2026-10.pdf`, await signIn(h.app, 'orgAdmin'));

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.headers['content-disposition']).toBe('attachment; filename="uptime-report-2026-10.pdf"');
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body).toBe(`%PDF-fake ${ORG_A} 2026-10`);
    expect(h.reports.asked).toEqual([{ orgId: ORG_A, year: 2026, month: 10 }]);
  });

  it('a global admin downloads any organization\'s report', async () => {
    h = harness();
    const response = await get(h.app, `/admin/reports/${ORG_B}/2025-01.pdf`, await signIn(h.app, 'global'));

    expect(response.statusCode).toBe(200);
    expect(h.reports.asked).toEqual([{ orgId: ORG_B, year: 2025, month: 1 }]);
  });

  it.each([
    ['the current month', `${ORG_A}/2026-11.pdf`],
    ['a future month', `${ORG_A}/2027-01.pdf`],
    ['an unknown organization', '99/2026-10.pdf'],
    ['month 13', `${ORG_A}/2026-13.pdf`],
    ['month 00', `${ORG_A}/2026-00.pdf`],
    ['no .pdf', `${ORG_A}/2026-10`],
    ['another format', `${ORG_A}/2026-10.csv`],
    ['a short month', `${ORG_A}/2026-1.pdf`],
    ['an organization id that is not a number', 'abc/2026-10.pdf'],
  ])('%s gets 404', async (_, path) => {
    h = harness();
    const response = await get(h.app, `/admin/reports/${path}`, await signIn(h.app, 'global'));

    expect(response.statusCode).toBe(404);
  });

  it('nothing is made for a request that is refused', async () => {
    h = harness();
    await get(h.app, `/admin/reports/${ORG_A}/2026-10.pdf`, await signIn(h.app, 'member'));
    await get(h.app, `/admin/reports/${ORG_A}/2026-10.pdf`, await signIn(h.app, 'otherAdmin'));
    await get(h.app, `/admin/reports/${ORG_A}/2026-11.pdf`, await signIn(h.app, 'orgAdmin'));

    expect(h.reports.asked).toEqual([]);
  });
});
