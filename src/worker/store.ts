import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { RecordedCheck, ScheduledCheck } from '../shared/incidents.js';
import type { WorkerRow } from './assignment.js';
import type { CheckConfig, CheckResult, ErrorCause } from './check.js';

/** A `monitors` row as a worker needs it. */
export interface MonitorRow extends CheckConfig {
  id: number;
  intervalMinutes: number;
  timeoutMs: number;
}

/** A check to store; a confirmation names the scheduled check it confirms. */
export interface NewCheck {
  monitorId: number;
  workerId: number;
  checkedAt: Date;
  kind: 'scheduled' | 'confirmation';
  confirmsCheckId: number | null;
  result: CheckResult;
}

export interface PendingConfirmation {
  checkId: number;
  monitorId: number;
}

/** Reads and writes for one monitor, inside a transaction that holds the monitor's lock. */
export interface MonitorTx {
  lastCheck(monitorId: number): Promise<RecordedCheck | null>;
  hasConfirmation(checkId: number): Promise<boolean>;
  insertCheck(check: NewCheck): Promise<number>;
  /** Newest first. */
  recentScheduled(monitorId: number, limit: number): Promise<ScheduledCheck[]>;
  hasOpenIncident(monitorId: number): Promise<boolean>;
  inMaintenance(monitorId: number, at: Date): Promise<boolean>;
  openIncident(monitorId: number, startedAt: Date, cause: ErrorCause, httpStatus: number | null): Promise<void>;
  resolveIncident(monitorId: number, resolvedAt: Date): Promise<void>;
  bumpStatusVersion(): Promise<void>;
}

export interface WorkerStore {
  /** Creates the worker row on first start, else refreshes its heartbeat; returns its id. */
  registerWorker(name: string, now: Date): Promise<number>;
  heartbeat(workerId: number, now: Date): Promise<void>;
  listWorkers(): Promise<WorkerRow[]>;
  listMonitors(): Promise<MonitorRow[]>;
  /** Scheduled `down` checks of other workers since `since` that have no confirmation yet. */
  pendingConfirmations(workerId: number, since: Date): Promise<PendingConfirmation[]>;
  inMonitorTransaction<T>(monitorId: number, fn: (tx: MonitorTx) => Promise<T>): Promise<T>;
}

const CHECK_COLUMNS = 'id, checked_at, outcome, http_status, latency_ms, error_cause';

function toCheck(row: RowDataPacket, prefix = ''): RecordedCheck {
  return {
    id: Number(row[`${prefix}id`]),
    checkedAt: row[`${prefix}checked_at`],
    outcome: row[`${prefix}outcome`],
    httpStatus: row[`${prefix}http_status`],
    latencyMs: row[`${prefix}latency_ms`],
    errorCause: row[`${prefix}error_cause`],
  };
}

