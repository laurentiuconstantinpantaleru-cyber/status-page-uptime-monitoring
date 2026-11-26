import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../src/shared/clock.js';
import type { ReportInput } from '../../src/shared/report.js';
import { reportPdf, runMonthlyReports, type Mail, type Mailer, type ReportStore } from '../../src/web/reports/job.js';

// The monthly job (D-019, D-041), driven by a FakeClock: never a sleep (D-004).

interface Row { pdf: Buffer; generatedAt: Date; emailedAt: Date | null; sendingAt: Date | null; lastError: string | null }

function fakeStore(opts: { admins?: Record<number, string[]> } = {}) {
  const orgs = [{ id: 1, name: 'Campus projects' }, { id: 2, name: 'Local businesses' }];
  const admins = opts.admins ?? { 1: ['admin@a.test', 'second@a.test'], 2: ['admin@b.test'] };
  const rows = new Map<string, Row>();
  const key = (orgId: number, month: string) => `${orgId}/${month}`;
  const loads: string[] = [];
  const store: ReportStore & { rows: typeof rows; loads: string[] } = {
    rows,
    loads,
    async organizations() {
      return orgs;
    },
    async loadMonth(orgId, year, month) {
      const org = orgs.find((o) => o.id === orgId);
      if (!org) return null;
      loads.push(`${orgId}/${year}-${String(month).padStart(2, '0')}`);
      const input: ReportInput = { organization: org.name, year, month, monitors: [] };
      return input;
    },
    async reportState(orgId, month) {
      const row = rows.get(key(orgId, month));
      return row ? { emailed: row.emailedAt !== null } : null;
    },
    async saveReport(orgId, month, pdf, now) {
      if (rows.has(key(orgId, month))) return false;
      rows.set(key(orgId, month), { pdf, generatedAt: now, emailedAt: null, sendingAt: null, lastError: null });
      return true;
    },
    async storedReport(orgId, month) {
      return rows.get(key(orgId, month))?.pdf ?? null;
    },
    async claimEmail(orgId, month, now) {
      const row = rows.get(key(orgId, month));
      if (!row || row.emailedAt) return null;
      if (row.sendingAt && now.getTime() - row.sendingAt.getTime() < 60 * 60 * 1000) return null;
      row.sendingAt = now;
      return row.pdf;
    },
    async markEmailed(orgId, month, now) {
      const row = rows.get(key(orgId, month))!;
      row.emailedAt = now;
      row.sendingAt = null;
      row.lastError = null;
    },
    async releaseEmail(orgId, month, error) {
      const row = rows.get(key(orgId, month))!;
      row.sendingAt = null;
      row.lastError = error;
    },
    async orgAdminEmails(orgId) {
      return admins[orgId] ?? [];
    },
  };
  return store;
}

function fakeMailer(failTimes = 0): Mailer & { sent: Mail[] } {
  let fails = failTimes;
  const mailer = {
    sent: [] as Mail[],
    async send(mail: Mail) {
      if (fails > 0) {
        fails -= 1;
        throw Object.assign(new Error('SMTP 421 try again later'), { code: 'EENVELOPE', responseCode: 421, command: 'RCPT TO' });
      }
      mailer.sent.push(mail);
      return { accepted: mail.to.length };
    },
  };
  return mailer;
}

const quiet = () => {};

