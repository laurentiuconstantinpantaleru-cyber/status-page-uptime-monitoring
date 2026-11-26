/** An incident as uptime needs it; `resolvedAt` is null while it is open. */
export interface IncidentSpan {
  startedAt: Date;
  resolvedAt: Date | null;
}

export interface MaintenanceSpan {
  startsAt: Date;
  endsAt: Date;
}

export interface UptimeInput {
  incidents: IncidentSpan[];
  maintenance: MaintenanceSpan[];
  /** The period, [from, to). */
  from: Date;
  to: Date;
  now: Date;
  /** When the monitor's history starts (D-023); null when it has none. */
  historyStart: Date | null;
}

export interface Uptime {
  /** From max(from, historyStart) to min(to, now). */
  measuredMs: number;
  /** Maintenance inside the measured time, overlapping windows counted once. */
  maintenanceMs: number;
  /** Incidents inside the measured time and outside maintenance. */
  downMs: number;
  ratio: number;
}

type Span = [start: number, end: number];

/** Sorted, non-overlapping spans covering the same time, clipped to [from, to). */
function union(spans: Span[], from: number, to: number): Span[] {
  const clipped = spans
    .map(([s, e]): Span => [Math.max(s, from), Math.min(e, to)])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  const merged: Span[] = [];
  for (const [s, e] of clipped) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged;
}

const length = (spans: Span[]) => spans.reduce((ms, [s, e]) => ms + e - s, 0);

/** Time two sorted, non-overlapping span lists share. */
function shared(a: Span[], b: Span[]): number {
  let ms = 0;
  for (const [as, ae] of a) {
    for (const [bs, be] of b) ms += Math.max(0, Math.min(ae, be) - Math.max(as, bs));
  }
  return ms;
}

/**
 * Uptime = (measured − maintenance − downtime) / (measured − maintenance), from incidents and
 * maintenance windows, never from check counts (D-012). Null when no time is left to measure.
 */
export function uptime({ incidents, maintenance, from, to, now, historyStart }: UptimeInput): Uptime | null {
  if (historyStart === null) return null;
  const start = Math.max(from.getTime(), historyStart.getTime());
  const end = Math.min(to.getTime(), now.getTime());
  if (end <= start) return null;

  const maint = union(maintenance.map((w) => [w.startsAt.getTime(), w.endsAt.getTime()]), start, end);
  const down = union(
    incidents.map((i) => [i.startedAt.getTime(), (i.resolvedAt ?? now).getTime()]),
    start,
    end,
  );
  const measuredMs = end - start;
  const maintenanceMs = length(maint);
  const downMs = length(down) - shared(down, maint);
  const counted = measuredMs - maintenanceMs;
  if (counted <= 0) return null;
  return { measuredMs, maintenanceMs, downMs, ratio: (counted - downMs) / counted };
}

/** Percent truncated to 2 decimals, so any downtime shows below 100.00%; "—" without a value. */
export function formatUptime(result: Uptime | null): string {
  if (result === null) return '—';
  const counted = result.measuredMs - result.maintenanceMs;
  // Whole milliseconds, so the truncation is exact.
  const hundredths = Math.floor(((counted - result.downMs) * 10_000) / counted);
  return `${(hundredths / 100).toFixed(2)}%`;
}

/** A UTC calendar month, `month` from 1 to 12. */
export function utcMonth(year: number, month: number): { from: Date; to: Date } {
  return { from: new Date(Date.UTC(year, month - 1, 1)), to: new Date(Date.UTC(year, month, 1)) };
}

/** The `days` × 24 h before `now`. */
export function lastDays(now: Date, days: number): { from: Date; to: Date } {
  return { from: new Date(now.getTime() - days * 24 * 3_600_000), to: now };
}
