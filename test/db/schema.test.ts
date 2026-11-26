import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { connect, createPool } from '../../src/db/connection.js';
import { MIGRATIONS_DIR, migrate } from '../../src/db/migrate.js';
import { FakeClock } from '../../src/shared/clock.js';
import { loadStatusData, readStatusVersion } from '../../src/web/status/data.js';
import { monitorStatus } from '../../src/web/status/model.js';
import type { CheckResult } from '../../src/worker/check.js';
import { MySqlStore } from '../../src/worker/store.js';
import { recordCheck } from '../../src/worker/worker.js';

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
});
