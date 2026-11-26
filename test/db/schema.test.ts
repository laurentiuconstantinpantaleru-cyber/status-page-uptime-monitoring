import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { connect, createPool } from '../../src/db/connection.js';
import { MIGRATIONS_DIR, migrate } from '../../src/db/migrate.js';
import { FakeClock } from '../../src/shared/clock.js';
import { loadStatusData, readStatusVersion } from '../../src/web/status/data.js';
import { monitorStatus } from '../../src/web/status/model.js';
import {
  addMaintenanceSchedule,
  endMaintenanceSchedule,
  scheduleMaintenance,
  startQuickMaintenance,
} from '../../src/web/maintenance/store.js';
import type { CheckResult } from '../../src/worker/check.js';
import { MySqlStore } from '../../src/worker/store.js';
import { mysqlAdminStore } from '../../src/web/admin/store.js';
import { hashPassword } from '../../src/web/auth/password.js';
import { createUser, mysqlAuthStore } from '../../src/web/auth/store.js';
import { recordCheck } from '../../src/worker/worker.js';
import { hashSecret, newApiKey } from '../../src/web/api/keys.js';
import type { NewMonitor } from '../../src/web/api/monitor-input.js';
import { createApiKey, mysqlApiStore } from '../../src/web/api/store.js';
import { mysqlReportStore } from '../../src/web/reports/store.js';
import { loadMaintenance } from '../../src/db/maintenance.js';

// Integration tests against a real MySQL 8. CI always sets TEST_DATABASE_URL.
// The database is wiped, so its name must end in `_test`.
const url = process.env.TEST_DATABASE_URL;
if (!url) {
  process.stderr.write('TEST_DATABASE_URL is not set: skipping the MySQL schema tests.\n');
}

const T0 = new Date('2026-11-01T02:00:00.123Z');

async function rows<T = RowDataPacket>(conn: Connection, sql: string, params: unknown[] = []): Promise<T[]> {
  const [result] = await conn.query<RowDataPacket[]>(sql, params);
  return result as T[];
}

async function insertId(conn: Connection, sql: string, params: unknown[]): Promise<number> {
  const [result] = await conn.query(sql, params);
  return (result as { insertId: number }).insertId;
}

