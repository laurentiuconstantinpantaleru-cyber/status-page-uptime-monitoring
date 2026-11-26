import { afterEach, describe, expect, it } from 'vitest';
import { parseUpdate } from '../../src/web/admin/incidents.js';
import { renderStatusPage } from '../../src/web/status/render.js';
import { INCIDENT_A, NOW, ORG_A, USERS, fakeAdmin, get, harness, post, signIn, type Harness } from './admin-fake.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.app.close();
  h = undefined;
});

const count = (html: string, needle: string) => html.split(needle).length - 1;
const RESOLVED = {
  id: 37, organizationId: ORG_A, monitor: 'Hug The Mug', cause: 'connection',
  startedAt: new Date('2026-11-24T09:08:00.000Z'), resolvedAt: new Date('2026-11-24T09:20:00.000Z'),
  updates: [{ stage: 'resolved' as const, body: 'The provider fixed a network fault.', createdAt: new Date('2026-11-24T09:20:00.000Z') }],
};
const OPEN_NO_UPDATES = {
  id: 42, organizationId: ORG_A, monitor: 'Campus events app', cause: 'http_5xx',
  startedAt: new Date('2026-11-26T14:40:00.000Z'), resolvedAt: null, updates: [],
};

describe('parseUpdate (D-038)', () => {
  it('accepts the four stages and 1–2000 characters after trimming', () => {
    for (const stage of ['investigating', 'identified', 'monitoring', 'resolved']) {
      expect(parseUpdate({ stage, body: '  Looking into it.  ' })).toEqual({ ok: true, stage, body: 'Looking into it.' });
    }
    expect(parseUpdate({ stage: 'identified', body: 'x'.repeat(2000) })).toMatchObject({ ok: true });
    expect(parseUpdate({ stage: 'identified', body: 'ț'.repeat(2000) })).toMatchObject({ ok: true });
  });

  it.each([
    [{ body: 'x' }, { stage: 'Choose a stage.' }],
    [{ stage: 'fixed', body: 'x' }, { stage: 'Choose a stage.' }],
    [{ stage: "identified' OR '1'='1", body: 'x' }, { stage: 'Choose a stage.' }],
    [{ stage: 'identified', body: '   ' }, { body: 'Write the update before posting.' }],
    [{ stage: 'identified' }, { body: 'Write the update before posting.' }],
    [{ stage: 'identified', body: 'x'.repeat(2001) }, { body: 'Shorten the update to 2000 characters or fewer.' }],
    [{}, { stage: 'Choose a stage.', body: 'Write the update before posting.' }],
  ])('refuses %j', (fields, errors) => {
    expect(parseUpdate(fields)).toEqual({ ok: false, errors });
  });
});

describe('GET /admin/incidents (DS-p26-admin-incidents, D-038)', () => {
  it('lists open incidents with their updates and a form, then the resolved ones', async () => {
    h = harness({ admin: fakeAdmin({ incidents: [OPEN_NO_UPDATES, RESOLVED, { ...fakeIncidentA() }] }) });
    const response = await get(h.app, '/admin/incidents', await signIn(h.app, 'member'));

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<h1>Incidents</h1>');
    expect(response.body).toContain('<a class="nav-link" href="/admin/incidents" aria-current="page">Incidents</a>');
    const open = response.body.slice(response.body.indexOf('id="open-title"'), response.body.indexOf('id="past-title"'));
    expect(count(open, 'class="notice card"')).toBe(2);
    expect(open).toContain('<h3 id="t-20">Bookings API timed out</h3>');
    expect(open).toContain('<p class="eyebrow">Open · Investigating</p>');
    expect(open).toContain('The bookings API does not answer.');
    expect(open).toContain('<h3 id="t-42">Campus events app returned server errors</h3>');
    expect(open).toContain('No updates yet.');
    expect(open).toContain('Started <span class="num">14:02 UTC</span> · down for <span class="num">53 min</span>');
    expect(count(open, '<form class="form" method="post" action="/admin/incidents/')).toBe(2);
    expect(open).toContain('<input type="radio" name="stage" value="monitoring">Monitoring</label>');
    expect(open).not.toContain('checked');
    expect(open).toContain('maxlength="2000"');
    const past = response.body.slice(response.body.indexOf('id="past-title"'));
    expect(past).toContain('<p class="eyebrow">Resolved · Tue 24 Nov 2026</p>');
    expect(past).toContain('Lasted <span class="num">12 min</span>');
    expect(past).toContain('action="/admin/incidents/37/updates"');
  });

  it('empty: says what will appear and links to the monitors', async () => {
    h = harness({ admin: fakeAdmin({ incidents: [] }) });
    const response = await get(h.app, '/admin/incidents', await signIn(h.app, 'member'));

    expect(response.body).toContain('No open incidents.');
    expect(response.body).toContain('No incidents resolved in the last 90 days.');
    expect(response.body).toContain('<a class="pill" href="/admin/monitors">Go to monitors</a>');
  });

  it('error: 503 with a way to try again', async () => {
    h = harness();
    h.admin.fail.incidents = true;
    const response = await get(h.app, '/admin/incidents', await signIn(h.app, 'member'));

    expect(response.statusCode).toBe(503);
    expect(response.body).toContain('Incidents could not load because the server did not answer. Try again in a moment.');
  });

  it('after posting: says so on that incident', async () => {
    h = harness();
    const response = await get(h.app, `/admin/incidents?posted=${INCIDENT_A}`, await signIn(h.app, 'member'));

    expect(response.body).toContain('Update posted. It shows on the status page within 30 seconds.');
  });
});

