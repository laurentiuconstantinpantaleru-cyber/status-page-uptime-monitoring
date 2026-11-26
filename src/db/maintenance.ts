import type { RowDataPacket } from 'mysql2/promise';
import { occurrences, type MaintenanceSchedule } from '../shared/maintenance.js';
import type { MaintenanceSpan } from '../shared/uptime.js';

/** A connection or a pool: anything that runs a query. */
export interface Queryable {
  query<T extends RowDataPacket[]>(sql: string, values?: unknown[]): Promise<[T, unknown]>;
}

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** A maintenance_schedules row as the expansion needs it (D-031). */
function toSchedule(row: RowDataPacket): MaintenanceSchedule {
  return {
    frequency: row.frequency,
    weekdays: row.weekdays === '' ? [] : String(row.weekdays).split(',').map((d) => WEEKDAYS.indexOf(d)),
    startMinute: Number(row.start_minute),
    durationMinutes: Number(row.duration_minutes),
    startsOn: new Date(`${row.starts_on}T00:00:00.000Z`),
    endedAt: row.ended_at,
  };
}

export function weekdayNames(weekdays: number[]): string {
  return weekdays.map((d) => WEEKDAYS[d]).join(',');
}

/**
 * Maintenance overlapping [from, to) per monitor: one-off and quick windows, and the windows of
 * recurring rules. All monitors, or only `monitorId`.
 */
export async function loadMaintenance(
  db: Queryable,
  from: Date,
  to: Date,
  monitorId: number | null = null,
): Promise<Map<number, MaintenanceSpan[]>> {
  const only = monitorId === null ? '' : ' AND monitor_id = ?';
  const ids = monitorId === null ? [] : [monitorId];
  const [windows] = await db.query<RowDataPacket[]>(
    `SELECT monitor_id, starts_at, ends_at FROM maintenance_windows WHERE starts_at < ? AND ends_at > ?${only}`,
    [to, from, ...ids],
  );
  // A rule's window may start up to 7 days before `from` and still run into it.
  const [schedules] = await db.query<RowDataPacket[]>(
    `SELECT monitor_id, frequency, weekdays, TIME_TO_SEC(start_time) DIV 60 AS start_minute, duration_minutes,
            DATE_FORMAT(starts_on, '%Y-%m-%d') AS starts_on, ended_at
     FROM maintenance_schedules
     WHERE starts_on < ? AND (ended_at IS NULL OR ended_at > DATE_SUB(?, INTERVAL 7 DAY))${only}`,
    [to, from, ...ids],
  );

  const result = new Map<number, MaintenanceSpan[]>();
  const add = (id: number, spans: MaintenanceSpan[]) => result.set(id, [...(result.get(id) ?? []), ...spans]);
  for (const w of windows) add(Number(w.monitor_id), [{ startsAt: w.starts_at, endsAt: w.ends_at }]);
  for (const s of schedules) add(Number(s.monitor_id), occurrences(toSchedule(s), from, to));
  return result;
}
