import { formatUptime, lastDays, uptime } from '../../shared/uptime.js';

/** What the public status page shows for a monitor, a day, or the whole page. */
export type Status = 'ok' | 'degraded' | 'outage' | 'maint' | 'nodata';

/** A human-written incident update (D-014). */
export interface IncidentUpdate {
  stage: 'investigating' | 'identified' | 'monitoring' | 'resolved';
  body: string;
  createdAt: Date;
}

export interface Period {
  startedAt: Date;
  /** `null` while the incident is open. */
  resolvedAt: Date | null;
  /** The failure cause the incident opened with (`ErrorCause`). */
  cause?: string;
  /** Newest first; empty until someone writes one. */
  updates?: IncidentUpdate[];
}

export interface MaintenanceWindow {
  startsAt: Date;
  endsAt: Date;
}

/** One monitor as loaded from MySQL: only rows that exist, nothing derived. */
export interface MonitorData {
  name: string;
  createdAt: Date;
  latencyThresholdMs: number | null;
  /** Oldest raw check still kept (raw checks live 7 days, D-011); `null` when none. */
  firstCheckAt: Date | null;
  lastCheck: { checkedAt: Date; latencyMs: number | null } | null;
  /** Incidents overlapping the 90 × 24 h before now (the 90-day uptime, D-030). */
  incidents: Period[];
  /** Maintenance windows overlapping the 90 × 24 h before now. */
  maintenance: MaintenanceWindow[];
}

/** One card per organization, in creation order. */
export interface StatusData {
  groups: { name: string; monitors: MonitorData[] }[];
}

export interface Day {
  /** Start of the UTC day. */
  date: Date;
  status: Status;
  detail: string;
}

export const DAYS_SHOWN = 90;
const MINUTE = 60_000;
const DAY_MS = 24 * 60 * MINUTE;
/** A first check older than this means older raw checks were already removed (7-day retention, D-011). */
const RAW_HISTORY_MS = 6 * DAY_MS;

/** Worst first (Q-015); "no data" counts only when nothing else has data. */
const SEVERITY: Status[] = ['outage', 'degraded', 'maint', 'ok'];

const isOpen = (incident: Period) => incident.resolvedAt === null;
const inWindow = (window: MaintenanceWindow, now: Date) => window.startsAt <= now && now < window.endsAt;

/**
 * Down while an incident is open (opened only after confirmation, D-006); then
 * maintenance; then no data; then degraded when the last check was slower than
 * the monitor's threshold; else operational.
 */
export function monitorStatus(monitor: MonitorData, now: Date): Status {
  if (monitor.incidents.some(isOpen)) return 'outage';
  if (monitor.maintenance.some((w) => inWindow(w, now))) return 'maint';
  if (monitor.lastCheck === null) return 'nodata';
  const { latencyMs } = monitor.lastCheck;
  if (monitor.latencyThresholdMs !== null && latencyMs !== null && latencyMs > monitor.latencyThresholdMs) {
    return 'degraded';
  }
  return 'ok';
}

export function worstOf(statuses: Status[]): Status {
  return SEVERITY.find((s) => statuses.includes(s)) ?? 'nodata';
}

export const startOfUtcDay = (at: Date) => new Date(Math.floor(at.getTime() / DAY_MS) * DAY_MS);

export const hhmm = (at: Date) => at.toISOString().slice(11, 16);

export function duration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / MINUTE));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Overlap of [start, end) with [from, to), in milliseconds. */
function overlap(start: Date, end: Date, from: Date, to: Date): number {
  return Math.max(0, Math.min(end.getTime(), to.getTime()) - Math.max(start.getTime(), from.getTime()));
}

/** When the monitor's history starts: its first check, or its creation once older checks are gone (D-023). */
export function dataSince(monitor: MonitorData, now: Date): Date | null {
  const first = monitor.firstCheckAt;
  if (first === null) return null;
  if (now.getTime() - first.getTime() < RAW_HISTORY_MS) return first;
  return monitor.createdAt < first ? monitor.createdAt : first;
}

