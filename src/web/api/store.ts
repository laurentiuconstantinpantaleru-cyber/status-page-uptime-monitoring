import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { Queryable } from '../../db/maintenance.js';
import type { Clock } from '../../shared/clock.js';
import { bumpStatusVersion, inTransaction, mysqlAdminStore } from '../admin/store.js';
import type { Status } from '../status/model.js';
import type { NewMonitor } from './monitor-input.js';

// What the API and the badge read and write (D-025, D-039). A key belongs to one organization,
// and every monitor query of the API is limited to it. Values go in as `?`.

export type KeyLevel = 'read' | 'write';

export interface ApiKeyRow {
  id: number;
  organizationId: number;
  level: KeyLevel;
  keyHash: string;
  revokedAt: Date | null;
}

export interface ApiMonitor {
  id: number;
  name: string;
  url: string;
  intervalMinutes: number;
  status: Status;
}

export interface ApiStore {
  keyByPublicId(publicId: string): Promise<ApiKeyRow | null>;
  monitors(orgId: number, now: Date): Promise<ApiMonitor[]>;
  /** Inserts the monitor and bumps the status version in one transaction; returns its id. */
  createMonitor(orgId: number, monitor: NewMonitor, now: Date): Promise<number>;
  /** The status of any monitor (the badge is public), or null when there is none. */
  monitorStatus(id: number, now: Date): Promise<Status | null>;
}

export function mysqlApiStore(pool: Pool, clock: Clock): ApiStore {
  // The same rows and status rules as the admin dashboard (D-023).
  const admin = mysqlAdminStore(pool, clock);
  const flat = async (orgId: number | null, now: Date): Promise<ApiMonitor[]> =>
    (await admin.monitors(orgId, now)).flatMap((g) =>
      g.monitors.map(({ id, name, url, intervalMinutes, status }) => ({ id, name, url, intervalMinutes, status })));

  return {
    async keyByPublicId(publicId) {
      const [rows] = await pool.query<RowDataPacket[]>(
        'SELECT id, organization_id, level, key_hash, revoked_at FROM api_keys WHERE public_id = ?',
        [publicId],
      );
      const r = rows[0];
      return r
        ? { id: Number(r.id), organizationId: Number(r.organization_id), level: r.level, keyHash: r.key_hash as string, revokedAt: r.revoked_at as Date | null }
        : null;
    },

    monitors: (orgId, now) => flat(orgId, now),

    async createMonitor(orgId, m, now) {
      let id = 0;
      await inTransaction(pool, async (conn) => {
        const [result] = await conn.query(
          `INSERT INTO monitors (organization_id, name, url, interval_minutes, expected_status, timeout_ms, keyword, check_tls,
                                 latency_threshold_ms, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [orgId, m.name, m.url, m.intervalMinutes, m.expectedStatus, m.timeoutMs, m.keyword, m.checkTls, m.latencyThresholdMs, now, now],
        );
        id = (result as { insertId: number }).insertId;
        await bumpStatusVersion(conn);
      });
      return id;
    },

    async monitorStatus(id, now) {
      return (await flat(null, now)).find((m) => m.id === id)?.status ?? null;
    },
  };
}

export interface NewApiKeyRow {
  organizationSlug: string;
  name: string;
  level: KeyLevel;
  publicId: string;
  keyHash: string;
}

/** For `npm run apikey:create`; returns the row's id. */
export async function createApiKey(db: Queryable, clock: Clock, k: NewApiKeyRow): Promise<number> {
  const [orgs] = await db.query<RowDataPacket[]>('SELECT id FROM organizations WHERE slug = ?', [k.organizationSlug]);
  if (!orgs[0]) throw new Error(`No organization with the slug "${k.organizationSlug}".`);
  const [result] = await db.query<RowDataPacket[]>(
    'INSERT INTO api_keys (organization_id, name, level, public_id, key_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [Number(orgs[0].id), k.name, k.level, k.publicId, k.keyHash, clock.now()],
  );
  return (result as unknown as { insertId: number }).insertId;
}