describe('POST /admin/incidents/:id/updates (D-033, D-038)', () => {
  it('saves the trimmed text with the stage and the author, at the clock time', async () => {
    h = harness();
    const response = await post(h.app, `/admin/incidents/${INCIDENT_A}/updates`, { stage: 'resolved', body: '  Back up.  ' }, await signIn(h.app, 'member'));

    expect(response.statusCode).toBe(303);
    expect(h.admin.updates).toEqual([{ incidentId: INCIDENT_A, userId: USERS.member.id, stage: 'resolved', body: 'Back up.', at: NOW }]);
  });

  it('invalid: 400, the page again with the error on that form and the text kept', async () => {
    h = harness();
    const response = await post(h.app, `/admin/incidents/${INCIDENT_A}/updates`, { body: 'Typed <text>' }, await signIn(h.app, 'member'));

    expect(response.statusCode).toBe(400);
    expect(h.admin.updates).toEqual([]);
    expect(response.body).toContain(`id="stage-error-${INCIDENT_A}"`);
    expect(response.body).toContain('Choose a stage.');
    expect(response.body).toContain('Typed &lt;text&gt;</textarea>');
  });

  it('too long: 400 with the length message', async () => {
    h = harness();
    const response = await post(h.app, `/admin/incidents/${INCIDENT_A}/updates`, { stage: 'identified', body: 'x'.repeat(2001) }, await signIn(h.app, 'member'));

    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('Shorten the update to 2000 characters or fewer.');
    expect(response.body).toContain('aria-invalid="true"');
  });

  it('save fails: 503, the alert on that form and the text kept', async () => {
    h = harness();
    h.admin.fail.addUpdate = true;
    const response = await post(h.app, `/admin/incidents/${INCIDENT_A}/updates`, { stage: 'monitoring', body: 'Watching it.' }, await signIn(h.app, 'member'));

    expect(response.statusCode).toBe(503);
    expect(response.body).toContain('The update was not saved.');
    expect(response.body).toContain('Watching it.</textarea>');
    expect(response.body).toContain('value="monitoring" checked');
  });

  it('an incident outside the list (unknown, or another organization) is 404', async () => {
    h = harness();
    const cookie = await signIn(h.app, 'otherAdmin');

    expect((await post(h.app, `/admin/incidents/${INCIDENT_A}/updates`, { stage: 'identified', body: 'x' }, cookie)).statusCode).toBe(404);
    expect((await post(h.app, '/admin/incidents/999/updates', { stage: 'identified', body: 'x' }, cookie)).statusCode).toBe(404);
  });
});

describe('XSS: an update shows as text', () => {
  const BODY = '<script>alert("x")</script> & <img src=x onerror=alert(1)>';

  it('on the admin page', async () => {
    h = harness({ admin: fakeAdmin({ incidents: [{ ...fakeIncidentA(), updates: [{ stage: 'identified', body: BODY, createdAt: NOW }] }] }) });
    const response = await get(h.app, '/admin/incidents', await signIn(h.app, 'member'));

    expect(response.body).not.toContain('<script>alert');
    expect(response.body).not.toContain('<img src=x');
    expect(response.body).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &lt;img src=x onerror=alert(1)&gt;');
  });

  it('on the public status page', () => {
    const { html } = renderStatusPage({
      groups: [{
        name: 'Campus projects',
        monitors: [{
          name: 'Bookings API', createdAt: new Date('2026-11-20T00:00:00.000Z'), latencyThresholdMs: null,
          firstCheckAt: new Date('2026-11-25T10:00:00.000Z'), lastCheck: { checkedAt: NOW, latencyMs: null }, maintenance: [],
          incidents: [{ startedAt: new Date('2026-11-26T14:02:00.000Z'), resolvedAt: null, cause: 'timeout', updates: [{ stage: 'identified', body: BODY, createdAt: NOW }] }],
        }],
      }],
    }, NOW);

    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  });
});

function fakeIncidentA() {
  return {
    id: INCIDENT_A, organizationId: ORG_A, monitor: 'Bookings API', cause: 'timeout',
    startedAt: new Date('2026-11-26T14:02:00.000Z'), resolvedAt: null,
    updates: [{ stage: 'investigating' as const, body: 'The bookings API does not answer.', createdAt: new Date('2026-11-26T14:10:00.000Z') }],
  };
}
