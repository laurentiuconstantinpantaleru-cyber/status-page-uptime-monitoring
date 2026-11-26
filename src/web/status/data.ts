import type { RowDataPacket } from 'mysql2/promise';
import { loadMaintenance, type Queryable } from '../../db/maintenance.js';
import { lastDays } from '../../shared/uptime.js';
import { DAYS_SHOWN, startOfUtcDay, type IncidentUpdate, type MonitorData, type StatusData } from './model.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The counter workers bump on every monitor state change (D-020). */
export async function readStatusVersion(db: Queryable): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>('SELECT version FROM status_version WHERE id = 1');
  return Number(rows[0]?.version ?? 0);
}

/** Every monitor, grouped by organization, with what its status, uptime and 90 daily bars need. */
export async function loadStatusData(db: Queryable, now: Date): Promise<StatusData> {
  // The 90-day uptime reaches 90 × 24 h back, a little before the first daily bar.
  const { from } = lastDays(now, DAYS_SHOWN);

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
    `SELECT id, monitor_id, started_at, resolved_at, cause FROM incidents
     WHERE started_at < ? AND (resolved_at IS NULL OR resolved_at > ?)
     ORDER BY started_at`,
    [now, from],
  );
  const [updates] = await db.query<RowDataPacket[]>(
    `SELECT u.incident_id, u.stage, u.body, u.created_at FROM incident_updates u
     JOIN incidents i ON i.id = u.incident_id
     WHERE i.started_at < ? AND (i.resolved_at IS NULL OR i.resolved_at > ?)
     ORDER BY u.created_at DESC, u.id DESC`,
    [now, from],
  );
  const windowsOf = await loadMaintenance(db, from, new Date(startOfUtcDay(now).getTime() + DAY_MS));

  const lastCheck = new Map(checks.map((c) => [Number(c.monitor_id), c]));
  const byMonitor = <T>(rows: RowDataPacket[], map: (row: RowDataPacket) => T) => {
    const result = new Map<number, T[]>();
    for (const row of rows) {
      const id = Number(row.monitor_id);
      result.set(id, [...(result.get(id) ?? []), map(row)]);
    }
    return result;
  };
  const updatesOf = new Map<number, IncidentUpdate[]>();
  for (const u of updates) {
    const id = Number(u.incident_id);
    updatesOf.set(id, [...(updatesOf.get(id) ?? []), { stage: u.stage, body: u.body as string, createdAt: u.created_at as Date }]);
  }
  const incidentsOf = byMonitor(incidents, (r) => ({
    startedAt: r.started_at as Date,
    resolvedAt: r.resolved_at as Date | null,
    cause: r.cause as string,
    updates: updatesOf.get(Number(r.id)) ?? [],
  }));

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
