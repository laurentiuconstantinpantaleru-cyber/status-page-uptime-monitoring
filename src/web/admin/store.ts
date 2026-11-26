import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { loadMaintenance, type Queryable } from '../../db/maintenance.js';
import type { Clock } from '../../shared/clock.js';
import { startQuickMaintenance } from '../maintenance/store.js';
import { monitorStatus, type IncidentUpdate, type Status } from '../status/model.js';

// What the admin pages read and write (D-037, D-038). `orgId` null means every organization (a
// global admin); otherwise every query is limited to that organization. Values go in as `?`.

const DAY_MS = 24 * 60 * 60 * 1000;
/** Resolved incidents stay listed as long as the status page shows them (D-032). */
export const RESOLVED_SHOWN_MS = 90 * DAY_MS;

export interface AdminMonitor {
  id: number;
  name: string;
  url: string;
  intervalMinutes: number;
  status: Status;
  lastCheck: { checkedAt: Date; latencyMs: number | null } | null;
}

export interface AdminGroup {
  organization: string;
  monitors: AdminMonitor[];
}

export interface AdminIncident {
  id: number;
  monitor: string;
  cause: string;
  startedAt: Date;
  resolvedAt: Date | null;
  /** Newest first. */
  updates: IncidentUpdate[];
}

export interface NewIncidentUpdate {
  incidentId: number;
  userId: number | null;
  stage: IncidentUpdate['stage'];
  body: string;
}

export interface AdminStore {
  /** The name shown above the page heading. */
  organizationName(id: number): Promise<string | null>;
  monitors(orgId: number | null, now: Date): Promise<AdminGroup[]>;
  monitor(id: number, orgId: number | null): Promise<{ id: number; name: string } | null>;
  startQuickMaintenance(monitorId: number, minutes: number, userId: number): Promise<void>;
  /** Deletes the monitor with its checks, incidents and maintenance, and bumps the status version. */
  deleteMonitor(id: number): Promise<void>;
  /** Open incidents, then those resolved in the 90 × 24 h before now; newest first in each. */
  incidents(orgId: number | null, now: Date): Promise<AdminIncident[]>;
  /** One incident of `incidents()`, or null. */
  incident(id: number, orgId: number | null, now: Date): Promise<{ id: number } | null>;
  /** Inserts the update and bumps the status version in one transaction (D-033). */
  addIncidentUpdate(update: NewIncidentUpdate, now: Date): Promise<void>;
}

const orgFilter = (orgId: number | null, column: string) =>
  orgId === null ? { sql: '', values: [] as unknown[] } : { sql: ` AND ${column} = ?`, values: [orgId] as unknown[] };

export const bumpStatusVersion = (db: Queryable) =>
  db.query<RowDataPacket[]>('UPDATE status_version SET version = version + 1 WHERE id = 1');

