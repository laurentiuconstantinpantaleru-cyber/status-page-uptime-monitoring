import { afterEach, describe, expect, it } from 'vitest';
import { MONITOR_A, ORG_A, fakeAdmin, get, harness, post, signIn, USERS, type Harness } from './admin-fake.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.app.close();
  h = undefined;
});

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe('GET /admin/monitors (DS-p26-admin-monitors, D-037)', () => {
  it('shows a member the monitors of their organization, with maintenance but no admin actions', async () => {
    h = harness();
    const response = await get(h.app, '/admin/monitors', await signIn(h.app, 'member'));

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<h1>Monitors</h1>');
    expect(response.body).toContain('<p class="org">Campus projects</p>');
    expect(count(response.body, 'class="mon"')).toBe(1);
    expect(response.body).toContain('<strong>Bookings API</strong><code>https://api.bookings.example/health</code>');
    expect(response.body).toContain('<span>Down</span>');
    expect(response.body).toContain('Every <span class="num">1 min</span> · Last check: <span class="num">14:54 UTC</span> · no answer');
    expect(response.body).not.toContain('Hug The Mug');
    expect(count(response.body, `action="/admin/monitors/${MONITOR_A}/maintenance"`)).toBe(3);
    expect(response.body).toContain('<button type="submit" name="minutes" value="30">30 minutes</button>');
    expect(response.body).not.toContain('/delete');
    expect(response.body).not.toContain('Add monitor');
    expect(response.body).not.toContain('>Edit<');
  });

  it('shows an org admin Delete, and Add and Edit as coming soon', async () => {
    h = harness();
    const response = await get(h.app, '/admin/monitors', await signIn(h.app, 'orgAdmin'));

    expect(response.body).toContain(`<a class="pill" href="/admin/monitors/${MONITOR_A}/delete">Delete<span class="visually-hidden"> Bookings API</span></a>`);
    expect(response.body).toContain('<button class="pill pill-primary" type="button" disabled>Add monitor<span class="visually-hidden"> (coming soon)</span></button>');
    expect(response.body).toContain('<button class="pill" type="button" disabled>Edit<span class="visually-hidden"> Bookings API (coming soon)</span></button>');
  });

  it('shows a global admin every organization under its name', async () => {
    h = harness();
    const response = await get(h.app, '/admin/monitors', await signIn(h.app, 'global'));

    expect(response.body).toContain('<p class="org">All organizations</p>');
    expect(response.body).toContain('<h2 class="group-name">Campus projects</h2>');
    expect(response.body).toContain('<h2 class="group-name">Local businesses</h2>');
    expect(count(response.body, 'class="mon"')).toBe(2);
    expect(response.body).toContain('Last check: <span class="num">14:50 UTC</span> · <span class="num">182 ms</span>');
  });

  it('header: Dashboard is current, Incidents is linked, Log out replaces Login', async () => {
    h = harness();
    const response = await get(h.app, '/admin/monitors', await signIn(h.app, 'member'));

    expect(response.body).toContain('<a class="nav-link" href="/admin/monitors" aria-current="page">Dashboard</a>');
    expect(response.body).toContain('<a class="nav-link" href="/admin/incidents">Incidents</a>');
    expect(response.body).toContain('<form method="post" action="/logout"><button class="pill" type="submit">Log out</button></form>');
    expect(response.body).not.toContain('href="/login"');
  });

  it('empty: says what will appear', async () => {
    h = harness({ admin: fakeAdmin({ groups: [] }) });
    const response = await get(h.app, '/admin/monitors', await signIn(h.app, 'member'));

    expect(response.body).toContain('No monitors yet.');
    expect(count(response.body, 'class="mon"')).toBe(0);
  });

  it('error: 503 with a way to try again', async () => {
    h = harness();
    h.admin.fail.monitors = true;
    const response = await get(h.app, '/admin/monitors', await signIn(h.app, 'member'));

    expect(response.statusCode).toBe(503);
    expect(response.body).toContain('Monitors could not load because the server did not answer. Try again in a moment.');
    expect(response.body).toContain('<a class="btn" href="/admin/monitors">Try again</a>');
  });

  it('escapes monitor names and URLs (XSS)', async () => {
    h = harness({
      admin: fakeAdmin({
        groups: [{
          organizationId: ORG_A, organization: '<b>Org</b>',
          monitors: [{ id: MONITOR_A, name: '<img src=x onerror=alert(1)>', url: 'javascript:alert("x")', intervalMinutes: 5, status: 'ok', lastCheck: null }],
        } as never],
      }),
    });
    const response = await get(h.app, '/admin/monitors', await signIn(h.app, 'orgAdmin'));

    expect(response.body).not.toContain('<img src=x');
    expect(response.body).not.toContain('<b>Org</b>');
    expect(response.body).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(response.body).toContain('javascript:alert(&quot;x&quot;)');
    expect(response.body).toContain('No checks yet');
  });

  it('shows what the last action did', async () => {
    h = harness();
    const cookie = await signIn(h.app, 'member');

    const started = await get(h.app, `/admin/monitors?started=${MONITOR_A}&minutes=30`, cookie);
    expect(started.body).toContain('<p class="live" role="status">Maintenance started for Bookings API: alerts paused for 30 minutes.</p>');
    const deleted = await get(h.app, '/admin/monitors?deleted=%3Cscript%3Ex%3C%2Fscript%3E', cookie);
    expect(deleted.body).toContain('&lt;script&gt;x&lt;/script&gt; was deleted.');
  });
});

describe('POST /admin/monitors/:id/maintenance (D-012, D-037)', () => {
  it.each(['15', '30', '60'])('starts %s minutes of quick maintenance as the signed-in user', async (minutes) => {
    h = harness();
    const response = await post(h.app, `/admin/monitors/${MONITOR_A}/maintenance`, { minutes }, await signIn(h.app, 'member'));

    expect(response.statusCode).toBe(303);
    expect(h.admin.maintenance).toEqual([{ monitorId: MONITOR_A, minutes: Number(minutes), userId: USERS.member.id }]);
  });

  it.each(['', '10', '45', '15; DROP TABLE monitors', '1e1'])('refuses minutes=%j with 400', async (minutes) => {
    h = harness();
    const response = await post(h.app, `/admin/monitors/${MONITOR_A}/maintenance`, { minutes }, await signIn(h.app, 'member'));

    expect(response.statusCode).toBe(400);
    expect(h.admin.maintenance).toEqual([]);
  });
});

describe('delete with a confirmation page (D-037)', () => {
  it('asks first, naming what goes with the monitor', async () => {
    h = harness();
    const response = await get(h.app, `/admin/monitors/${MONITOR_A}/delete`, await signIn(h.app, 'orgAdmin'));

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<h1>Delete monitor?</h1>');
    expect(response.body).toContain('Delete Bookings API? Its checks, incidents and maintenance windows are deleted too. This cannot be undone.');
    expect(response.body).toContain(`<form method="post" action="/admin/monitors/${MONITOR_A}/delete">`);
    expect(response.body).toContain('<a class="pill" href="/admin/monitors">Cancel</a>');
    expect(h.admin.deleted).toEqual([]);
  });

  it('deletes on POST and goes back to the list', async () => {
    h = harness();
    const response = await post(h.app, `/admin/monitors/${MONITOR_A}/delete`, {}, await signIn(h.app, 'orgAdmin'));

    expect(response.statusCode).toBe(303);
    expect(h.admin.deleted).toEqual([MONITOR_A]);
  });
});
