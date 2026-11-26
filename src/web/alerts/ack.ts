import type { Pool, RowDataPacket } from 'mysql2/promise';

// Acknowledging an incident from an alert's link (D-007, D-044). The link carries a random token;
// only its SHA-256 is stored, so the lookup is by hash. Values go in as `?`.

export interface AckIncident {
  id: number;
  organization: string;
  monitor: string;
  cause: string;
  startedAt: Date;
  resolvedAt: Date | null;
  acknowledgedAt: Date | null;
  /** The user who acknowledged it in the admin panel; null for a link or nobody. */
  acknowledgedBy: string | null;
}

export interface AckStore {
  incidentByToken(tokenHash: string): Promise<AckIncident | null>;
  /** Marks an open, unacknowledged incident acknowledged through a link; false when it was not. */
  acknowledge(incidentId: number, now: Date): Promise<boolean>;
}

export function mysqlAckStore(pool: Pool): AckStore {
  return {
    async incidentByToken(tokenHash) {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT i.id, o.name AS organization, m.name AS monitor, i.cause, i.started_at, i.resolved_at, i.acknowledged_at,
                u.display_name AS acknowledged_by
         FROM incident_ack_tokens t
         JOIN incidents i ON i.id = t.incident_id
         JOIN monitors m ON m.id = i.monitor_id
         JOIN organizations o ON o.id = m.organization_id
         LEFT JOIN users u ON u.id = i.acknowledged_by_user_id
         WHERE t.token_hash = ?`,
        [tokenHash],
      );
      const r = rows[0];
      return r
        ? {
          id: Number(r.id),
          organization: r.organization as string,
          monitor: r.monitor as string,
          cause: r.cause as string,
          startedAt: r.started_at as Date,
          resolvedAt: r.resolved_at as Date | null,
          acknowledgedAt: r.acknowledged_at as Date | null,
          acknowledgedBy: (r.acknowledged_by as string | null) ?? null,
        }
        : null;
    },

    async acknowledge(incidentId, now) {
      const [result] = await pool.query(
        'UPDATE incidents SET acknowledged_at = ? WHERE id = ? AND resolved_at IS NULL AND acknowledged_at IS NULL',
        [now, incidentId],
      );
      return (result as { affectedRows: number }).affectedRows === 1;
    },
  };
}
