import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../src/shared/clock.js';
import type { AlertIncident, AlertKind } from '../../src/shared/alerts.js';
import { dispatchAlerts, type AlertStore, type Contact, type TelegramClient } from '../../src/web/alerts/dispatcher.js';
import { hashToken } from '../../src/web/auth/session.js';
import type { Mail, Mailer } from '../../src/web/mail.js';

// The alert dispatcher (D-007, D-013, D-044), on a FakeClock: never a sleep (D-004).

const at = (iso: string) => new Date(`${iso}Z`);
const MIN = 60_000;
const START = at('2026-12-01T10:12:00');

const CONTACTS: (Contact & { organizationId: number; priority: 'primary' | 'secondary' })[] = [
  { id: 1, organizationId: 1, priority: 'primary', name: 'Ana', channel: 'email', address: 'ana@a.test' },
  { id: 2, organizationId: 1, priority: 'primary', name: 'Ops chat', channel: 'telegram', address: '-1001234' },
  { id: 3, organizationId: 1, priority: 'secondary', name: 'Bogdan', channel: 'email', address: 'bogdan@a.test' },
  { id: 4, organizationId: 2, priority: 'primary', name: 'Other org', channel: 'email', address: 'x@b.test' },
];

interface Row { sendingAt: Date | null; sentAt: Date | null; lastError: string | null; nextTryAt: Date | null }

function fakeStore(incidents: AlertIncident[], contacts = CONTACTS) {
  const rows = new Map<string, Row>();
  const tokens: { incidentId: number; hash: string }[] = [];
  const key = (i: number, k: AlertKind, c: number) => `${i}/${k}/${c}`;
  const sentFor = (incidentId: number, kinds: AlertKind[]) =>
    contacts.filter((c) => kinds.some((k) => rows.get(key(incidentId, k, c.id))?.sentAt));
  const withOpenedSent = (i: AlertIncident): AlertIncident => {
    const times = contacts.map((c) => rows.get(key(i.id, 'opened', c.id))?.sentAt).filter((t): t is Date => Boolean(t));
    return { ...i, openedSentAt: times.length ? new Date(Math.min(...times.map((t) => t.getTime()))) : null };
  };
  const store: AlertStore & { rows: typeof rows; tokens: typeof tokens; incidents: AlertIncident[] } = {
    rows,
    tokens,
    incidents,
    async openIncidents() {
      return store.incidents.filter((i) => i.resolvedAt === null).map(withOpenedSent);
    },
    async resolvedIncidents() {
      return store.incidents
        .filter((i) => i.resolvedAt !== null && sentFor(i.id, ['opened', 'escalated']).some((c) => !rows.get(key(i.id, 'resolved', c.id))?.sentAt))
        .map(withOpenedSent);
    },
    async contacts(orgId, priority) {
      return contacts.filter((c) => c.organizationId === orgId && c.priority === priority).map(({ organizationId: _, priority: __, ...c }) => c);
    },
    async alertedContacts(incidentId) {
      return sentFor(incidentId, ['opened', 'escalated']).map(({ organizationId: _, priority: __, ...c }) => c);
    },
    async claim(incidentId, kind, contactId, now) {
      const k = key(incidentId, kind, contactId);
      const row = rows.get(k) ?? { sendingAt: null, sentAt: null, lastError: null, nextTryAt: null };
      rows.set(k, row);
      if (row.sentAt) return false;
      if (row.nextTryAt && row.nextTryAt > now) return false;
      if (row.sendingAt && now.getTime() - row.sendingAt.getTime() < 10 * MIN) return false;
      row.sendingAt = now;
      return true;
    },
    async markSent(incidentId, kind, contactId, now) {
      Object.assign(rows.get(key(incidentId, kind, contactId))!, { sentAt: now, sendingAt: null, lastError: null, nextTryAt: null });
    },
    async release(incidentId, kind, contactId, error, nextTryAt) {
      Object.assign(rows.get(key(incidentId, kind, contactId))!, { sendingAt: null, lastError: error, nextTryAt });
    },
    async saveAckToken(incidentId, tokenHash) {
      tokens.push({ incidentId, hash: tokenHash });
    },
  };
  return store;
}

const open = (over: Partial<AlertIncident> = {}): AlertIncident => ({
  id: 20, organizationId: 1, organization: 'Campus projects', monitor: 'Bookings API', url: 'https://api.bookings.example/health',
  cause: 'timeout', httpStatus: null, startedAt: at('2026-12-01T10:02:00'), resolvedAt: null, acknowledgedAt: null,
  lastSuccessAt: at('2026-12-01T09:57:00'), openedSentAt: null, escalationMinutes: 15, ...over,
});

