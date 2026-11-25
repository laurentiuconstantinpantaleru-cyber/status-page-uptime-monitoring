import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { connect } from '../../src/db/connection.js';
import { MIGRATIONS_DIR, migrate } from '../../src/db/migrate.js';
import { FakeClock } from '../../src/shared/clock.js';

// Integration tests against a real MySQL 8. CI always sets TEST_DATABASE_URL.
// The database is wiped, so its name must end in `_test`.
const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.warn('TEST_DATABASE_URL is not set: skipping the MySQL schema tests.');
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
    expect(firstRun).toEqual(['0001_initial_schema.sql', '0002_seed_local_businesses.sql']);

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
});
