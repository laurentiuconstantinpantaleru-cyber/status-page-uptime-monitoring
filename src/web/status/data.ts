import type { RowDataPacket } from 'mysql2/promise';
import { DAYS_SHOWN, startOfUtcDay, type MonitorData, type StatusData } from './model.js';

/** A connection or a pool: anything that runs a query. */
export interface Queryable {
  query<T extends RowDataPacket[]>(sql: string, values?: unknown[]): Promise<[T, unknown]>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The counter workers bump on every monitor state change (D-020). */
export async function readStatusVersion(db: Queryable): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>('SELECT version FROM status_version WHERE id = 1');
  return Number(rows[0]?.version ?? 0);
}

/** Every monitor, grouped by organization, with what its status and 90 daily bars need. */
export async function loadStatusData(db: Queryable, now: Date): Promise<StatusData> {
  const from = new Date(startOfUtcDay(now).getTime() - (DAYS_SHOWN - 1) * DAY_MS);

  const [monitors] = await db.query<RowDataPacket[]>(
    `SELECT m.id, m.name, m.created_at, m.latency_threshold_ms, o.id AS org_id, o.name AS org_name
     FROM monitors m JOIN organizations o ON o.id = m.organization_id
     ORDER BY o.id, m.id`,
  );
  const [checks] = await db.query<RowDataPacket[]>(
    `SELECT monitor_id, first_at, checked_at, latency_ms FROM (
       SELECT monitor_id, checked_at, latency_ms,
              MIN(checked_at) OVER (PARTITION BY monitor_id) AS first_at,
              ROW_NUMBER() OVER (PARTITION BY monitor_id ORDER BY checked_at DESC, id DESC) AS n
       FROM checks
     ) latest WHERE n = 1`,
  );
  const [incidents] = await db.query<RowDataPacket[]>(
    `SELECT monitor_id, started_at, resolved_at FROM incidents
     WHERE started_at < ? AND (resolved_at IS NULL OR resolved_at > ?)`,
    [now, from],
  );
  const [windows] = await db.query<RowDataPacket[]>(
    'SELECT monitor_id, starts_at, ends_at FROM maintenance_windows WHERE starts_at < ? AND ends_at > ?',
    [new Date(startOfUtcDay(now).getTime() + DAY_MS), from],
  );

  const lastCheck = new Map(checks.map((c) => [Number(c.monitor_id), c]));
  const byMonitor = <T>(rows: RowDataPacket[], map: (row: RowDataPacket) => T) => {
    const result = new Map<number, T[]>();
    for (const row of rows) {
      const id = Number(row.monitor_id);
      result.set(id, [...(result.get(id) ?? []), map(row)]);
    }
    return result;
  };
  const incidentsOf = byMonitor(incidents, (r) => ({ startedAt: r.started_at as Date, resolvedAt: r.resolved_at as Date | null }));
  const windowsOf = byMonitor(windows, (r) => ({ startsAt: r.starts_at as Date, endsAt: r.ends_at as Date }));

  const groups: StatusData['groups'] = [];
  let currentOrg: number | null = null;
  for (const row of monitors) {
    const id = Number(row.id);
    if (Number(row.org_id) !== currentOrg) {
      currentOrg = Number(row.org_id);
      groups.push({ name: row.org_name as string, monitors: [] });
    }
    const check = lastCheck.get(id);
    const monitor: MonitorData = {
      name: row.name as string,
      createdAt: row.created_at as Date,
      latencyThresholdMs: row.latency_threshold_ms === null ? null : Number(row.latency_threshold_ms),
      firstCheckAt: check ? (check.first_at as Date) : null,
      lastCheck: check
        ? { checkedAt: check.checked_at as Date, latencyMs: check.latency_ms === null ? null : Number(check.latency_ms) }
        : null,
      incidents: incidentsOf.get(id) ?? [],
      maintenance: windowsOf.get(id) ?? [],
    };
    groups[groups.length - 1].monitors.push(monitor);
  }
  return { groups };
}
