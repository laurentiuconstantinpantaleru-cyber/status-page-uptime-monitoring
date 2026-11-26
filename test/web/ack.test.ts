import { afterEach, describe, expect, it } from 'vitest';
import { ACK_TOKEN, ACK_TOKEN_RESOLVED, HOST, INCIDENT_A, NOW, USERS, fakeAdmin, get, harness, post, signIn, type Harness } from './admin-fake.js';

// Acknowledging an incident (D-007, D-044): from an alert's link (DS-p26-ack) and from the
// incidents page (DS-p26-admin-incidents). GET never acknowledges: mail scanners open links.

let h: Harness | undefined;
afterEach(async () => {
  await h?.app.close();
  h = undefined;
});

const OPEN = {
  id: INCIDENT_A, organizationId: 1, monitor: 'Bookings API', cause: 'timeout',
  startedAt: new Date('2026-11-26T14:02:00.000Z'), resolvedAt: null, updates: [],
};

describe('GET /ack/:token (DS-p26-ack)', () => {
  it('shows the incident and a button that posts, and acknowledges nothing', async () => {
    h = harness();
    const response = await get(h.app, `/ack/${ACK_TOKEN}`);

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-robots-tag']).toBe('noindex');
    expect(response.body).toContain('<h1 id="ack-title">Acknowledge incident</h1>');
    expect(response.body).toContain('<h2>Bookings API timed out</h2>');
    expect(response.body).toContain('Campus projects · down since <span class="num">14:02 UTC</span> · <span class="num">53 min</span>');
    expect(response.body).toContain(`<form method="post" action="/ack/${ACK_TOKEN}"><button class="submit" type="submit">Acknowledge</button></form>`);
    expect(h.ack.acks).toEqual([]);
  });

  it('after posting: says it was acknowledged, and when', async () => {
    h = harness();
    const response = await post(h.app, `/ack/${ACK_TOKEN}`, {});

    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe(`/ack/${ACK_TOKEN}?done=1`);
    expect(h.ack.acks).toEqual([{ incidentId: INCIDENT_A, at: NOW }]);

    const page = await get(h.app, `/ack/${ACK_TOKEN}?done=1`);
    expect(page.body).toContain('<strong>Acknowledged at 14:55 UTC.</strong>The secondary contacts will not be alerted.');
    expect(page.body).not.toContain('<form method="post"');
  });

  it('a second post changes nothing; the page says who acknowledged it first', async () => {
    h = harness();
    const i = [...h.ack.incidents.values()][0];
    i.acknowledgedAt = new Date('2026-11-26T14:12:00.000Z');
    i.acknowledgedBy = 'Andrei Admin';

    expect((await post(h.app, `/ack/${ACK_TOKEN}`, {})).statusCode).toBe(303);
    expect(h.ack.acks).toEqual([]);
    const page = await get(h.app, `/ack/${ACK_TOKEN}`);
    expect(page.body).toContain('<strong>Already acknowledged at 14:12 UTC by Andrei Admin.</strong>');
  });

  it('acknowledged through a link: says so instead of a name', async () => {
    h = harness();
    [...h.ack.incidents.values()][0].acknowledgedAt = new Date('2026-11-26T14:12:00.000Z');

    expect((await get(h.app, `/ack/${ACK_TOKEN}`)).body).toContain('<strong>Already acknowledged at 14:12 UTC through an alert link.</strong>');
  });

  it('a resolved incident has nothing to acknowledge', async () => {
    h = harness();
    const response = await get(h.app, `/ack/${ACK_TOKEN_RESOLVED}`);

    expect(response.body).toContain('This incident is resolved: the monitor is up again. There is nothing to acknowledge.');
    expect(response.body).not.toContain('<form method="post"');
    expect((await post(h.app, `/ack/${ACK_TOKEN_RESOLVED}`, {})).statusCode).toBe(303);
    expect(h.ack.acks).toEqual([]);
  });

  it.each(['b'.repeat(43), 'short', `${'a'.repeat(42)}%27`, 'a'.repeat(44)])('an unknown or malformed token (%s) is 404 with a way on', async (token) => {
    h = harness();
    const response = await get(h.app, `/ack/${token}`);

    expect(response.statusCode).toBe(404);
    expect(response.body).toContain('<h1 id="ack-title">This link does not work</h1>');
    expect((await post(h.app, `/ack/${token}`, {})).statusCode).toBe(404);
    expect(h.ack.acks).toEqual([]);
  });

  it('a post from another site is refused (D-040)', async () => {
    h = harness();
    const response = await h.app.inject({
      method: 'POST', url: `/ack/${ACK_TOKEN}`,
      headers: { host: HOST, origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' }, payload: '',
    });

    expect(response.statusCode).toBe(403);
    expect(h.ack.acks).toEqual([]);
  });

  it('the incident name stays text (XSS)', async () => {
    h = harness();
    [...h.ack.incidents.values()][0].monitor = '<img src=x onerror=alert(1)>';

    const body = (await get(h.app, `/ack/${ACK_TOKEN}`)).body;
    expect(body).not.toContain('<img src=x');
    expect(body).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('Acknowledge on /admin/incidents (DS-p26-admin-incidents)', () => {
  it('an open incident nobody acknowledged has the button; a member acknowledges it', async () => {
    h = harness({ admin: fakeAdmin({ incidents: [{ ...OPEN }] }) });
    const cookie = await signIn(h.app, 'member');

    const page = await get(h.app, '/admin/incidents', cookie);
    expect(page.body).toContain(
      `<form method="post" action="/admin/incidents/${INCIDENT_A}/ack"><button class="pill" type="submit">Acknowledge<span class="visually-hidden"> Bookings API timed out</span></button></form>`,
    );
    expect(page.body).toContain('Tells the others you are on it and stops the escalation to the secondary contacts.');

    const response = await post(h.app, `/admin/incidents/${INCIDENT_A}/ack`, {}, cookie);
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe(`/admin/incidents?acked=${INCIDENT_A}#incident-${INCIDENT_A}`);
    expect(h.admin.acks).toEqual([{ incidentId: INCIDENT_A, userId: USERS.member.id, at: NOW }]);

    const after = await get(h.app, `/admin/incidents?acked=${INCIDENT_A}`, cookie);
    expect(after.body).toContain('<p class="acked" role="status">');
    expect(after.body).toContain('<span>Acknowledged by you at 14:55 UTC.</span>');
    expect(after.body).not.toContain(`action="/admin/incidents/${INCIDENT_A}/ack"`);
  });

  it('acknowledged by someone else, or through a link: says who and when', async () => {
    h = harness({ admin: fakeAdmin({ incidents: [
      { ...OPEN, acknowledged: { at: new Date('2026-11-26T14:12:00.000Z'), byUserId: USERS.orgAdmin.id, by: 'Andrei Admin' } },
      { ...OPEN, id: 42, acknowledged: { at: new Date('2026-11-26T14:20:00.000Z'), byUserId: null, by: null } },
    ] }) });
    const page = await get(h.app, '/admin/incidents', await signIn(h.app, 'member'));

    expect(page.body).toContain('<p class="acked" role="note">');
    expect(page.body).toContain('<span>Acknowledged by Andrei Admin at 14:12 UTC.</span>');
    expect(page.body).toContain('<span>Acknowledged through an alert link at 14:20 UTC.</span>');
    expect(page.body).not.toContain('/ack"');
  });

  it('a resolved incident has no button, and acknowledging it changes nothing', async () => {
    h = harness({ admin: fakeAdmin({ incidents: [{ ...OPEN, resolvedAt: new Date('2026-11-26T14:40:00.000Z') }] }) });
    const cookie = await signIn(h.app, 'member');

    expect((await get(h.app, '/admin/incidents', cookie)).body).not.toContain('/ack"');
    expect((await post(h.app, `/admin/incidents/${INCIDENT_A}/ack`, {}, cookie)).statusCode).toBe(303);
    expect(h.admin.acks).toEqual([]);
  });

  it('without Origin it is refused like every form (D-040)', async () => {
    h = harness({ admin: fakeAdmin({ incidents: [{ ...OPEN }] }) });
    const cookie = await signIn(h.app, 'member');
    const response = await h.app.inject({
      method: 'POST', url: `/admin/incidents/${INCIDENT_A}/ack`,
      headers: { host: HOST, cookie, 'content-type': 'application/x-www-form-urlencoded' }, payload: '',
    });

    expect(response.statusCode).toBe(403);
    expect(h.admin.acks).toEqual([]);
  });
});