/** The last 90 UTC days, oldest first, from incidents and maintenance windows. */
export function days(monitor: MonitorData, now: Date): Day[] {
  const today = startOfUtcDay(now);
  const since = dataSince(monitor, now);
  const result: Day[] = [];

  for (let ago = DAYS_SHOWN - 1; ago >= 0; ago--) {
    const from = new Date(today.getTime() - ago * DAY_MS);
    const to = new Date(Math.min(from.getTime() + DAY_MS, now.getTime()));
    const dayEnd = new Date(from.getTime() + DAY_MS);

    if (since === null) {
      result.push({ date: from, status: 'nodata', detail: 'No checks yet' });
      continue;
    }
    if (dayEnd <= since) {
      result.push({ date: from, status: 'nodata', detail: 'No checks this day' });
      continue;
    }

    const down = monitor.incidents.filter((i) => overlap(i.startedAt, i.resolvedAt ?? now, from, to) > 0);
    if (down.length > 0) {
      const ongoing = down.find((i) => isOpen(i) && ago === 0);
      const detail = ongoing && ongoing.startedAt >= from
        ? `Down since ${hhmm(ongoing.startedAt)} UTC`
        : `Down for ${duration(down.reduce((ms, i) => ms + overlap(i.startedAt, i.resolvedAt ?? now, from, to), 0))}`;
      result.push({ date: from, status: 'outage', detail });
      continue;
    }

    const maintMs = monitor.maintenance.reduce((ms, w) => ms + overlap(w.startsAt, w.endsAt, from, to), 0);
    if (maintMs > 0) {
      result.push({ date: from, status: 'maint', detail: `Maintenance for ${duration(maintMs)}` });
      continue;
    }

    result.push({ date: from, status: 'ok', detail: 'No incidents' });
  }
  return result;
}

/** The next time the page changes without a status version bump: UTC midnight or a maintenance boundary. */
export function nextChange(data: StatusData, now: Date): Date {
  let next = startOfUtcDay(now).getTime() + DAY_MS;
  for (const group of data.groups) {
    for (const monitor of group.monitors) {
      for (const w of monitor.maintenance) {
        for (const at of [w.startsAt.getTime(), w.endsAt.getTime()]) {
          if (at > now.getTime() && at < next) next = at;
        }
      }
    }
  }
  return new Date(next);
}

/** Uptime over the `days` × 24 h before now, from incidents and maintenance (D-030); "—" without history. */
export function monitorUptime(monitor: MonitorData, now: Date, days: number): string {
  return formatUptime(uptime({
    incidents: monitor.incidents,
    maintenance: monitor.maintenance,
    ...lastDays(now, days),
    now,
    historyStart: dataSince(monitor, now),
  }));
}

export interface PastDay {
  /** Start of the UTC day the incidents started on. */
  date: Date;
  items: { monitor: string; incident: Period }[];
}

/** Resolved incidents of the last 90 days, by the UTC day they started, newest first (Q-013). */
export function pastIncidents(data: StatusData, now: Date): PastDay[] {
  const since = lastDays(now, DAYS_SHOWN).from;
  const items = data.groups
    .flatMap((g) => g.monitors.flatMap((m) => m.incidents.map((incident) => ({ monitor: m.name, incident }))))
    .filter(({ incident }) => incident.resolvedAt !== null && incident.resolvedAt > since)
    .sort((a, b) => b.incident.startedAt.getTime() - a.incident.startedAt.getTime());
  const result: PastDay[] = [];
  for (const item of items) {
    const date = startOfUtcDay(item.incident.startedAt);
    const last = result[result.length - 1];
    if (last && last.date.getTime() === date.getTime()) last.items.push(item);
    else result.push({ date, items: [item] });
  }
  return result;
}
