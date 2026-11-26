import type { RowDataPacket } from 'mysql2/promise';
import { loadMaintenance, weekdayNames, type Queryable } from '../../db/maintenance.js';
import type { Clock } from '../../shared/clock.js';
import { quickWindow, type MaintenanceSchedule } from '../../shared/maintenance.js';

// Writes for maintenance (D-012, D-031). No route calls them yet: the admin sign-in is open (Q-008).
// Each write bumps the status version, so the status page shows it within 30 s (D-020).

const bumpStatusVersion = (db: Queryable) =>
  db.query<RowDataPacket[]>('UPDATE status_version SET version = version + 1 WHERE id = 1');

async function insertWindow(
  db: Queryable,
  clock: Clock,
  w: { monitorId: number; startsAt: Date; endsAt: Date; userId: number | null },
  source: 'scheduled' | 'quick',
): Promise<number> {
  const [result] = await db.query<RowDataPacket[]>(
    `INSERT INTO maintenance_windows (monitor_id, starts_at, ends_at, source, created_by_user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [w.monitorId, w.startsAt, w.endsAt, source, w.userId, clock.now()],
  );
  await bumpStatusVersion(db);
  return (result as unknown as { insertId: number }).insertId;
}

/** A one-off window picked in the calendar. */
export function scheduleMaintenance(
  db: Queryable,
  clock: Clock,
  w: { monitorId: number; startsAt: Date; endsAt: Date; userId: number | null },
): Promise<number> {
  return insertWindow(db, clock, w, 'scheduled');
}

/** Quick maintenance from now for 15, 30 or 60 minutes; extends maintenance already in force. */
export async function startQuickMaintenance(
  db: Queryable,
  clock: Clock,
  q: { monitorId: number; minutes: number; userId: number | null },
): Promise<number> {
  const now = clock.now();
  // Maintenance in force now can reach at most 7 days ahead (a weekly rule's window).
  const ahead = new Date(now.getTime() + 7 * 24 * 60 * 60_000);
  const inForce = (await loadMaintenance(db, now, ahead, q.monitorId)).get(q.monitorId) ?? [];
  const w = quickWindow(now, q.minutes, inForce);
  return insertWindow(db, clock, { monitorId: q.monitorId, ...w, userId: q.userId }, 'quick');
}

/** A recurring rule; its windows start on `startsOn` (UTC midnight) at the earliest. */
export async function addMaintenanceSchedule(
  db: Queryable,
  clock: Clock,
  s: Omit<MaintenanceSchedule, 'endedAt'> & { monitorId: number; userId: number | null },
): Promise<number> {
  const startTime = `${String(Math.floor(s.startMinute / 60)).padStart(2, '0')}:${String(s.startMinute % 60).padStart(2, '0')}:00`;
  const [result] = await db.query<RowDataPacket[]>(
    `INSERT INTO maintenance_schedules
       (monitor_id, frequency, weekdays, start_time, duration_minutes, starts_on, created_by_user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      s.monitorId, s.frequency, weekdayNames(s.weekdays), startTime, s.durationMinutes,
      s.startsOn.toISOString().slice(0, 10), s.userId, clock.now(),
    ],
  );
  await bumpStatusVersion(db);
  return (result as unknown as { insertId: number }).insertId;
}

/** Ends a rule now: no window starts after this, one in progress ends, past ones stay. */
export async function endMaintenanceSchedule(db: Queryable, clock: Clock, id: number): Promise<void> {
  await db.query<RowDataPacket[]>('UPDATE maintenance_schedules SET ended_at = ? WHERE id = ? AND ended_at IS NULL', [
    clock.now(),
    id,
  ]);
  await bumpStatusVersion(db);
}