function fakeMailer(fail = 0): Mailer & { sent: Mail[] } {
  let fails = fail;
  const m = {
    sent: [] as Mail[],
    async send(mail: Mail) {
      if (fails > 0) {
        fails -= 1;
        throw Object.assign(new Error('550 <ana@a.test> rejected'), { code: 'EENVELOPE', responseCode: 550, command: 'RCPT TO', rejected: ['ana@a.test'] });
      }
      m.sent.push(mail);
      return { accepted: mail.to.length };
    },
  };
  return m;
}

function fakeTelegram(errors: Error[] = []): TelegramClient & { sent: { chatId: string; text: string }[] } {
  const t = {
    sent: [] as { chatId: string; text: string }[],
    async send(chatId: string, text: string) {
      const error = errors.shift();
      if (error) throw error;
      t.sent.push({ chatId, text });
    },
  };
  return t;
}

const quiet = () => {};
const deps = (store: AlertStore, clock: FakeClock, mailer: Mailer | null, telegram: TelegramClient | null, log: (m: string, e?: unknown) => void = quiet) =>
  ({ clock, store, mailer, telegram, publicUrl: 'https://status.example', log });

describe('dispatchAlerts (D-007, D-044)', () => {
  it('an open incident goes at once to the primary contacts of its organization, by email and Telegram, with an acknowledge link', async () => {
    const clock = new FakeClock(START);
    const store = fakeStore([open()]);
    const mailer = fakeMailer();
    const telegram = fakeTelegram();

    await dispatchAlerts(deps(store, clock, mailer, telegram));

    expect(mailer.sent.map((m) => m.to)).toEqual([['ana@a.test']]);
    expect(mailer.sent[0].subject).toBe('[DOWN] Bookings API: Timeout');
    expect(mailer.sent[0].attachments).toEqual([]);
    expect(telegram.sent.map((m) => m.chatId)).toEqual(['-1001234']);
    // One token per message; only its hash is stored.
    const links = [mailer.sent[0].text, telegram.sent[0].text].map((t) => /Acknowledge: https:\/\/status\.example\/ack\/([A-Za-z0-9_-]{43})/.exec(t)![1]);
    expect(store.tokens).toEqual(links.map((token) => ({ incidentId: 20, hash: hashToken(token) })));
    expect(JSON.stringify(store.tokens)).not.toContain(links[0]);
  });

  it('runs every 30 seconds for an hour and still sends each alert once; two runs at once send once', async () => {
    const clock = new FakeClock(START);
    const store = fakeStore([open({ acknowledgedAt: START })]);
    const mailer = fakeMailer();
    const telegram = fakeTelegram();

    await Promise.all([dispatchAlerts(deps(store, clock, mailer, telegram)), dispatchAlerts(deps(store, clock, mailer, telegram))]);
    for (let i = 0; i < 120; i += 1) {
      clock.advance(30_000);
      await dispatchAlerts(deps(store, clock, mailer, telegram));
    }

    expect(mailer.sent).toHaveLength(1);
    expect(telegram.sent).toHaveLength(1);
  });

  it('escalates to the secondary contacts 15 minutes after the primary alert, once; acknowledged in time, it does not', async () => {
    const clock = new FakeClock(START);
    const store = fakeStore([open()]);
    const mailer = fakeMailer();
    const telegram = fakeTelegram();
    await dispatchAlerts(deps(store, clock, mailer, telegram));

    clock.advance(15 * MIN - 1);
    await dispatchAlerts(deps(store, clock, mailer, telegram));
    expect(mailer.sent.map((m) => m.to[0])).toEqual(['ana@a.test']);

    clock.advance(1);
    await dispatchAlerts(deps(store, clock, mailer, telegram));
    clock.advance(30_000);
    await dispatchAlerts(deps(store, clock, mailer, telegram));
    expect(mailer.sent.map((m) => m.to[0])).toEqual(['ana@a.test', 'bogdan@a.test']);
    expect(mailer.sent[1].subject).toBe('[ESCALATED] Bookings API: Timeout');

    const acked = fakeStore([open()]);
    const m2 = fakeMailer();
    await dispatchAlerts(deps(acked, new FakeClock(START), m2, fakeTelegram()));
    acked.incidents[0] = { ...acked.incidents[0], acknowledgedAt: new Date(START.getTime() + 14 * MIN) };
    await dispatchAlerts(deps(acked, new FakeClock(new Date(START.getTime() + 20 * MIN)), m2, fakeTelegram()));
    expect(m2.sent.map((m) => m.to[0])).toEqual(['ana@a.test']);
  });

  it('without a secondary contact nothing escalates and nothing fails', async () => {
    const clock = new FakeClock(START);
    const store = fakeStore([open()], CONTACTS.filter((c) => c.priority === 'primary'));
    const mailer = fakeMailer();
    const logged: string[] = [];

    await dispatchAlerts(deps(store, clock, mailer, fakeTelegram(), (m) => logged.push(m)));
    clock.advance(60 * MIN);
    await dispatchAlerts(deps(store, clock, mailer, fakeTelegram(), (m) => logged.push(m)));

    expect(mailer.sent).toHaveLength(1);
    expect(logged).toEqual([]);
  });

  it('a resolved incident sends one resolved alert to everyone who was alerted, primary and secondary', async () => {
    const clock = new FakeClock(START);
    const store = fakeStore([open()]);
    const mailer = fakeMailer();
    const telegram = fakeTelegram();
    await dispatchAlerts(deps(store, clock, mailer, telegram));
    clock.advance(15 * MIN);
    await dispatchAlerts(deps(store, clock, mailer, telegram));

    store.incidents[0] = { ...store.incidents[0], resolvedAt: clock.now() };
    clock.advance(30_000);
    await dispatchAlerts(deps(store, clock, mailer, telegram));
    clock.advance(30_000);
    await dispatchAlerts(deps(store, clock, mailer, telegram));

    const resolved = mailer.sent.filter((m) => m.subject.startsWith('[RESOLVED]'));
    expect(resolved.map((m) => m.to[0]).sort()).toEqual(['ana@a.test', 'bogdan@a.test']);
    expect(telegram.sent.filter((m) => m.text.includes('is up again'))).toHaveLength(1);
    expect(resolved[0].text).not.toContain('Acknowledge');
  });

  it('an incident that opened and resolved between two runs sends nothing', async () => {
    const store = fakeStore([open({ resolvedAt: START })]);
    const mailer = fakeMailer();

    await dispatchAlerts(deps(store, new FakeClock(START), mailer, fakeTelegram()));

    expect(mailer.sent).toEqual([]);
  });

  it('a failed send is retried at the next run; no email address reaches the log or last_error', async () => {
    const clock = new FakeClock(START);
    const store = fakeStore([open()]);
    const mailer = fakeMailer(1);
    const logged: unknown[] = [];

    await dispatchAlerts(deps(store, clock, mailer, fakeTelegram(), (m, e) => logged.push(m, e)));
    expect(store.rows.get('20/opened/1')).toMatchObject({ sentAt: null, lastError: 'EENVELOPE 550 RCPT TO' });
    expect(JSON.stringify(logged)).not.toContain('@');

    clock.advance(30_000);
    await dispatchAlerts(deps(store, clock, mailer, fakeTelegram()));
    expect(mailer.sent.map((m) => m.to)).toEqual([['ana@a.test']]);
    expect(store.rows.get('20/opened/1')!.sentAt).toEqual(clock.now());
  });

  it('Telegram\'s retry_after is honoured: no new try before it', async () => {
    const clock = new FakeClock(START);
    const store = fakeStore([open()]);
    const limited = Object.assign(new Error('Too Many Requests: retry after 90'), { code: 'ETELEGRAM', responseCode: 429, command: 'sendMessage', retryAfterS: 90 });
    const telegram = fakeTelegram([limited]);

    await dispatchAlerts(deps(store, clock, fakeMailer(), telegram));
    clock.advance(60_000);
    await dispatchAlerts(deps(store, clock, fakeMailer(), telegram));
    expect(telegram.sent).toEqual([]);

    clock.advance(30_000);
    await dispatchAlerts(deps(store, clock, fakeMailer(), telegram));
    expect(telegram.sent.map((m) => m.chatId)).toEqual(['-1001234']);
  });

  it('a channel without settings waits: its contacts get the alert once it is configured', async () => {
    const clock = new FakeClock(START);
    const store = fakeStore([open()]);
    const mailer = fakeMailer();

    await dispatchAlerts(deps(store, clock, mailer, null));
    expect(mailer.sent).toHaveLength(1);
    expect(store.rows.has('20/opened/2')).toBe(false);

    const telegram = fakeTelegram();
    clock.advance(30_000);
    await dispatchAlerts(deps(store, clock, mailer, telegram));
    expect(telegram.sent).toHaveLength(1);
    expect(mailer.sent).toHaveLength(1);
  });

  it('one contact failing does not stop the others', async () => {
    const store = fakeStore([open()]);
    const telegram = fakeTelegram([Object.assign(new Error('Bad Request: chat not found'), { code: 'ETELEGRAM', responseCode: 400, command: 'sendMessage' })]);
    const mailer = fakeMailer();

    await dispatchAlerts(deps(store, new FakeClock(START), mailer, telegram));

    expect(mailer.sent).toHaveLength(1);
    expect(store.rows.get('20/opened/2')).toMatchObject({ sentAt: null, lastError: 'ETELEGRAM 400 sendMessage' });
  });
});
