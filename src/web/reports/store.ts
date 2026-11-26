import type { Pool, RowDataPacket } from 'mysql2/promise';
import { loadMaintenance } from '../../db/maintenance.js';
import { utcMonth } from '../../shared/uptime.js';
import { dataSince } from '../status/model.js';
import type { ReportStore } from './job.js';

// The monthly reports in MySQL (D-019, D-041). Values go in as `?`.

/** A claim to email a report older than this is taken to be from a send that crashed. */
const CLAIM_MS = 60 * 60 * 1000;

const affected = (result: unknown) => (result as { affectedRows: number }).affectedRows;

export function mysqlReportStore(pool: Pool): ReportStore {
  return {
    async organizations() {
      const [rows] = await pool.query<RowDataPacket[]>('SELECT id, name FROM organizations ORDER BY id');
      return rows.map((r) => ({ id: Number(r.id), name: r.name as string }));
    },

    async loadMonth(orgId, year, month, now) {
      const [orgs] = await pool.query<RowDataPacket[]>('SELECT name FROM organizations WHERE id = ?', [orgId]);
      if (!orgs[0]) return null;
      const { from, to } = utcMonth(year, month);
      const [monitors] = await pool.query<RowDataPacket[]>(
        'SELECT id, name, url, created_at FROM monitors WHERE organization_id = ? ORDER BY id',
        [orgId],
      );
      const ids = monitors.map((m) => Number(m.id));
      const none = [[] as RowDataPacket[]] as const;
      const [firsts] = ids.length
        ? await pool.query<RowDataPacket[]>('SELECT monitor_id, MIN(checked_at) AS first_at FROM checks WHERE monitor_id IN (?) GROUP BY monitor_id', [ids])
        : none;
      // Scheduled checks only: a confirmation repeats a failure from the other worker (D-027).
      const [latency] = ids.length
        ? await pool.query<RowDataPacket[]>(
          `SELECT monitor_id, AVG(latency_ms) AS mean_ms, COUNT(*) AS n FROM checks
           WHERE monitor_id IN (?) AND kind = 'scheduled' AND latency_ms IS NOT NULL AND checked_at >= ? AND checked_at < ?
           GROUP BY monitor_id`,
          [ids, from, to],
        )
        : none;
      const [incidents] = ids.length
        ? await pool.query<RowDataPacket[]>(
          `SELECT monitor_id, started_at, resolved_at, cause FROM incidents
           WHERE monitor_id IN (?) AND started_at < ? AND (resolved_at IS NULL OR resolved_at > ?)
           ORDER BY started_at, id`,
          [ids, to, from],
        )
        : none;
      const windows = await loadMaintenance(pool, from, to, ids);

      const firstOf = new Map(firsts.map((r) => [Number(r.monitor_id), r.first_at as Date]));
      const latencyOf = new Map(latency.map((r) => [Number(r.monitor_id), { meanMs: Number(r.mean_ms), checks: Number(r.n) }]));
      return {
        organization: orgs[0].name as string,
        year,
        month,
        monitors: monitors.map((m) => {
          const id = Number(m.id);
          return {
            name: m.name as string,
            url: m.url as string,
            historyStart: dataSince({ firstCheckAt: firstOf.get(id) ?? null, createdAt: m.created_at as Date }, now),
            incidents: incidents
              .filter((i) => Number(i.monitor_id) === id)
              .map((i) => ({ startedAt: i.started_at as Date, resolvedAt: i.resolved_at as Date | null, cause: i.cause as string })),
            maintenance: windows.get(id) ?? [],
            latency: latencyOf.get(id) ?? null,
          };
        }),
      };
    },

    async reportState(orgId, month) {
      const [rows] = await pool.query<RowDataPacket[]>(
        'SELECT emailed_at FROM monthly_reports WHERE organization_id = ? AND month = ?', [orgId, month]);
      return rows[0] ? { emailed: rows[0].emailed_at !== null } : null;
    },

    async saveReport(orgId, month, pdf, now) {
      try {
        await pool.query('INSERT INTO monthly_reports (organization_id, month, pdf, generated_at) VALUES (?, ?, ?, ?)', [orgId, month, pdf, now]);
        return true;
      } catch (error) {
        if ((error as { code?: string }).code === 'ER_DUP_ENTRY') return false;
        throw error;
      }
    },

    async storedReport(orgId, month) {
      const [rows] = await pool.query<RowDataPacket[]>(
        'SELECT pdf FROM monthly_reports WHERE organization_id = ? AND month = ?', [orgId, month]);
      return rows[0] ? (rows[0].pdf as Buffer) : null;
    },

    async claimEmail(orgId, month, now) {
      // One UPDATE decides who sends: a second caller finds sending_at already set.
      const [result] = await pool.query(
        `UPDATE monthly_reports SET sending_at = ?
         WHERE organization_id = ? AND month = ? AND emailed_at IS NULL AND (sending_at IS NULL OR sending_at <= ?)`,
        [now, orgId, month, new Date(now.getTime() - CLAIM_MS)],
      );
      if (affected(result) !== 1) return null;
      const [rows] = await pool.query<RowDataPacket[]>(
        'SELECT pdf FROM monthly_reports WHERE organization_id = ? AND month = ?', [orgId, month]);
      return rows[0].pdf as Buffer;
    },

    async markEmailed(orgId, month, now, emailedTo) {
      await pool.query(
        'UPDATE monthly_reports SET emailed_at = ?, emailed_to = ?, sending_at = NULL, last_error = NULL WHERE organization_id = ? AND month = ?',
        [now, emailedTo, orgId, month],
      );
    },

    async releaseEmail(orgId, month, error) {
      await pool.query(
        'UPDATE monthly_reports SET sending_at = NULL, last_error = ? WHERE organization_id = ? AND month = ?',
        [error, orgId, month],
      );
    },

    async list(orgId) {
      const only = orgId === null ? '' : ' WHERE id = ?';
      const [orgs] = await pool.query<RowDataPacket[]>(`SELECT id, name, created_at FROM organizations${only} ORDER BY id`, orgId === null ? [] : [orgId]);
      const ids = orgs.map((o) => Number(o.id));
      const [reports] = ids.length
        ? await pool.query<RowDataPacket[]>(
          'SELECT organization_id, month, emailed_at, emailed_to, last_error FROM monthly_reports WHERE organization_id IN (?) ORDER BY month DESC',
          [ids],
        )
        : [[] as RowDataPacket[]];
      return orgs.map((o) => ({
        id: Number(o.id),
        name: o.name as string,
        createdAt: o.created_at as Date,
        reports: reports.filter((r) => Number(r.organization_id) === Number(o.id)).map((r) => ({
          month: r.month as string,
          emailedAt: r.emailed_at as Date | null,
          emailedTo: r.emailed_to === null ? null : Number(r.emailed_to),
          lastError: r.last_error as string | null,
        })),
      }));
    },

    async orgAdminEmails(orgId) {
      const [rows] = await pool.query<RowDataPacket[]>(
        "SELECT email FROM users WHERE organization_id = ? AND role = 'org_admin' ORDER BY id", [orgId]);
      return rows.map((r) => r.email as string);
    },
  };
}