function monitorTx(conn: PoolConnection): MonitorTx {
  const select = async (sql: string, params: unknown[]) => (await conn.query<RowDataPacket[]>(sql, params))[0];
  return {
    async lastCheck(monitorId) {
      const [row] = await select(
        `SELECT ${CHECK_COLUMNS} FROM checks WHERE monitor_id = ? ORDER BY checked_at DESC, id DESC LIMIT 1`,
        [monitorId],
      );
      return row ? toCheck(row) : null;
    },
    async hasConfirmation(checkId) {
      return (await select('SELECT 1 FROM checks WHERE confirms_check_id = ?', [checkId])).length > 0;
    },
    async insertCheck(c) {
      const [result] = await conn.query(
        `INSERT INTO checks
           (monitor_id, worker_id, checked_at, kind, confirms_check_id, outcome, http_status, latency_ms, error_cause, tls_expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          c.monitorId, c.workerId, c.checkedAt, c.kind, c.confirmsCheckId, c.result.outcome,
          c.result.httpStatus, c.result.latencyMs, c.result.errorCause, c.result.tlsExpiresAt,
        ],
      );
      return (result as { insertId: number }).insertId;
    },
    async recentScheduled(monitorId, limit) {
      const rows = await select(
        `SELECT s.id, s.checked_at, s.outcome, s.http_status, s.latency_ms, s.error_cause,
                c.id AS c_id, c.checked_at AS c_checked_at, c.outcome AS c_outcome,
                c.http_status AS c_http_status, c.latency_ms AS c_latency_ms, c.error_cause AS c_error_cause
         FROM checks s LEFT JOIN checks c ON c.confirms_check_id = s.id
         WHERE s.monitor_id = ? AND s.kind = 'scheduled'
         ORDER BY s.checked_at DESC, s.id DESC LIMIT ?`,
        [monitorId, limit],
      );
      return rows.map((row) => ({ check: toCheck(row), confirmation: row.c_id === null ? null : toCheck(row, 'c_') }));
    },
    async hasOpenIncident(monitorId) {
      return (await select('SELECT 1 FROM incidents WHERE monitor_id = ? AND resolved_at IS NULL', [monitorId])).length > 0;
    },
    async inMaintenance(monitorId, at) {
      const rows = await select(
        'SELECT 1 FROM maintenance_windows WHERE monitor_id = ? AND starts_at <= ? AND ends_at > ? LIMIT 1',
        [monitorId, at, at],
      );
      return rows.length > 0;
    },
    async openIncident(monitorId, startedAt, cause, httpStatus) {
      await conn.query('INSERT INTO incidents (monitor_id, started_at, cause, http_status) VALUES (?, ?, ?, ?)', [
        monitorId, startedAt, cause, httpStatus,
      ]);
    },
    async resolveIncident(monitorId, resolvedAt) {
      await conn.query('UPDATE incidents SET resolved_at = ? WHERE monitor_id = ? AND resolved_at IS NULL', [
        resolvedAt, monitorId,
      ]);
    },
    async bumpStatusVersion() {
      await conn.query('UPDATE status_version SET version = version + 1 WHERE id = 1');
    },
  };
}

/** WorkerStore on MySQL; times come from the caller's Clock (PATTERN-004). */
export class MySqlStore implements WorkerStore {
  constructor(private readonly pool: Pool) {}

  async registerWorker(name: string, now: Date): Promise<number> {
    const [result] = await this.pool.query(
      `INSERT INTO workers (name, last_seen_at, created_at) VALUES (?, ?, ?) AS new
       ON DUPLICATE KEY UPDATE last_seen_at = new.last_seen_at, id = LAST_INSERT_ID(id)`,
      [name, now, now],
    );
    return (result as { insertId: number }).insertId;
  }

  async heartbeat(workerId: number, now: Date): Promise<void> {
    await this.pool.query('UPDATE workers SET last_seen_at = ? WHERE id = ?', [now, workerId]);
  }

  async listWorkers(): Promise<WorkerRow[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>('SELECT id, last_seen_at FROM workers');
    return rows.map((r) => ({ id: Number(r.id), lastSeenAt: r.last_seen_at }));
  }

  async listMonitors(): Promise<MonitorRow[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT id, url, interval_minutes, expected_status, timeout_ms, keyword, check_tls, latency_threshold_ms
       FROM monitors ORDER BY id`,
    );
    return rows.map((r) => ({
      id: Number(r.id),
      url: r.url,
      intervalMinutes: r.interval_minutes,
      expectedStatus: r.expected_status,
      timeoutMs: r.timeout_ms,
      keyword: r.keyword,
      checkTls: Boolean(r.check_tls),
      latencyThresholdMs: r.latency_threshold_ms,
    }));
  }

  async pendingConfirmations(workerId: number, since: Date): Promise<PendingConfirmation[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT s.id, s.monitor_id FROM checks s
       WHERE s.kind = 'scheduled' AND s.outcome = 'down' AND s.worker_id <> ? AND s.checked_at >= ?
         AND NOT EXISTS (SELECT 1 FROM checks c WHERE c.confirms_check_id = s.id)
       ORDER BY s.checked_at`,
      [workerId, since],
    );
    return rows.map((r) => ({ checkId: Number(r.id), monitorId: Number(r.monitor_id) }));
  }

  /** Locks the monitor row, so two workers recording for the same monitor take turns. */
  async inMonitorTransaction<T>(monitorId: number, fn: (tx: MonitorTx) => Promise<T>): Promise<T> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('SELECT id FROM monitors WHERE id = ? FOR UPDATE', [monitorId]);
      const result = await fn(monitorTx(conn));
      await conn.commit();
      return result;
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }
}
