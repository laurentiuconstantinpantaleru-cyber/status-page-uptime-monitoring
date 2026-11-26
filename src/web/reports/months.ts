import { monthKey, monthTitle } from '../../shared/report.js';

// The months the reports page lists (DS-p26-admin-reports, D-041): every closed UTC month since
// the organization was added, newest first, with how its report was sent. Pure.

export interface StoredReportInfo {
  /** `YYYY-MM`. */
  month: string;
  emailedAt: Date | null;
  emailedTo: number | null;
  lastError: string | null;
}

export interface ReportOrg {
  id: number;
  name: string;
  createdAt: Date;
  reports: StoredReportInfo[];
}

export type MonthState =
  | { kind: 'emailed'; at: Date; to: number }
  /** Stored; the last send failed. */
  | { kind: 'failed' }
  /** Stored, not sent yet (no SMTP settings, no org admins, or a send under way). */
  | { kind: 'waiting' }
  /** Not stored: made when it is downloaded. */
  | { kind: 'ondemand' };

export interface ReportMonth {
  year: number;
  month: number;
  key: string;
  title: string;
  href: string;
  state: MonthState;
}

function stateOf(report: StoredReportInfo | undefined): MonthState {
  if (!report) return { kind: 'ondemand' };
  if (report.emailedAt) return { kind: 'emailed', at: report.emailedAt, to: report.emailedTo ?? 0 };
  return report.lastError ? { kind: 'failed' } : { kind: 'waiting' };
}

export function reportMonths(org: ReportOrg, now: Date): ReportMonth[] {
  const stored = new Map(org.reports.map((r) => [r.month, r]));
  const first = org.createdAt.getUTCFullYear() * 12 + org.createdAt.getUTCMonth();
  const months: ReportMonth[] = [];
  // From the month before `now` back to the month the organization was added (0-based months).
  for (let n = now.getUTCFullYear() * 12 + now.getUTCMonth() - 1; n >= first; n -= 1) {
    const year = Math.floor(n / 12);
    const month = (n % 12) + 1;
    const key = monthKey(year, month);
    months.push({ year, month, key, title: monthTitle(year, month), href: `/admin/reports/${org.id}/${key}.pdf`, state: stateOf(stored.get(key)) });
  }
  return months;
}

/** The day the first report of a new organization goes out: the 1st of the next UTC month. */
export function nextFirst(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}