describe('runMonthlyReports (D-019, D-041)', () => {
  it('at 00:00 UTC on the 1st it makes last month\'s report for every organization and emails its org admins', async () => {
    const clock = new FakeClock(new Date('2026-12-01T00:00:00.000Z'));
    const store = fakeStore();
    const mailer = fakeMailer();

    await runMonthlyReports({ clock, store, mailer, log: quiet });

    expect([...store.rows.keys()]).toEqual(['1/2026-11', '2/2026-11']);
    expect(store.rows.get('1/2026-11')!.pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(store.rows.get('1/2026-11')!.generatedAt).toEqual(clock.now());
    expect(mailer.sent.map((m) => m.to)).toEqual([['admin@a.test', 'second@a.test'], ['admin@b.test']]);
    expect(mailer.sent[0]).toMatchObject({
      subject: 'Uptime report for Campus projects, November 2026',
      attachments: [{ filename: 'uptime-report-2026-11.pdf' }],
    });
    expect(mailer.sent[0].attachments[0].content.equals(store.rows.get('1/2026-11')!.pdf)).toBe(true);
    expect(mailer.sent[0].text).toContain('November 2026');
    expect(store.rows.get('1/2026-11')!.emailedAt).toEqual(clock.now());
  });

  it('records how many org admins the email went to', async () => {
    const clock = new FakeClock(new Date('2026-12-01T00:00:00.000Z'));
    const store = fakeStore();
    const marked: [number, string, number][] = [];
    const mark = store.markEmailed.bind(store);
    store.markEmailed = async (orgId, month, now, to) => {
      marked.push([orgId, month, to]);
      return mark(orgId, month, now, to);
    };

    await runMonthlyReports({ clock, store, mailer: fakeMailer(), log: quiet });

    expect(marked).toEqual([[1, '2026-11', 2], [2, '2026-11', 1]]);
  });

  it('a rejected send stores and logs no email address, only the error\'s code, reply code and command', async () => {
    const clock = new FakeClock(new Date('2026-12-01T00:00:00.000Z'));
    const store = fakeStore();
    const rejected = Object.assign(
      new Error("Can't send mail - all recipients were rejected: 550 5.1.1 <admin@a.test>: Recipient address rejected"),
      {
        code: 'EENVELOPE', responseCode: 550, command: 'RCPT TO',
        response: '550 5.1.1 <admin@a.test>: Recipient address rejected',
        rejected: ['admin@a.test', 'second@a.test'],
        rejectedErrors: [{ recipient: 'admin@a.test' }, { recipient: 'second@a.test' }],
      },
    );
    const mailer: Mailer = { send: async () => { throw rejected; } };
    const logged: unknown[] = [];

    await runMonthlyReports({ clock, store, mailer, log: (message, error) => logged.push(message, error) });

    expect(store.rows.get('1/2026-11')!.lastError).toBe('EENVELOPE 550 RCPT TO');
    const everything = JSON.stringify(logged) + JSON.stringify([...store.rows.values()].map((r) => r.lastError));
    expect(everything).not.toContain('@');
    expect(logged).toContainEqual({ code: 'EENVELOPE', responseCode: 550, command: 'RCPT TO' });
  });

  it('an error without SMTP fields is stored as its name', async () => {
    const clock = new FakeClock(new Date('2026-12-01T00:00:00.000Z'));
    const store = fakeStore();
    const mailer: Mailer = { send: async () => { throw new TypeError('connect ECONNREFUSED admin@a.test'); } };

    await runMonthlyReports({ clock, store, mailer, log: quiet });

    expect(store.rows.get('1/2026-11')!.lastError).toBe('TypeError');
  });

  it('counts only the org admins the mail server accepted', async () => {
    const clock = new FakeClock(new Date('2026-12-01T00:00:00.000Z'));
    const store = fakeStore();
    const marked: number[] = [];
    const mark = store.markEmailed.bind(store);
    store.markEmailed = async (orgId, month, now, to) => {
      marked.push(to);
      return mark(orgId, month, now, to);
    };
    const mailer: Mailer = { send: async () => ({ accepted: 1 }) };

    await runMonthlyReports({ clock, store, mailer, log: quiet });

    expect(marked).toEqual([1, 1]);
  });

  it('gives the event loop a turn between organizations, so the status page is served between renders (D-043)', async () => {
    const clock = new FakeClock(new Date('2026-12-01T00:00:00.000Z'));
    const store = fakeStore();
    const events: string[] = [];
    const load = store.loadMonth.bind(store);
    store.loadMonth = async (orgId, year, month, now) => {
      events.push(`load ${orgId}`);
      if (orgId === 1) setImmediate(() => events.push('other request'));
      return load(orgId, year, month, now);
    };
    // Rendering is replaced by a promise that never leaves the microtask queue, so only an
    // explicit yield lets the immediate run before organization 2.
    await runMonthlyReports({ clock, store, mailer: fakeMailer(), log: quiet, render: async () => Buffer.from('%PDF-x') });

    expect(events).toEqual(['load 1', 'other request', 'load 2']);
  });

  it('one millisecond before the 1st, November is not reported yet', async () => {
    const clock = new FakeClock(new Date('2026-11-30T23:59:59.999Z'));
    const store = fakeStore();

    await runMonthlyReports({ clock, store, mailer: fakeMailer(), log: quiet });

    expect([...store.rows.keys()].some((k) => k.endsWith('2026-11'))).toBe(false);
  });

  it('December is reported on 1 January of the next year', async () => {
    const clock = new FakeClock(new Date('2027-01-01T00:00:00.000Z'));
    const store = fakeStore();

    await runMonthlyReports({ clock, store, mailer: fakeMailer(), log: quiet });

    expect([...store.rows.keys()]).toEqual(['1/2026-12', '2/2026-12']);
  });

  it('runs every hour of the month but makes and sends each report once', async () => {
    const clock = new FakeClock(new Date('2026-12-01T00:00:00.000Z'));
    const store = fakeStore();
    const mailer = fakeMailer();

    for (let hour = 0; hour < 24 * 3; hour += 1) {
      await runMonthlyReports({ clock, store, mailer, log: quiet });
      clock.advance(60 * 60 * 1000);
    }

    expect(store.loads).toEqual(['1/2026-11', '2/2026-11']);
    expect(mailer.sent).toHaveLength(2);
  });

  it('two runs at the same time send each report once', async () => {
    const clock = new FakeClock(new Date('2026-12-01T00:00:00.000Z'));
    const store = fakeStore();
    const mailer = fakeMailer();

    await Promise.all([
      runMonthlyReports({ clock, store, mailer, log: quiet }),
      runMonthlyReports({ clock, store, mailer, log: quiet }),
    ]);

    expect(store.rows.size).toBe(2);
    expect(mailer.sent).toHaveLength(2);
  });

  it('a server that was down on the 1st makes the report when it starts on the 3rd, once', async () => {
    const clock = new FakeClock(new Date('2026-12-03T09:17:00.000Z'));
    const store = fakeStore();
    const mailer = fakeMailer();

    await runMonthlyReports({ clock, store, mailer, log: quiet });
    clock.advance(60 * 60 * 1000);
    await runMonthlyReports({ clock, store, mailer, log: quiet });

    expect([...store.rows.keys()]).toEqual(['1/2026-11', '2/2026-11']);
    expect(mailer.sent).toHaveLength(2);
  });

  it('a failed send is recorded and tried again at the next run; a sent report is never sent again', async () => {
    const clock = new FakeClock(new Date('2026-12-01T00:00:00.000Z'));
    const store = fakeStore();
    const mailer = fakeMailer(1);
    const logged: string[] = [];

    await runMonthlyReports({ clock, store, mailer, log: (msg) => logged.push(msg) });
    expect(store.rows.get('1/2026-11')).toMatchObject({ emailedAt: null, sendingAt: null, lastError: 'EENVELOPE 421 RCPT TO' });
    expect(store.rows.get('2/2026-11')!.emailedAt).not.toBeNull();
    expect(logged.some((l) => l.includes('Campus projects'))).toBe(true);

    clock.advance(60 * 60 * 1000);
    await runMonthlyReports({ clock, store, mailer, log: quiet });
    clock.advance(60 * 60 * 1000);
    await runMonthlyReports({ clock, store, mailer, log: quiet });

    expect(mailer.sent.map((m) => m.to[0])).toEqual(['admin@b.test', 'admin@a.test']);
    expect(store.rows.get('1/2026-11')).toMatchObject({ lastError: null });
    expect(store.rows.get('1/2026-11')!.emailedAt).not.toBeNull();
  });

  it('an organization without org admins gets its report stored and no email', async () => {
    const clock = new FakeClock(new Date('2026-12-01T00:00:00.000Z'));
    const store = fakeStore({ admins: { 1: [], 2: ['admin@b.test'] } });
    const mailer = fakeMailer();

    await runMonthlyReports({ clock, store, mailer, log: quiet });

    expect(store.rows.has('1/2026-11')).toBe(true);
    expect(store.rows.get('1/2026-11')!.emailedAt).toBeNull();
    expect(mailer.sent.map((m) => m.to)).toEqual([['admin@b.test']]);
  });

  it('without SMTP settings the reports are stored and wait to be sent', async () => {
    const clock = new FakeClock(new Date('2026-12-01T00:00:00.000Z'));
    const store = fakeStore();

    await runMonthlyReports({ clock, store, mailer: null, log: quiet });
    expect(store.rows.size).toBe(2);

    const mailer = fakeMailer();
    clock.advance(60 * 60 * 1000);
    await runMonthlyReports({ clock, store, mailer, log: quiet });
    expect(mailer.sent).toHaveLength(2);
  });

  it('one organization failing does not stop the others', async () => {
    const clock = new FakeClock(new Date('2026-12-01T00:00:00.000Z'));
    const store = fakeStore();
    const load = store.loadMonth.bind(store);
    store.loadMonth = async (orgId, year, month, now) => {
      if (orgId === 1) throw new Error('database down');
      return load(orgId, year, month, now);
    };
    const mailer = fakeMailer();

    await runMonthlyReports({ clock, store, mailer, log: quiet });

    expect([...store.rows.keys()]).toEqual(['2/2026-11']);
    expect(mailer.sent).toHaveLength(1);
  });
});

describe('reportPdf: the download (D-019, D-041)', () => {
  it('a stored report is returned as stored', async () => {
    const store = fakeStore();
    await store.saveReport(1, '2026-10', Buffer.from('%PDF-stored'), new Date('2026-11-01T00:00:00.000Z'));

    const pdf = await reportPdf(store, 1, 2026, 10, new Date('2026-12-05T00:00:00.000Z'));
    expect(pdf?.toString()).toBe('%PDF-stored');
  });

  it('a closed month without a stored report is made on demand and not stored, so the job still emails it', async () => {
    const store = fakeStore();

    const pdf = await reportPdf(store, 1, 2026, 11, new Date('2026-12-01T00:00:00.000Z'));
    expect(pdf?.subarray(0, 5).toString()).toBe('%PDF-');
    expect(store.rows.size).toBe(0);
  });

  it('an unknown organization has no report', async () => {
    expect(await reportPdf(fakeStore(), 99, 2026, 11, new Date('2026-12-05T00:00:00.000Z'))).toBeNull();
  });
});