describe.skipIf(!url)('MySQL schema', () => {
  let conn: Connection;
  let firstRun: string[];
  let orgId: number;
  let monitorId: number;
  let workerId: number;

  beforeAll(async () => {
    conn = await connect(url!, { multipleStatements: true });
    const [[{ db }]] = await conn.query<RowDataPacket[]>('SELECT DATABASE() AS db');
    if (typeof db !== 'string' || !db.endsWith('_test')) {
      throw new Error(`Refusing to wipe database "${db}": its name must end in _test`);
    }
    const tables = await rows<{ name: string }>(
      conn,
      'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()',
    );
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const { name } of tables) {
      await conn.query(`DROP TABLE \`${name}\``);
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');

    firstRun = await migrate(conn, MIGRATIONS_DIR, new FakeClock(T0));

    orgId = await insertId(conn, 'INSERT INTO organizations (slug, name, created_at, updated_at) VALUES (?, ?, ?, ?)', [
      'test-org',
      'Test Org',
      T0,
      T0,
    ]);
    monitorId = await insertId(
      conn,
      `INSERT INTO monitors (organization_id, name, url, timeout_ms, check_tls, created_at, updated_at)
       VALUES (?, 'Test', 'https://example.test/', 10000, 1, ?, ?)`,
      [orgId, T0, T0],
    );
    workerId = await insertId(conn, 'INSERT INTO workers (name, created_at) VALUES (?, ?)', ['worker-test', T0]);
  });

  afterAll(async () => {
    await conn?.end();
  });

  it('applies every migration on an empty database and records it', async () => {
    expect(firstRun).toEqual([
      '0001_initial_schema.sql',
      '0002_seed_local_businesses.sql',
      '0003_status_version.sql',
      '0004_check_confirmations.sql',
      '0005_worker_faults.sql',
      '0006_maintenance_schedules.sql',
      '0007_auth.sql',
      '0008_monthly_reports.sql',
    ]);

    const applied = await rows<{ version: string; applied_at: Date }>(
      conn,
      'SELECT version, applied_at FROM schema_migrations ORDER BY version',
    );
    expect(applied.map((r) => r.version)).toEqual(firstRun);
    expect(applied[0].applied_at.toISOString()).toBe(T0.toISOString());
  });

  it('does nothing on a second run', async () => {
    expect(await migrate(conn, MIGRATIONS_DIR, new FakeClock(T0))).toEqual([]);
  });

  it('runs every session in UTC and keeps milliseconds', async () => {
    const [[{ tz }]] = await conn.query<RowDataPacket[]>('SELECT @@session.time_zone AS tz');
    expect(tz).toBe('+00:00');

    const id = await insertId(conn, 'INSERT INTO workers (name, created_at) VALUES (?, ?)', ['worker-ms', T0]);
    const [[row]] = await conn.query<RowDataPacket[]>(
      "SELECT created_at, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s.%f') AS raw FROM workers WHERE id = ?",
      [id],
    );
    expect((row.created_at as Date).toISOString()).toBe('2026-11-01T02:00:00.123Z');
    expect(row.raw).toBe('2026-11-01 02:00:00.123000');
  });

  it('rejects a check for a monitor that does not exist', async () => {
    await expect(
      conn.query(
        "INSERT INTO checks (monitor_id, worker_id, checked_at, kind, outcome) VALUES (?, ?, ?, 'scheduled', 'up')",
        [999999, workerId, T0],
      ),
    ).rejects.toThrow(/foreign key/i);
  });

  it('checks a monitor every 5 minutes when no interval is given (D-016)', async () => {
    const id = await insertId(
      conn,
      `INSERT INTO monitors (organization_id, name, url, timeout_ms, check_tls, created_at, updated_at)
       VALUES (?, 'default-interval', 'https://example.test/', 10000, 0, ?, ?)`,
      [orgId, T0, T0],
    );

    const [monitor] = await rows<{ interval_minutes: number }>(conn, 'SELECT interval_minutes FROM monitors WHERE id = ?', [id]);
    expect(monitor.interval_minutes).toBe(5);
  });

  it('accepts check intervals from 1 to 60 minutes only', async () => {
    const insert = (interval: number) =>
      conn.query(
        `INSERT INTO monitors (organization_id, name, url, interval_minutes, timeout_ms, check_tls, created_at, updated_at)
         VALUES (?, ?, 'https://example.test/', ?, 10000, 0, ?, ?)`,
        [orgId, `interval-${interval}`, interval, T0, T0],
      );

    await expect(insert(0)).rejects.toThrow(/check constraint/i);
    await expect(insert(61)).rejects.toThrow(/check constraint/i);
    await expect(insert(1)).resolves.toBeDefined();
    await expect(insert(60)).resolves.toBeDefined();
  });

  it('allows at most one open incident per monitor', async () => {
    const open = (startedAt: Date) =>
      conn.query("INSERT INTO incidents (monitor_id, started_at, cause) VALUES (?, ?, 'timeout')", [
        monitorId,
        startedAt,
      ]);

    const [first] = await open(T0);
    await expect(open(new Date(T0.getTime() + 60_000))).rejects.toThrow(/duplicate/i);

    await conn.query('UPDATE incidents SET resolved_at = ? WHERE id = ?', [
      new Date(T0.getTime() + 120_000),
      (first as { insertId: number }).insertId,
    ]);
    await expect(open(new Date(T0.getTime() + 180_000))).resolves.toBeDefined();
  });

  it('ties global admins to no organization and everyone else to one', async () => {
    const insert = (email: string, organizationId: number | null, role: string) =>
      conn.query(
        'INSERT INTO users (organization_id, email, display_name, role, created_at) VALUES (?, ?, ?, ?, ?)',
        [organizationId, email, 'Test', role, T0],
      );

    await expect(insert('a@example.test', orgId, 'global_admin')).rejects.toThrow(/check constraint/i);
    await expect(insert('b@example.test', null, 'member')).rejects.toThrow(/check constraint/i);
    await expect(insert('c@example.test', null, 'global_admin')).resolves.toBeDefined();
    await expect(insert('d@example.test', orgId, 'org_admin')).resolves.toBeDefined();
  });

  it('seeds the two local businesses that gave consent', async () => {
    const seeded = await rows(
      conn,
      `SELECT o.slug, o.name AS org_name, m.url, m.interval_minutes, m.expected_status, m.timeout_ms,
              m.check_tls, m.keyword, m.latency_threshold_ms
       FROM monitors m JOIN organizations o ON o.id = m.organization_id
       WHERE o.slug IN ('hug-the-mug', 'cafe-wien')
       ORDER BY o.slug`,
    );

    expect(seeded).toEqual([
      {
        slug: 'cafe-wien',
        org_name: 'Cafe Wien Sibiu',
        url: 'http://cafewien.ro/',
        interval_minutes: 5,
        expected_status: 200,
        timeout_ms: 10000,
        check_tls: 0,
        keyword: null,
        latency_threshold_ms: null,
      },
      {
        slug: 'hug-the-mug',
        org_name: 'Hug The Mug',
        url: 'https://hugthemug.ro/',
        interval_minutes: 5,
        expected_status: 200,
        timeout_ms: 10000,
        check_tls: 1,
        keyword: null,
        latency_threshold_ms: null,
      },
    ]);
  });

  it('serves the main check and incident queries from their indexes', async () => {
    for (let i = 0; i < 5; i++) {
      await conn.query(
        "INSERT INTO checks (monitor_id, worker_id, checked_at, kind, outcome) VALUES (?, ?, ?, 'scheduled', 'up')",
        [monitorId, workerId, new Date(T0.getTime() + i * 60_000)],
      );
    }
    await conn.query('ANALYZE TABLE checks, incidents');

    const [[latest]] = await conn.query<RowDataPacket[]>(
      'EXPLAIN SELECT * FROM checks WHERE monitor_id = ? ORDER BY checked_at DESC LIMIT 2',
      [monitorId],
    );
    expect(latest.key).toBe('idx_checks_monitor_checked');

    const [[overlap]] = await conn.query<RowDataPacket[]>(
      `EXPLAIN SELECT * FROM incidents
       WHERE monitor_id = ? AND started_at < ? AND (resolved_at IS NULL OR resolved_at > ?)`,
      [monitorId, new Date('2026-12-01T00:00:00Z'), new Date('2026-11-01T00:00:00Z')],
    );
    expect(overlap.key).toBe('idx_incidents_monitor_started');
  });

  describe('status page data', () => {
    const NOW = new Date('2026-11-26T14:55:00.000Z');
    const MIN = 60_000;

    it('starts the status version at 0 and reads a bump (D-020)', async () => {
      expect(await readStatusVersion(conn)).toBe(0);

      await conn.query('UPDATE status_version SET version = version + 1 WHERE id = 1');

      expect(await readStatusVersion(conn)).toBe(1);
    });

    it('loads each monitor of an organization with what its status needs', async () => {
      const org = await insertId(conn, 'INSERT INTO organizations (slug, name, created_at, updated_at) VALUES (?, ?, ?, ?)', [
        'status-org', 'Status Org', T0, T0,
      ]);
      const addMonitor = (name: string, threshold: number | null) =>
        insertId(
          conn,
          `INSERT INTO monitors (organization_id, name, url, timeout_ms, check_tls, latency_threshold_ms, created_at, updated_at)
           VALUES (?, ?, 'https://example.test/', 10000, 0, ?, ?, ?)`,
          [org, name, threshold, T0, T0],
        );
      const addCheck = (monitor: number, at: Date, latencyMs: number) =>
        conn.query(
          "INSERT INTO checks (monitor_id, worker_id, checked_at, kind, outcome, latency_ms) VALUES (?, ?, ?, 'scheduled', 'up', ?)",
          [monitor, workerId, at, latencyMs],
        );

      await addMonitor('No checks yet', null);
      const slow = await addMonitor('Slow site', 100);
      const down = await addMonitor('Down site', null);
      const maint = await addMonitor('Site in maintenance', null);
      await addCheck(slow, new Date(NOW.getTime() - 10 * MIN), 80);
      await addCheck(slow, new Date(NOW.getTime() - 5 * MIN), 500);
      await addCheck(down, new Date(NOW.getTime() - 5 * MIN), 90);
      await addCheck(maint, new Date(NOW.getTime() - 5 * MIN), 90);
      await conn.query("INSERT INTO incidents (monitor_id, started_at, cause) VALUES (?, ?, 'timeout')", [
        down, new Date(NOW.getTime() - 50 * MIN),
      ]);
      await conn.query("INSERT INTO incidents (monitor_id, started_at, resolved_at, cause) VALUES (?, ?, ?, 'timeout')", [
        down, new Date('2026-06-01T10:00:00Z'), new Date('2026-06-01T11:00:00Z'),
      ]);
      await conn.query(
        "INSERT INTO maintenance_windows (monitor_id, starts_at, ends_at, source, created_at) VALUES (?, ?, ?, 'quick', ?)",
        [maint, new Date(NOW.getTime() - 15 * MIN), new Date(NOW.getTime() + 15 * MIN), T0],
      );

      const data = await loadStatusData(conn, NOW);
      const group = data.groups.find((g) => g.name === 'Status Org');

      expect(group?.monitors.map((m) => m.name)).toEqual(['No checks yet', 'Slow site', 'Down site', 'Site in maintenance']);
      expect(group?.monitors.map((m) => monitorStatus(m, NOW))).toEqual(['nodata', 'degraded', 'outage', 'maint']);
      const [noChecks, slowSite, downSite] = group!.monitors;
      expect(noChecks).toMatchObject({ firstCheckAt: null, lastCheck: null });
      expect(slowSite.firstCheckAt?.toISOString()).toBe(new Date(NOW.getTime() - 10 * MIN).toISOString());
      expect(slowSite.lastCheck?.latencyMs).toBe(500);
      expect(downSite.incidents).toHaveLength(1);
    });

    it('loads each incident with its cause and its updates, newest first, from the 90 days uptime needs', async () => {
      const org = await insertId(conn, 'INSERT INTO organizations (slug, name, created_at, updated_at) VALUES (?, ?, ?, ?)', [
        'incident-org', 'Incident Org', T0, T0,
      ]);
      const site = await insertId(
        conn,
        `INSERT INTO monitors (organization_id, name, url, timeout_ms, check_tls, created_at, updated_at)
         VALUES (?, 'Incident site', 'https://example.test/', 10000, 0, ?, ?)`,
        [org, T0, T0],
      );
      const addIncident = (startedAt: Date, resolvedAt: Date | null, cause: string) =>
        insertId(conn, 'INSERT INTO incidents (monitor_id, started_at, resolved_at, cause) VALUES (?, ?, ?, ?)', [
          site, startedAt, resolvedAt, cause,
        ]);
      // Ends 90 × 24 h before NOW plus 1 h: inside the 90-day uptime, before the first daily bar.
      const early = new Date(NOW.getTime() - 90 * 24 * 60 * MIN);
      await addIncident(new Date(early.getTime() - 60 * MIN), new Date(early.getTime() + 60 * MIN), 'dns');
      const open = await addIncident(new Date(NOW.getTime() - 50 * MIN), null, 'timeout');
      const addUpdate = (stage: string, body: string, createdAt: Date) =>
        conn.query('INSERT INTO incident_updates (incident_id, stage, body, created_at) VALUES (?, ?, ?, ?)', [
          open, stage, body, createdAt,
        ]);
      await addUpdate('investigating', 'Looking into it.', new Date(NOW.getTime() - 45 * MIN));
      await addUpdate('identified', 'Found it.', new Date(NOW.getTime() - 20 * MIN));

      const data = await loadStatusData(conn, NOW);
      const incidents = data.groups.find((g) => g.name === 'Incident Org')!.monitors[0].incidents;

      expect(incidents.map((i) => i.cause)).toEqual(['dns', 'timeout']);
      expect(incidents[0].updates).toEqual([]);
      expect(incidents[1].updates?.map((u) => [u.stage, u.body, u.createdAt.toISOString()])).toEqual([
        ['identified', 'Found it.', new Date(NOW.getTime() - 20 * MIN).toISOString()],
        ['investigating', 'Looking into it.', new Date(NOW.getTime() - 45 * MIN).toISOString()],
      ]);
    });

    it('lists organizations in the order they were created', async () => {
      const names = (await loadStatusData(conn, NOW)).groups.map((g) => g.name);

      expect(names.indexOf('Hug The Mug')).toBeLessThan(names.indexOf('Status Org'));
    });
  });

  // Runs last: it bumps the status version that 'status page data' expects to start at 0.
  describe('worker store (D-027)', () => {
    const NOW = new Date('2026-11-26T16:00:00.000Z');
    const DOWN: CheckResult = {
      outcome: 'down',
      httpStatus: 503,
      latencyMs: 120,
      errorCause: 'http_5xx',
      slow: false,
      tlsExpiresAt: null,
      tlsDaysRemaining: null,
    };
    const store = () => new MySqlStore(pool);
    let pool: ReturnType<typeof createPool>;
    let monitor: number;
    let first: number;
    let second: number;
    const config = { latencyThresholdMs: null };

    beforeAll(async () => {
      pool = createPool(url!);
      const org = await insertId(conn, 'INSERT INTO organizations (slug, name, created_at, updated_at) VALUES (?, ?, ?, ?)', [
        'worker-org', 'Worker Org', T0, T0,
      ]);
      monitor = await insertId(
        conn,
        `INSERT INTO monitors (organization_id, name, url, timeout_ms, check_tls, created_at, updated_at)
         VALUES (?, 'Worker site', 'https://example.test/', 10000, 0, ?, ?)`,
        [org, T0, T0],
      );
      first = await store().registerWorker('worker-store-1', NOW);
      second = await store().registerWorker('worker-store-2', NOW);
    });

    afterAll(async () => {
      await pool?.end();
    });

    it('registers a worker once by name and moves its heartbeat', async () => {
      const later = new Date(NOW.getTime() + 10_000);

      expect(await store().registerWorker('worker-store-1', NOW)).toBe(first);
      await store().heartbeat(first, later);

      const workers = await store().listWorkers();
      expect(workers.find((w) => w.id === first)?.lastSeenAt?.toISOString()).toBe(later.toISOString());
    });

    it('rejects a second confirmation of the same check', async () => {
      const checkId = await insertId(
        conn,
        "INSERT INTO checks (monitor_id, worker_id, checked_at, kind, outcome) VALUES (?, ?, ?, 'scheduled', 'down')",
        [monitor, first, NOW],
      );
      const confirm = () =>
        conn.query(
          "INSERT INTO checks (monitor_id, worker_id, checked_at, kind, outcome, confirms_check_id) VALUES (?, ?, ?, 'confirmation', 'down', ?)",
          [monitor, second, NOW, checkId],
        );

      await confirm();
      await expect(confirm()).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
    });

    it('lists only unconfirmed down checks of the other workers since a time', async () => {
      const scheduled = (worker: number, at: Date) =>
        recordCheck(store(), { monitorId: monitor, workerId: worker, checkedAt: at, kind: 'scheduled', confirmsCheckId: null, result: DOWN }, config);
      await scheduled(first, new Date(NOW.getTime() + 60_000));
      await scheduled(second, new Date(NOW.getTime() + 60_000));
      await scheduled(first, new Date(NOW.getTime() - 10 * 60_000));

      const pending = await store().pendingConfirmations(second, NOW);

      expect(pending).toHaveLength(1);
      expect(pending[0].monitorId).toBe(monitor);
    });

    it('opens one incident and bumps the status version when two workers confirm at the same time', async () => {
      await conn.query('DELETE FROM checks WHERE monitor_id = ?', [monitor]);
      const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
      const add = (kind: 'scheduled' | 'confirmation', worker: number, checkedAt: Date, confirmsCheckId: number | null) =>
        recordCheck(store(), { monitorId: monitor, workerId: worker, checkedAt, kind, confirmsCheckId, result: DOWN }, config);
      const idOf = async (checkedAt: Date) =>
        (await rows<{ id: number }>(conn, "SELECT id FROM checks WHERE monitor_id = ? AND kind = 'scheduled' AND checked_at = ?", [monitor, checkedAt]))[0].id;

      await add('scheduled', first, at(10), null);
      await add('confirmation', second, at(10.1), await idOf(at(10)));
      await add('scheduled', first, at(15), null);
      const before = await readStatusVersion(conn);

      const results = await Promise.all([
        add('confirmation', second, at(15.1), await idOf(at(15))),
        add('confirmation', second, at(15.1), await idOf(at(15))),
      ]);

      expect(results.sort()).toEqual(['duplicate', 'recorded']);
      const open = await rows<{ started_at: Date; cause: string }>(
        conn,
        'SELECT started_at, cause FROM incidents WHERE monitor_id = ? AND resolved_at IS NULL',
        [monitor],
      );
      expect(open).toHaveLength(1);
      expect(open[0].started_at.toISOString()).toBe(at(10).toISOString());
      expect(open[0].cause).toBe('http_5xx');
      expect(await readStatusVersion(conn)).toBe(before + 1);
    });

    it("reads a worker's scheduled checks in a window with their confirmations (D-015)", async () => {
      await conn.query('DELETE FROM checks WHERE monitor_id = ?', [monitor]);
      const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
      const old = await insertId(
        conn,
        "INSERT INTO checks (monitor_id, worker_id, checked_at, kind, outcome) VALUES (?, ?, ?, 'scheduled', 'down')",
        [monitor, first, at(20)],
      );
      const recent = await insertId(
        conn,
        "INSERT INTO checks (monitor_id, worker_id, checked_at, kind, outcome) VALUES (?, ?, ?, 'scheduled', 'down')",
        [monitor, first, at(31)],
      );
      for (const id of [old, recent]) {
        await conn.query(
          "INSERT INTO checks (monitor_id, worker_id, checked_at, kind, outcome, confirms_check_id) VALUES (?, ?, ?, 'confirmation', 'up', ?)",
          [monitor, second, at(31.1), id],
        );
      }

      expect(await store().workerWindow(first, at(30))).toEqual([{ monitorId: monitor, outcome: 'down', confirmation: 'up' }]);
      expect(await store().workerWindow(second, at(30))).toEqual([]);
    });

    it('keeps one open worker_fault episode per worker and ends it (D-015)', async () => {
      const counts = { monitorsChecked: 3, checksTotal: 6, checksFailed: 6, confirmationsTotal: 6, confirmationsUp: 6 };
      const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

      expect(await store().hasOpenWorkerFault(first)).toBe(false);
      await store().openWorkerFault(first, at(40), counts);
      expect(await store().hasOpenWorkerFault(first)).toBe(true);
      await expect(store().openWorkerFault(first, at(41), counts)).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });

      await store().closeWorkerFault(first, at(45));
      expect(await store().hasOpenWorkerFault(first)).toBe(false);
      const faults = await rows<{ started_at: Date; ended_at: Date; checks_failed: number }>(
        conn,
        'SELECT started_at, ended_at, checks_failed FROM worker_faults WHERE worker_id = ?',
        [first],
      );
      expect(faults).toHaveLength(1);
      expect(faults[0].started_at.toISOString()).toBe(at(40).toISOString());
      expect(faults[0].ended_at.toISOString()).toBe(at(45).toISOString());
      expect(faults[0].checks_failed).toBe(6);
    });
  });

  // After 'status page data': these bump the status version.
  describe('maintenance (D-012, D-031)', () => {
    const NOW = new Date('2026-11-26T23:50:00.000Z');
    const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
    let pool: ReturnType<typeof createPool>;
    let org: number;
    const addMonitor = async (name: string) =>
      insertId(
        conn,
        `INSERT INTO monitors (organization_id, name, url, timeout_ms, check_tls, created_at, updated_at)
         VALUES (?, ?, 'https://example.test/', 10000, 0, ?, ?)`,
        [org, name, T0, T0],
      );
    const inMaintenance = (monitor: number, t: Date) =>
      new MySqlStore(pool).inMonitorTransaction(monitor, (tx) => tx.inMaintenance(monitor, t));
    /** Every day 23:30–00:30 UTC from 2026-11-20. */
    const nightly = {
      frequency: 'daily' as const,
      weekdays: [],
      startMinute: 23 * 60 + 30,
      durationMinutes: 60,
      startsOn: new Date('2026-11-20T00:00:00.000Z'),
    };

    beforeAll(async () => {
      pool = createPool(url!);
      org = await insertId(conn, 'INSERT INTO organizations (slug, name, created_at, updated_at) VALUES (?, ?, ?, ?)', [
        'maint-org', 'Maintenance Org', T0, T0,
      ]);
    });

    afterAll(async () => {
      await pool?.end();
    });

    it('accepts a daily rule under 24 h and a weekly rule under 7 days, with weekdays only when weekly', async () => {
      const monitor = await addMonitor('Rule limits');
      const add = (frequency: string, weekdays: string, duration: number) =>
        conn.query(
          `INSERT INTO maintenance_schedules
             (monitor_id, frequency, weekdays, start_time, duration_minutes, starts_on, created_at)
           VALUES (?, ?, ?, '23:30:00', ?, '2026-11-20', ?)`,
          [monitor, frequency, weekdays, duration, T0],
        );
      const rejected = { code: 'ER_CHECK_CONSTRAINT_VIOLATED' };

      await add('daily', '', 1439);
      await add('weekly', 'sun,thu', 10079);
      await expect(add('daily', '', 1440)).rejects.toMatchObject(rejected);
      await expect(add('weekly', 'mon', 10080)).rejects.toMatchObject(rejected);
      await expect(add('daily', '', 0)).rejects.toMatchObject(rejected);
      await expect(add('weekly', '', 60)).rejects.toMatchObject(rejected);
      await expect(add('daily', 'mon', 60)).rejects.toMatchObject(rejected);
    });

    it('holds maintenance across midnight for a recurring rule, in the worker and on the status page', async () => {
      const monitor = await addMonitor('Nightly');
      await addMaintenanceSchedule(pool, new FakeClock(T0), { monitorId: monitor, ...nightly, userId: null });

      expect(await inMaintenance(monitor, at(-21))).toBe(false);
      expect(await inMaintenance(monitor, at(25))).toBe(true);
      expect(await inMaintenance(monitor, at(40))).toBe(false);
      const site = (await loadStatusData(conn, at(25))).groups
        .find((g) => g.name === 'Maintenance Org')!
        .monitors.find((m) => m.name === 'Nightly')!;
      expect(monitorStatus(site, at(25))).toBe('maint');
      expect(site.maintenance.map((w) => w.startsAt.toISOString())).toContain('2026-11-20T23:30:00.000Z');
    });

    it('ends a rule without removing its past windows', async () => {
      const monitor = await addMonitor('Ended rule');
      const id = await addMaintenanceSchedule(pool, new FakeClock(T0), { monitorId: monitor, ...nightly, userId: null });

      await endMaintenanceSchedule(pool, new FakeClock(at(-15)), id);

      expect(await inMaintenance(monitor, at(-10))).toBe(false);
      expect(await inMaintenance(monitor, new Date('2026-11-25T23:45:00.000Z'))).toBe(true);
    });

    it('schedules a one-off window and bumps the status version (D-020)', async () => {
      const monitor = await addMonitor('One-off');
      const before = await readStatusVersion(conn);

      await scheduleMaintenance(pool, new FakeClock(T0), { monitorId: monitor, startsAt: at(0), endsAt: at(60), userId: null });

      expect(await inMaintenance(monitor, at(30))).toBe(true);
      expect(await readStatusVersion(conn)).toBe(before + 1);
      const [window] = await rows<{ source: string; created_at: Date }>(
        conn, 'SELECT source, created_at FROM maintenance_windows WHERE monitor_id = ?', [monitor],
      );
      expect(window).toMatchObject({ source: 'scheduled' });
      expect(window.created_at.toISOString()).toBe(T0.toISOString());
    });

    it('starts quick maintenance that expires, extends it when pressed again, and bumps the status version', async () => {
      const monitor = await addMonitor('Quick');
      const before = await readStatusVersion(conn);

      await startQuickMaintenance(pool, new FakeClock(at(0)), { monitorId: monitor, minutes: 15, userId: null });
      await startQuickMaintenance(pool, new FakeClock(at(10)), { monitorId: monitor, minutes: 30, userId: null });

      expect(await inMaintenance(monitor, at(44))).toBe(true);
      expect(await inMaintenance(monitor, at(45))).toBe(false);
      expect(await readStatusVersion(conn)).toBe(before + 2);
      const windows = await rows<{ source: string }>(
        conn, 'SELECT source FROM maintenance_windows WHERE monitor_id = ?', [monitor],
      );
      expect(windows.map((w) => w.source)).toEqual(['quick', 'quick']);
      await expect(
        startQuickMaintenance(pool, new FakeClock(at(0)), { monitorId: monitor, minutes: 20, userId: null }),
      ).rejects.toThrow(/15, 30 or 60/);
    });
  });
  describe('sign-in and admin stores (D-034–D-038)', () => {
    const NOW = new Date('2026-11-26T14:55:00.000Z');
    const DAY = 24 * 60 * 60 * 1000;
    let pool: ReturnType<typeof createPool>;
    let orgA: number;
    let orgB: number;
    let hash: string;

    beforeAll(async () => {
      pool = createPool(url!);
      hash = await hashPassword('correct-horse-battery');
      orgA = await insertId(conn, 'INSERT INTO organizations (slug, name, created_at, updated_at) VALUES (?, ?, ?, ?)', ['auth-a', 'Auth A', T0, T0]);
      orgB = await insertId(conn, 'INSERT INTO organizations (slug, name, created_at, updated_at) VALUES (?, ?, ?, ?)', ['auth-b', 'Auth B', T0, T0]);
    });

    afterAll(async () => {
      await pool?.end();
    });

    const addMonitor = (org: number, name: string) =>
      insertId(
        conn,
        `INSERT INTO monitors (organization_id, name, url, timeout_ms, check_tls, created_at, updated_at)
         VALUES (?, ?, 'https://example.test/', 10000, 0, ?, ?)`,
        [org, name, T0, T0],
      );
    const addIncident = (monitor: number, startedAt: Date, resolvedAt: Date | null) =>
      insertId(conn, "INSERT INTO incidents (monitor_id, started_at, resolved_at, cause) VALUES (?, ?, ?, 'timeout')", [monitor, startedAt, resolvedAt]);

    it('creates a user with a password hash and finds them by email', async () => {
      const clock = new FakeClock(T0);
      const id = await createUser(pool, clock, { email: 'mara@auth-a.test', displayName: 'Mara', role: 'member', organizationSlug: 'auth-a', passwordHash: hash });

      const user = await mysqlAuthStore(pool).userByEmail('mara@auth-a.test');
      expect(user).toEqual({ id, displayName: 'Mara', role: 'member', organizationId: orgA, passwordHash: hash });
      await expect(
        createUser(pool, clock, { email: 'mara@auth-a.test', displayName: 'Again', role: 'member', organizationSlug: 'auth-a', passwordHash: hash }),
      ).rejects.toThrow(/already exists/);
      await expect(
        createUser(pool, clock, { email: 'x@auth.test', displayName: 'X', role: 'member', organizationSlug: 'no-such-org', passwordHash: hash }),
      ).rejects.toThrow(/No organization with the slug "no-such-org"/);
      await expect(
        createUser(pool, clock, { email: 'g@auth.test', displayName: 'G', role: 'global_admin', organizationSlug: 'auth-a', passwordHash: hash }),
      ).rejects.toThrow(/global admin belongs to no organization/);
    });

    it.each(["' OR '1'='1", "mara@auth-a.test' -- ", '%', 'mara@auth-a.test\\'])(
      'finds no user for the injected email %j (SQL injection)',
      async (email) => {
        expect(await mysqlAuthStore(pool).userByEmail(email)).toBeNull();
      },
    );

    it('creates, reads, touches and deletes a session by its token hash', async () => {
      const auth = mysqlAuthStore(pool);
      const user = (await auth.userByEmail('mara@auth-a.test'))!;
      const tokenHash = 'a'.repeat(64);

      await auth.createSession(tokenHash, user.id, NOW);
      expect(await auth.session(tokenHash)).toEqual({
        createdAt: NOW, lastSeenAt: NOW, user: { id: user.id, displayName: 'Mara', role: 'member', organizationId: orgA },
      });
      await auth.touchSession(tokenHash, new Date(NOW.getTime() + 1000));
      expect((await auth.session(tokenHash))?.lastSeenAt.toISOString()).toBe(new Date(NOW.getTime() + 1000).toISOString());
      expect(await auth.session("' OR '1'='1")).toBeNull();
      await auth.deleteSession(tokenHash);
      expect(await auth.session(tokenHash)).toBeNull();
    });

    it('lists only the organization\'s monitors with their status; a global admin gets every organization', async () => {
      const down = await addMonitor(orgA, 'Admin down');
      await addMonitor(orgB, 'Admin other org');
      await addIncident(down, new Date(NOW.getTime() - 60 * 60 * 1000), null);
      const store = mysqlAdminStore(pool, new FakeClock(NOW));

      const own = await store.monitors(orgA, NOW);
      expect(own.map((g) => g.organization)).toEqual(['Auth A']);
      expect(own[0].monitors.find((m) => m.name === 'Admin down')).toMatchObject({ id: down, status: 'outage', intervalMinutes: 5, lastCheck: null });
      expect(own[0].monitors.some((m) => m.name === 'Admin other org')).toBe(false);
      const all = await store.monitors(null, NOW);
      expect(all.map((g) => g.organization)).toEqual(expect.arrayContaining(['Auth A', 'Auth B']));
      expect(await store.monitor(down, orgB)).toBeNull();
      expect(await store.monitor(down, orgA)).toEqual({ id: down, name: 'Admin down' });
      expect(await store.monitor(down, null)).toEqual({ id: down, name: 'Admin down' });
    });

    it('deletes a monitor with its incidents and bumps the status version', async () => {
      const monitor = await addMonitor(orgA, 'To delete');
      await addIncident(monitor, new Date(NOW.getTime() - DAY), null);
      const before = await readStatusVersion(conn);

      await mysqlAdminStore(pool, new FakeClock(NOW)).deleteMonitor(monitor);

      expect(await rows(conn, 'SELECT id FROM monitors WHERE id = ?', [monitor])).toEqual([]);
      expect(await rows(conn, 'SELECT id FROM incidents WHERE monitor_id = ?', [monitor])).toEqual([]);
      expect(await readStatusVersion(conn)).toBe(before + 1);
    });

    it('lists open incidents and those resolved in the last 90 days, of the organization only', async () => {
      const monitor = await addMonitor(orgA, 'Incident list');
      const other = await addMonitor(orgB, 'Incident other');
      const open = await addIncident(monitor, new Date(NOW.getTime() - 60 * 60 * 1000), null);
      const recent = await addIncident(monitor, new Date(NOW.getTime() - 10 * DAY), new Date(NOW.getTime() - 10 * DAY + 60_000));
      const old = await addIncident(monitor, new Date(NOW.getTime() - 91 * DAY), new Date(NOW.getTime() - 91 * DAY + 60_000));
      const foreign = await addIncident(other, new Date(NOW.getTime() - DAY), null);
      const store = mysqlAdminStore(pool, new FakeClock(NOW));

      const ids = (await store.incidents(orgA, NOW)).map((i) => i.id);
      expect(ids).toContain(open);
      expect(ids).toContain(recent);
      expect(ids).not.toContain(old);
      expect(ids).not.toContain(foreign);
      expect(ids.indexOf(open)).toBeLessThan(ids.indexOf(recent));
      expect(await store.incident(old, orgA, NOW)).toBeNull();
      expect(await store.incident(foreign, orgA, NOW)).toBeNull();
      expect(await store.incident(foreign, null, NOW)).toEqual({ id: foreign });
    });

    it('writes an update and bumps the status version in one transaction (D-033); it shows on the status page', async () => {
      const monitor = await addMonitor(orgA, 'Update target');
      const incident = await addIncident(monitor, new Date(NOW.getTime() - 60 * 60 * 1000), null);
      const author = (await mysqlAuthStore(pool).userByEmail('mara@auth-a.test'))!.id;
      const before = await readStatusVersion(conn);
      const store = mysqlAdminStore(pool, new FakeClock(NOW));

      await store.addIncidentUpdate({ incidentId: incident, userId: author, stage: 'identified', body: "Disk full'); DROP TABLE incidents; --" }, NOW);

      const [row] = await rows<{ stage: string; body: string; author_user_id: number; created_at: Date }>(
        conn, 'SELECT stage, body, author_user_id, created_at FROM incident_updates WHERE incident_id = ?', [incident],
      );
      expect(row).toMatchObject({ stage: 'identified', body: "Disk full'); DROP TABLE incidents; --", author_user_id: author });
      expect(row.created_at.toISOString()).toBe(NOW.toISOString());
      expect(await readStatusVersion(conn)).toBe(before + 1);
      const data = await loadStatusData(conn, NOW);
      const shown = data.groups.flatMap((g) => g.monitors).find((m) => m.name === 'Update target')!;
      expect(shown.incidents[0].updates?.[0]).toMatchObject({ stage: 'identified' });
    });

    it('a failed update leaves no row and no bump', async () => {
      const before = await readStatusVersion(conn);

      await expect(
        mysqlAdminStore(pool, new FakeClock(NOW)).addIncidentUpdate({ incidentId: 99999999, userId: null, stage: 'identified', body: 'x' }, NOW),
      ).rejects.toThrow(/foreign key/i);

      expect(await readStatusVersion(conn)).toBe(before);
    });
  });

  describe('API store (D-025, D-039)', () => {
    const NOW = new Date('2026-11-26T14:55:00.000Z');
    let pool: ReturnType<typeof createPool>;
    let orgA: number;
    let orgB: number;

    beforeAll(async () => {
      pool = createPool(url!);
      orgA = await insertId(conn, 'INSERT INTO organizations (slug, name, created_at, updated_at) VALUES (?, ?, ?, ?)', ['api-a', 'API A', T0, T0]);
      orgB = await insertId(conn, 'INSERT INTO organizations (slug, name, created_at, updated_at) VALUES (?, ?, ?, ?)', ['api-b', 'API B', T0, T0]);
    });

    afterAll(async () => {
      await pool?.end();
    });

    const sample: NewMonitor = {
      name: 'API created', url: 'https://api-created.example/', intervalMinutes: 10, expectedStatus: 204,
      timeoutMs: 15_000, keyword: 'ok', checkTls: true, latencyThresholdMs: 900,
    };

    it('creates a key from the organization slug and finds it by its public id; only the hash is stored', async () => {
      const key = newApiKey();
      const keyHash = await hashSecret(key.secret);
      const id = await createApiKey(pool, new FakeClock(NOW), { organizationSlug: 'api-a', name: 'Grafana', level: 'read', publicId: key.publicId, keyHash });

      expect(await mysqlApiStore(pool, new FakeClock(NOW)).keyByPublicId(key.publicId)).toEqual({
        id, organizationId: orgA, level: 'read', keyHash, revokedAt: null,
      });
      const [row] = await rows<{ created_at: Date }>(conn, 'SELECT * FROM api_keys WHERE id = ?', [id]);
      expect(JSON.stringify(row)).not.toContain(key.secret);
      expect(row.created_at.toISOString()).toBe(NOW.toISOString());
      await expect(
        createApiKey(pool, new FakeClock(NOW), { organizationSlug: 'no-such-org', name: 'X', level: 'read', publicId: newApiKey().publicId, keyHash }),
      ).rejects.toThrow(/No organization with the slug "no-such-org"/);
    });

    it.each(["' OR '1'='1", '%', ''])('finds no key for the public id %j (SQL injection)', async (publicId) => {
      expect(await mysqlApiStore(pool, new FakeClock(NOW)).keyByPublicId(publicId)).toBeNull();
    });

    it('creates a monitor with its fields and the clock\'s time, and bumps the status version', async () => {
      const store = mysqlApiStore(pool, new FakeClock(NOW));
      const before = await readStatusVersion(conn);

      const id = await store.createMonitor(orgA, sample, NOW);

      const [row] = await rows(conn, 'SELECT * FROM monitors WHERE id = ?', [id]);
      expect(row).toMatchObject({
        organization_id: orgA, name: 'API created', url: 'https://api-created.example/', interval_minutes: 10, expected_status: 204,
        timeout_ms: 15_000, keyword: 'ok', check_tls: 1, latency_threshold_ms: 900,
      });
      expect((row.created_at as Date).toISOString()).toBe(NOW.toISOString());
      expect((row.updated_at as Date).toISOString()).toBe(NOW.toISOString());
      expect(await readStatusVersion(conn)).toBe(before + 1);
    });

    it('lists only the organization\'s monitors with their status; the badge reads any monitor\'s status', async () => {
      const store = mysqlApiStore(pool, new FakeClock(NOW));
      const own = await store.createMonitor(orgA, { ...sample, name: 'API own' }, NOW);
      const other = await store.createMonitor(orgB, { ...sample, name: 'API other' }, NOW);
      await insertId(conn, "INSERT INTO incidents (monitor_id, started_at, cause) VALUES (?, ?, 'timeout')", [other, NOW]);

      const listed = await store.monitors(orgA, NOW);
      expect(listed.map((m) => m.id)).toContain(own);
      expect(listed.map((m) => m.id)).not.toContain(other);
      expect(listed.find((m) => m.id === own)).toEqual({ id: own, name: 'API own', url: 'https://api-created.example/', intervalMinutes: 10, status: 'nodata' });
      expect(await store.monitorStatus(own, NOW)).toBe('nodata');
      expect(await store.monitorStatus(other, NOW)).toBe('outage');
      expect(await store.monitorStatus(99999999, NOW)).toBeNull();
    });
  });

  describe('monthly reports (D-019, D-041)', () => {
    const NOW = new Date('2026-12-01T00:30:00.000Z');
    const MONTH = '2026-11';
    let pool: ReturnType<typeof createPool>;
    let orgId: number;
    let otherOrg: number;
    let monitor: number;

    beforeAll(async () => {
      pool = createPool(url!);
      orgId = await insertId(conn, 'INSERT INTO organizations (slug, name, created_at, updated_at) VALUES (?, ?, ?, ?)', ['rep-a', 'Școala Țară', T0, T0]);
      otherOrg = await insertId(conn, 'INSERT INTO organizations (slug, name, created_at, updated_at) VALUES (?, ?, ?, ?)', ['rep-b', 'Rep B', T0, T0]);
      const created = new Date('2026-10-01T00:00:00.000Z');
      monitor = await insertId(
        conn,
        `INSERT INTO monitors (organization_id, name, url, timeout_ms, check_tls, created_at, updated_at)
         VALUES (?, 'Bibliotecă', 'https://biblioteca.example/', 10000, 1, ?, ?)`,
        [orgId, created, created],
      );
      const check = (at: string, kind: string, latency: number | null) =>
        conn.query(
          `INSERT INTO checks (monitor_id, worker_id, checked_at, kind, outcome, latency_ms) VALUES (?, ?, ?, ?, 'up', ?)`,
          [monitor, workerId, new Date(at), kind, latency],
        );
      await check('2026-10-20T00:00:00.000Z', 'scheduled', 5000); // October: not in the mean
      await check('2026-11-05T00:00:00.000Z', 'scheduled', 100);
      await check('2026-11-06T00:00:00.000Z', 'scheduled', 300);
      await check('2026-11-07T00:00:00.000Z', 'confirmation', 9999); // a confirmation: not in the mean
      await check('2026-11-08T00:00:00.000Z', 'scheduled', null); // no response: not in the mean
      await check('2026-12-01T00:10:00.000Z', 'scheduled', 7000); // December: not in the mean
      const incident = (start: string, end: string | null) =>
        conn.query("INSERT INTO incidents (monitor_id, started_at, resolved_at, cause) VALUES (?, ?, ?, 'timeout')",
          [monitor, new Date(start), end ? new Date(end) : null]);
      await incident('2026-10-10T00:00:00.000Z', '2026-10-10T01:00:00.000Z'); // October only
      await incident('2026-10-31T22:00:00.000Z', '2026-11-01T03:00:00.000Z'); // crosses into November
      await conn.query(
        "INSERT INTO maintenance_windows (monitor_id, starts_at, ends_at, source, created_at) VALUES (?, ?, ?, 'scheduled', ?)",
        [monitor, new Date('2026-11-10T00:00:00.000Z'), new Date('2026-11-10T02:00:00.000Z'), T0],
      );
      const user = (org: number | null, email: string, role: string) =>
        conn.query('INSERT INTO users (organization_id, email, display_name, role, created_at) VALUES (?, ?, ?, ?, ?)', [org, email, email, role, T0]);
      await user(orgId, 'admin@rep-a.test', 'org_admin');
      await user(orgId, 'member@rep-a.test', 'member');
      await user(otherOrg, 'admin@rep-b.test', 'org_admin');
      await user(null, 'global@rep.test', 'global_admin');
    });

    afterAll(async () => {
      await pool?.end();
    });

    it('loads the month of one organization: its monitors, overlapping incidents, maintenance and mean latency of scheduled checks', async () => {
      const input = await mysqlReportStore(pool).loadMonth(orgId, 2026, 11, NOW);

      expect(input).toEqual({
        organization: 'Școala Țară',
        year: 2026,
        month: 11,
        monitors: [{
          name: 'Bibliotecă',
          url: 'https://biblioteca.example/',
          historyStart: new Date('2026-10-01T00:00:00.000Z'),
          incidents: [{ startedAt: new Date('2026-10-31T22:00:00.000Z'), resolvedAt: new Date('2026-11-01T03:00:00.000Z'), cause: 'timeout' }],
          maintenance: [{ startsAt: new Date('2026-11-10T00:00:00.000Z'), endsAt: new Date('2026-11-10T02:00:00.000Z') }],
          latency: { meanMs: 200, checks: 2 },
        }],
      });
      expect(await mysqlReportStore(pool).loadMonth(99999999, 2026, 11, NOW)).toBeNull();
    });

    it('loadMaintenance reads only the monitors it is given; none given, nothing read (D-041)', async () => {
      const other = await insertId(
        conn,
        `INSERT INTO monitors (organization_id, name, url, timeout_ms, check_tls, created_at, updated_at)
         VALUES (?, 'Other org monitor', 'https://other.example/', 10000, 1, ?, ?)`,
        [otherOrg, T0, T0],
      );
      await conn.query(
        "INSERT INTO maintenance_windows (monitor_id, starts_at, ends_at, source, created_at) VALUES (?, ?, ?, 'scheduled', ?)",
        [other, new Date('2026-11-11T00:00:00.000Z'), new Date('2026-11-11T01:00:00.000Z'), T0],
      );
      const { from, to } = { from: new Date('2026-11-01T00:00:00.000Z'), to: new Date('2026-12-01T00:00:00.000Z') };

      expect([...(await loadMaintenance(pool, from, to, [monitor])).keys()]).toEqual([monitor]);
      expect([...(await loadMaintenance(pool, from, to, [monitor, other])).keys()].sort()).toEqual([monitor, other].sort());
      expect((await loadMaintenance(pool, from, to, [])).size).toBe(0);
      expect((await mysqlReportStore(pool).loadMonth(orgId, 2026, 11, NOW))!.monitors.map((m) => m.maintenance.length)).toEqual([1]);
    });

    it('lists only the organization\'s org admins as recipients', async () => {
      expect(await mysqlReportStore(pool).orgAdminEmails(orgId)).toEqual(['admin@rep-a.test']);
    });

    it('stores one report per organization and month; a second save is refused', async () => {
      const store = mysqlReportStore(pool);
      expect(await store.reportState(orgId, MONTH)).toBeNull();

      expect(await store.saveReport(orgId, MONTH, Buffer.from('%PDF-first'), NOW)).toBe(true);
      expect(await store.saveReport(orgId, MONTH, Buffer.from('%PDF-second'), NOW)).toBe(false);

      expect((await store.storedReport(orgId, MONTH))?.toString()).toBe('%PDF-first');
      expect(await store.reportState(orgId, MONTH)).toEqual({ emailed: false });
      expect(await store.storedReport(otherOrg, MONTH)).toBeNull();
      await expect(
        conn.query('INSERT INTO monthly_reports (organization_id, month, pdf, generated_at) VALUES (?, ?, ?, ?)', [orgId, MONTH, Buffer.from('x'), NOW]),
      ).rejects.toThrow(/Duplicate entry/);
    });

    it('only one claim to email a report wins; a failed send releases it, a sent one is never claimed again', async () => {
      const store = mysqlReportStore(pool);
      await store.saveReport(otherOrg, MONTH, Buffer.from('%PDF-b'), NOW);

      const claims = await Promise.all([store.claimEmail(otherOrg, MONTH, NOW), store.claimEmail(otherOrg, MONTH, NOW)]);
      expect(claims.filter((c) => c !== null).map((c) => c!.toString())).toEqual(['%PDF-b']);

      await store.releaseEmail(otherOrg, MONTH, 'SMTP 421');
      const [failed] = await rows<{ last_error: string; sending_at: Date | null }>(
        conn, 'SELECT last_error, sending_at FROM monthly_reports WHERE organization_id = ? AND month = ?', [otherOrg, MONTH]);
      expect(failed).toMatchObject({ last_error: 'SMTP 421', sending_at: null });

      expect(await store.claimEmail(otherOrg, MONTH, NOW)).not.toBeNull();
      await store.markEmailed(otherOrg, MONTH, NOW, 1);
      expect(await store.reportState(otherOrg, MONTH)).toEqual({ emailed: true });
      expect(await store.claimEmail(otherOrg, MONTH, new Date(NOW.getTime() + 2 * 60 * 60 * 1000))).toBeNull();
    });

    it('lists the organizations with their stored reports and how each was sent; an org admin sees only theirs', async () => {
      const store = mysqlReportStore(pool);
      const all = await store.list(null);
      const b = all.find((o) => o.id === otherOrg)!;

      expect(b).toMatchObject({ name: 'Rep B', createdAt: T0 });
      expect(b.reports).toEqual([{ month: MONTH, emailedAt: NOW, emailedTo: 1, lastError: null }]);
      expect((await store.list(orgId)).map((o) => o.id)).toEqual([orgId]);
    });

    it('a claim left by a crashed send is taken again after an hour', async () => {
      const store = mysqlReportStore(pool);
      const month = '2026-10';
      await store.saveReport(orgId, month, Buffer.from('%PDF-oct'), NOW);

      expect(await store.claimEmail(orgId, month, NOW)).not.toBeNull();
      expect(await store.claimEmail(orgId, month, new Date(NOW.getTime() + 59 * 60 * 1000))).toBeNull();
      expect(await store.claimEmail(orgId, month, new Date(NOW.getTime() + 60 * 60 * 1000))).not.toBeNull();
    });
  });
});
