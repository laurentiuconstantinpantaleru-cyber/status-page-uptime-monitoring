import type { Clock } from '../../shared/clock.js';
import { buildReport, monthKey, monthTitle, previousMonth, type ReportInput } from '../../shared/report.js';
import { renderReportPdf } from './pdf.js';

// The monthly report job (D-019, D-041). It runs every hour in the web process and works on the
// last closed UTC month: the first run after 00:00 UTC on the 1st makes the reports, later runs
// find them made. A report is stored once per (organization, month) by a unique key, and the
// right to email it is claimed in the database, so re-runs and overlapping runs send it once.

export interface Mail {
  to: string[];
  subject: string;
  text: string;
  attachments: { filename: string; content: Buffer }[];
}

/** Injected so tests never send mail (PATTERN-006); `smtpMailer` is the real one. */
export interface Mailer {
  send(mail: Mail): Promise<void>;
}

export interface ReportStore {
  organizations(): Promise<{ id: number; name: string }[]>;
  /** The month's rows of one organization, or null when there is no such organization. */
  loadMonth(orgId: number, year: number, month: number, now: Date): Promise<ReportInput | null>;
  /** Null when no report is stored for the month. */
  reportState(orgId: number, month: string): Promise<{ emailed: boolean } | null>;
  /** Stores the report; false when one was already stored (it is kept). */
  saveReport(orgId: number, month: string, pdf: Buffer, now: Date): Promise<boolean>;
  storedReport(orgId: number, month: string): Promise<Buffer | null>;
  /** The stored PDF when this caller may email it now; null when it was emailed or another
   *  caller claimed it less than an hour ago. */
  claimEmail(orgId: number, month: string, now: Date): Promise<Buffer | null>;
  markEmailed(orgId: number, month: string, now: Date): Promise<void>;
  /** Gives a claim back after a failed send, with the error. */
  releaseEmail(orgId: number, month: string, error: string): Promise<void>;
  /** Org admins only: not members, not global admins (D-019). */
  orgAdminEmails(orgId: number): Promise<string[]>;
}

export interface ReportJobDeps {
  clock: Clock;
  store: ReportStore;
  /** Null without SMTP settings: reports are stored and sent once a mailer exists. */
  mailer: Mailer | null;
  log: (message: string, error?: unknown) => void;
}

export const REPORT_JOB_MS = 60 * 60 * 1000;

const render = async (input: ReportInput, now: Date) => renderReportPdf(buildReport(input, now));

export async function runMonthlyReports(deps: ReportJobDeps): Promise<void> {
  const { clock, store, mailer, log } = deps;
  const now = clock.now();
  const { year, month } = previousMonth(now);
  const key = monthKey(year, month);

  for (const org of await store.organizations()) {
    try {
      let state = await store.reportState(org.id, key);
      if (state === null) {
        const input = await store.loadMonth(org.id, year, month, now);
        if (input === null) continue;
        await store.saveReport(org.id, key, await render(input, now), now);
        state = { emailed: false };
      }
      if (state.emailed || mailer === null) continue;

      const to = await store.orgAdminEmails(org.id);
      if (to.length === 0) continue;
      const pdf = await store.claimEmail(org.id, key, now);
      if (pdf === null) continue;
      try {
        await mailer.send({
          to,
          subject: `Uptime report for ${org.name}, ${monthTitle(year, month)}`,
          text: `The uptime report of ${org.name} for ${monthTitle(year, month)} (UTC) is attached.\n\n`
            + 'You get it because you are an organization admin. Org admins can also download it from the dashboard.\n',
          attachments: [{ filename: `uptime-report-${key}.pdf`, content: pdf }],
        });
      } catch (error) {
        await store.releaseEmail(org.id, key, (error as Error).message.slice(0, 1000));
        log(`monthly report ${key} of ${org.name} could not be emailed; it is tried again in an hour`, error);
        continue;
      }
      await store.markEmailed(org.id, key, now);
    } catch (error) {
      log(`monthly report ${key} of ${org.name} failed`, error);
    }
  }
}

/** Runs the job now and every hour; a run still going when the next is due is not doubled. */
export function startMonthlyReports(deps: ReportJobDeps): () => void {
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    runMonthlyReports(deps)
      .catch((error: unknown) => deps.log('monthly reports failed', error))
      .finally(() => {
        running = false;
      });
  };
  tick();
  const timer = setInterval(tick, REPORT_JOB_MS);
  return () => clearInterval(timer);
}

/** What the download route needs (D-019): the PDF of a closed month, or null for no such organization. */
export interface ReportDownloads {
  pdf(orgId: number, year: number, month: number, now: Date): Promise<Buffer | null>;
}

/** The stored report, else one made now and not stored, so the job still emails it on its own. */
export async function reportPdf(store: ReportStore, orgId: number, year: number, month: number, now: Date): Promise<Buffer | null> {
  const stored = await store.storedReport(orgId, monthKey(year, month));
  if (stored) return stored;
  const input = await store.loadMonth(orgId, year, month, now);
  return input === null ? null : render(input, now);
}
