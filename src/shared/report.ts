import { formatUptime, uptime, utcMonth, type IncidentSpan, type MaintenanceSpan } from './uptime.js';

// The monthly report of one organization (D-019, D-041), from rows already loaded: uptime per
// monitor over the UTC month (D-030), the 3 causes with the most downtime, and the monitor with
// the highest mean latency. Pure, so it is tested with plain dates (D-004).

export interface ReportMonitorInput {
  name: string;
  url: string;
  /** When the monitor's history starts (D-023); null when it has none. */
  historyStart: Date | null;
  /** Incidents overlapping the month, with the cause they opened with (`ErrorCause`). */
  incidents: (IncidentSpan & { cause: string })[];
  maintenance: MaintenanceSpan[];
  /** Mean latency of the month's scheduled checks that got a response; null when there were none. */
  latency: { meanMs: number; checks: number } | null;
}

export interface ReportInput {
  organization: string;
  year: number;
  /** 1 to 12. */
  month: number;
  monitors: ReportMonitorInput[];
}

export interface Report {
  organization: string;
  /** `YYYY-MM`. */
  month: string;
  /** "November 2026". */
  title: string;
  from: Date;
  to: Date;
  generatedAt: Date;
  monitors: { name: string; url: string; uptime: string; incidents: number; downtime: string; meanLatency: string }[];
  /** At most 3, most downtime first. */
  topCauses: { cause: string; downtime: string; incidents: number }[];
  slowest: { name: string; meanLatency: string } | null;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const TOP_CAUSES = 3;

export const CAUSE_LABEL: Record<string, string> = {
  timeout: 'Timeout',
  http_5xx: 'Server errors (5xx)',
  unexpected_status: 'Unexpected status',
  keyword_missing: 'Expected text missing',
  dns: 'DNS failure',
  tls: 'TLS certificate problem',
  connection: 'Connection failed',
  unknown: 'Unknown',
};

/** The month before the one `now` is in (UTC): the last closed month. */
export function previousMonth(now: Date): { year: number; month: number } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-based, so this is already the previous month's 1-based number
  return m === 0 ? { year: y - 1, month: 12 } : { year: y, month: m };
}

export const monthKey = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`;
export const monthTitle = (year: number, month: number) => `${MONTHS[month - 1]} ${year}`;

/** Like the status page's `duration`, but 0 is "0 min": a month without downtime has none. */
function hoursMinutes(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

const ms = (latency: number) => `${Math.round(latency)} ms`;

export function buildReport(input: ReportInput, now: Date): Report {
  const { from, to } = utcMonth(input.year, input.month);
  const period = { from, to, now };
  const causes = new Map<string, { downMs: number; incidents: number }>();

  const monitors = input.monitors.map((m) => {
    const result = uptime({ ...period, incidents: m.incidents, maintenance: m.maintenance, historyStart: m.historyStart });
    for (const incident of m.incidents) {
      // The incident's own downtime in the month, outside maintenance, as the uptime counts it.
      const own = uptime({ ...period, incidents: [incident], maintenance: m.maintenance, historyStart: m.historyStart });
      if (!own || own.downMs === 0) continue;
      const label = CAUSE_LABEL[incident.cause] ?? CAUSE_LABEL.unknown;
      const sum = causes.get(label) ?? { downMs: 0, incidents: 0 };
      causes.set(label, { downMs: sum.downMs + own.downMs, incidents: sum.incidents + 1 });
    }
    return {
      name: m.name,
      url: m.url,
      uptime: formatUptime(result),
      incidents: m.incidents.length,
      downtime: result ? hoursMinutes(result.downMs) : '—',
      meanLatency: m.latency ? ms(m.latency.meanMs) : '—',
    };
  });

  const topCauses = [...causes.entries()]
    .sort(([a, x], [b, y]) => y.downMs - x.downMs || y.incidents - x.incidents || a.localeCompare(b))
    .slice(0, TOP_CAUSES)
    .map(([cause, c]) => ({ cause, downtime: hoursMinutes(c.downMs), incidents: c.incidents }));

  let slowest: Report['slowest'] = null;
  let slowestMs = -1;
  for (const m of input.monitors) {
    if (m.latency && m.latency.meanMs > slowestMs) {
      slowestMs = m.latency.meanMs;
      slowest = { name: m.name, meanLatency: ms(m.latency.meanMs) };
    }
  }

  return {
    organization: input.organization,
    month: monthKey(input.year, input.month),
    title: monthTitle(input.year, input.month),
    from,
    to,
    generatedAt: now,
    monitors,
    topCauses,
    slowest,
  };
}
