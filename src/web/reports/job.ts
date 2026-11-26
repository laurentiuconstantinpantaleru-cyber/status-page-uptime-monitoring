import type { Clock } from '../../shared/clock.js';
import { buildReport, monthKey, monthTitle, previousMonth, type ReportInput } from '../../shared/report.js';
import { mailErrorFields, mailErrorText, type Mailer } from '../mail.js';
import type { PdfCache } from './cache.js';
import type { ReportOrg } from './months.js';
import { renderReportPdf } from './pdf.js';

// The monthly report job (D-019, D-041). It runs every hour in the web process and works on the
// last closed UTC month: the first run after 00:00 UTC on the 1st makes the reports, later runs
// find them made. A report is stored once per (organization, month) by a unique key, and the
// right to email it is claimed in the database, so re-runs and overlapping runs send it once.

// Mail lives in ../mail.ts (shared with the alerts); re-exported for the report tests and callers.
export type { Mail, Mailer } from '../mail.js';
export { mailErrorFields } from '../mail.js';

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
  /** `emailedTo`: how many org admins the email went to. */
  markEmailed(orgId: number, month: string, now: Date, emailedTo: number): Promise<void>;
  /** Gives a claim back after a failed send, with the error. */
  releaseEmail(orgId: number, month: string, error: string): Promise<void>;
  /** Org admins only: not members, not global admins (D-019). */
  orgAdminEmails(orgId: number): Promise<string[]>;
  /** Organizations with their stored reports, oldest organization first; null is every organization. */
  list(orgId: number | null): Promise<ReportOrg[]>;
}

export interface ReportJobDeps {
  clock: Clock;
  store: ReportStore;
  /** Null without SMTP settings: reports are stored and sent once a mailer exists. */
  mailer: Mailer | null;
  log: (message: string, error?: unknown) => void;
  /** The PDF renderer; tests pass a fake to see the job's own scheduling. */
  render?: (input: ReportInput, now: Date) => Promise<Buffer>;
}

export const REPORT_JOB_MS = 60 * 60 * 1000;

const render = async (input: ReportInput, now: Date) => renderReportPdf(buildReport(input, now));

/** One turn of the event loop: a render blocks it, so requests waiting meanwhile are served here (D-043). */
const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

export async function runMonthlyReports(deps: ReportJobDeps): Promise<void> {
  const { clock, store, mailer, log } = deps;
  const renderPdf = deps.render ?? render;
  const now = clock.now();
  const { year, month } = previousMonth(now);
  const key = monthKey(year, month);

  const orgs = await store.organizations();
  for (const [i, org] of orgs.entries()) {
    if (i > 0) await yieldToEventLoop();
    try {
      let state = await store.reportState(org.id, key);
      if (state === null) {
        const input = await store.loadMonth(org.id, year, month, now);
        if (input === null) continue;
        await store.saveReport(org.id, key, await renderPdf(input, now), now);
        state = { emailed: false };
      }
      if (state.emailed || mailer === null) continue;

      const to = await store.orgAdminEmails(org.id);
      if (to.length === 0) continue;
      const pdf = await store.claimEmail(org.id, key, now);
      if (pdf === null) continue;
      let accepted: number;
      try {
        ({ accepted } = await mailer.send({
          to,
          subject: `Uptime report for ${org.name}, ${monthTitle(year, month)}`,
          text: `The uptime report of ${org.name} for ${monthTitle(year, month)} (UTC) is attached.\n\n`
            + 'You get it because you are an organization admin. Org admins can also download it from the dashboard.\n',
          attachments: [{ filename: `uptime-report-${key}.pdf`, content: pdf }],
        }));
      } catch (error) {
        const fields = mailErrorFields(error);
        await store.releaseEmail(org.id, key, mailErrorText(fields));
        const { name: _, ...smtp } = fields;
        log(`monthly report ${key} of ${org.name} could not be emailed; it is tried again in an hour`, Object.keys(smtp).length ? smtp : fields);
        continue;
      }
      await store.markEmailed(org.id, key, now, accepted);
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

/** What the reports page and its downloads need (D-019, D-041). */
export interface ReportDownloads {
  /** The organizations a page shows, with their stored reports; null is every organization. */
  list(orgId: number | null): Promise<ReportOrg[]>;
  /** The PDF of a closed month, or null for no such organization. */
  pdf(orgId: number, year: number, month: number, now: Date): Promise<Buffer | null>;
}

/** The stored report, else one made now and not stored, so the job still emails it on its own.
 *  With a cache, a made one is rendered at most once per hour and shared by concurrent requests. */
export async function reportPdf(
  store: ReportStore, orgId: number, year: number, month: number, now: Date, cache?: PdfCache,
): Promise<Buffer | null> {
  const key = monthKey(year, month);
  const stored = await store.storedReport(orgId, key);
  if (stored) return stored;
  const make = async () => {
    const input = await store.loadMonth(orgId, year, month, now);
    return input === null ? null : render(input, now);
  };
  return cache ? cache.get(`${orgId}/${key}`, make) : make();
}