export async function inTransaction(pool: Pool, fn: (conn: PoolConnection) => Promise<void>): Promise<void> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await fn(conn);
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export function mysqlAdminStore(pool: Pool, clock: Clock): AdminStore {
  return {
    async organizationName(id) {
      const [rows] = await pool.query<RowDataPacket[]>('SELECT name FROM organizations WHERE id = ?', [id]);
      return rows[0] ? (rows[0].name as string) : null;
    },

    async monitors(orgId, now) {
      const org = orgFilter(orgId, 'm.organization_id');
      const [monitors] = await pool.query<RowDataPacket[]>(
        `SELECT m.id, m.name, m.url, m.interval_minutes, m.latency_threshold_ms, m.created_at, o.id AS org_id, o.name AS org_name,
                EXISTS (SELECT 1 FROM incidents i WHERE i.monitor_id = m.id AND i.resolved_at IS NULL) AS has_open
         FROM monitors m JOIN organizations o ON o.id = m.organization_id
         WHERE 1 = 1${org.sql}
         ORDER BY o.id, m.id`,
        org.values,
      );
      const [checks] = await pool.query<RowDataPacket[]>(
        `SELECT monitor_id, checked_at, latency_ms FROM (
           SELECT c.monitor_id, c.checked_at, c.latency_ms,
                  ROW_NUMBER() OVER (PARTITION BY c.monitor_id ORDER BY c.checked_at DESC, c.id DESC) AS n
           FROM checks c JOIN monitors m ON m.id = c.monitor_id
           WHERE 1 = 1${org.sql}
         ) latest WHERE n = 1`,
        org.values,
      );
      const windows = await loadMaintenance(pool, now, new Date(now.getTime() + 1));
      const lastCheck = new Map(checks.map((c) => [Number(c.monitor_id), c]));

      const groups: AdminGroup[] = [];
      let currentOrg: number | null = null;
      for (const row of monitors) {
        const id = Number(row.id);
        if (Number(row.org_id) !== currentOrg) {
          currentOrg = Number(row.org_id);
          groups.push({ organization: row.org_name as string, monitors: [] });
        }
        const check = lastCheck.get(id);
        const last = check
          ? { checkedAt: check.checked_at as Date, latencyMs: check.latency_ms === null ? null : Number(check.latency_ms) }
          : null;
        const status = monitorStatus({
          name: row.name as string,
          createdAt: row.created_at as Date,
          latencyThresholdMs: row.latency_threshold_ms === null ? null : Number(row.latency_threshold_ms),
          firstCheckAt: last?.checkedAt ?? null,
          lastCheck: last,
          incidents: Number(row.has_open) ? [{ startedAt: now, resolvedAt: null }] : [],
          maintenance: windows.get(id) ?? [],
        }, now);
        groups[groups.length - 1].monitors.push({
          id, name: row.name as string, url: row.url as string, intervalMinutes: Number(row.interval_minutes), status, lastCheck: last,
        });
      }
      return groups;
    },

    async monitor(id, orgId) {
      const org = orgFilter(orgId, 'organization_id');
      const [rows] = await pool.query<RowDataPacket[]>(`SELECT id, name FROM monitors WHERE id = ?${org.sql}`, [id, ...org.values]);
      return rows[0] ? { id: Number(rows[0].id), name: rows[0].name as string } : null;
    },

    async startQuickMaintenance(monitorId, minutes, userId) {
      await startQuickMaintenance(pool, clock, { monitorId, minutes, userId });
    },

    async deleteMonitor(id) {
      await inTransaction(pool, async (conn) => {
        await conn.query('DELETE FROM monitors WHERE id = ?', [id]);
        await bumpStatusVersion(conn);
      });
    },

    async incidents(orgId, now) {
      const org = orgFilter(orgId, 'm.organization_id');
      const since = new Date(now.getTime() - RESOLVED_SHOWN_MS);
      const [incidents] = await pool.query<RowDataPacket[]>(
        `SELECT i.id, i.started_at, i.resolved_at, i.cause, m.name AS monitor
         FROM incidents i JOIN monitors m ON m.id = i.monitor_id
         WHERE (i.resolved_at IS NULL OR i.resolved_at > ?)${org.sql}
         ORDER BY i.resolved_at IS NULL DESC, i.started_at DESC, i.id DESC`,
        [since, ...org.values],
      );
      const ids = incidents.map((i) => Number(i.id));
      const [updates] = ids.length
        ? await pool.query<RowDataPacket[]>(
          `SELECT incident_id, stage, body, created_at FROM incident_updates
           WHERE incident_id IN (?) ORDER BY created_at DESC, id DESC`,
          [ids],
        )
        : [[] as RowDataPacket[]];
      const updatesOf = new Map<number, IncidentUpdate[]>();
      for (const u of updates) {
        const id = Number(u.incident_id);
        updatesOf.set(id, [...(updatesOf.get(id) ?? []), { stage: u.stage, body: u.body as string, createdAt: u.created_at as Date }]);
      }
      return incidents.map((i) => ({
        id: Number(i.id),
        monitor: i.monitor as string,
        cause: i.cause as string,
        startedAt: i.started_at as Date,
        resolvedAt: i.resolved_at as Date | null,
        updates: updatesOf.get(Number(i.id)) ?? [],
      }));
    },

    async incident(id, orgId, now) {
      const org = orgFilter(orgId, 'm.organization_id');
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT i.id FROM incidents i JOIN monitors m ON m.id = i.monitor_id
         WHERE i.id = ? AND (i.resolved_at IS NULL OR i.resolved_at > ?)${org.sql}`,
        [id, new Date(now.getTime() - RESOLVED_SHOWN_MS), ...org.values],
      );
      return rows[0] ? { id: Number(rows[0].id) } : null;
    },

    async addIncidentUpdate(u, now) {
      // The bump goes first, so a failed insert visibly rolls it back.
      await inTransaction(pool, async (conn) => {
        await bumpStatusVersion(conn);
        await conn.query(
          'INSERT INTO incident_updates (incident_id, author_user_id, stage, body, created_at) VALUES (?, ?, ?, ?, ?)',
          [u.incidentId, u.userId, u.stage, u.body, now],
        );
      });
    },
  };
}
