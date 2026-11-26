import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { Queryable } from '../../db/maintenance.js';
import type { Clock } from '../../shared/clock.js';
import type { AlertIncident } from '../../shared/alerts.js';
import type { AlertStore, Contact } from './dispatcher.js';

// Alerts in MySQL (D-007, D-044). Values go in as `?`.

/** A claim older than this is taken to be from a send that crashed. */
const CLAIM_MS = 10 * 60 * 1000;

const INCIDENT_COLUMNS = `
  i.id, m.organization_id, o.name AS organization, m.name AS monitor, m.url, i.cause, i.http_status,
  i.started_at, i.resolved_at, i.acknowledged_at, o.escalation_timeout_minutes,
  (SELECT MAX(c.checked_at) FROM checks c WHERE c.monitor_id = i.monitor_id AND c.outcome = 'up') AS last_success_at,
  (SELECT MIN(a.sent_at) FROM incident_alerts a WHERE a.incident_id = i.id AND a.kind = 'opened') AS opened_sent_at`;
const INCIDENT_FROM = 'FROM incidents i JOIN monitors m ON m.id = i.monitor_id JOIN organizations o ON o.id = m.organization_id';

const toIncident = (r: RowDataPacket): AlertIncident => ({
  id: Number(r.id),
  organizationId: Number(r.organization_id),
  organization: r.organization as string,
  monitor: r.monitor as string,
  url: r.url as string,
  cause: r.cause as string,
  httpStatus: r.http_status === null ? null : Number(r.http_status),
  startedAt: r.started_at as Date,
  resolvedAt: r.resolved_at as Date | null,
  acknowledgedAt: r.acknowledged_at as Date | null,
  lastSuccessAt: r.last_success_at as Date | null,
  openedSentAt: r.opened_sent_at as Date | null,
  escalationMinutes: Number(r.escalation_timeout_minutes),
});

const toContact = (r: RowDataPacket): Contact => ({ id: Number(r.id), name: r.name as string, channel: r.channel, address: r.address as string });

const affected = (result: unknown) => (result as { affectedRows: number }).affectedRows;

export function mysqlAlertStore(pool: Pool): AlertStore {
  return {
    async openIncidents() {
      const [rows] = await pool.query<RowDataPacket[]>(`SELECT ${INCIDENT_COLUMNS} ${INCIDENT_FROM} WHERE i.resolved_at IS NULL ORDER BY i.id`);
      return rows.map(toIncident);
    },

    async resolvedIncidents() {
      // Someone got an opened or escalated alert and has no sent resolved alert yet.
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT ${INCIDENT_COLUMNS} ${INCIDENT_FROM}
         WHERE i.resolved_at IS NOT NULL AND EXISTS (
           SELECT 1 FROM incident_alerts a
           WHERE a.incident_id = i.id AND a.kind IN ('opened', 'escalated') AND a.sent_at IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM incident_alerts r
                             WHERE r.incident_id = a.incident_id AND r.kind = 'resolved' AND r.contact_id = a.contact_id AND r.sent_at IS NOT NULL))
         ORDER BY i.id`,
      );
      return rows.map(toIncident);
    },

    async contacts(orgId, priority) {
      const [rows] = await pool.query<RowDataPacket[]>(
        'SELECT id, name, channel, address FROM alert_contacts WHERE organization_id = ? AND priority = ? ORDER BY id', [orgId, priority]);
      return rows.map(toContact);
    },

    async alertedContacts(incidentId) {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT c.id, c.name, c.channel, c.address FROM alert_contacts c
         WHERE EXISTS (SELECT 1 FROM incident_alerts a
                       WHERE a.contact_id = c.id AND a.incident_id = ? AND a.kind IN ('opened', 'escalated') AND a.sent_at IS NOT NULL)
         ORDER BY c.id`,
        [incidentId],
      );
      return rows.map(toContact);
    },

    async claim(incidentId, kind, contactId, now) {
      await pool.query(
        'INSERT IGNORE INTO incident_alerts (incident_id, kind, contact_id, created_at) VALUES (?, ?, ?, ?)', [incidentId, kind, contactId, now]);
      // One UPDATE decides who sends: a second caller finds sending_at already set.
      const [result] = await pool.query(
        `UPDATE incident_alerts SET sending_at = ?
         WHERE incident_id = ? AND kind = ? AND contact_id = ? AND sent_at IS NULL
           AND (next_try_at IS NULL OR next_try_at <= ?) AND (sending_at IS NULL OR sending_at <= ?)`,
        [now, incidentId, kind, contactId, now, new Date(now.getTime() - CLAIM_MS)],
      );
      return affected(result) === 1;
    },

    async markSent(incidentId, kind, contactId, now) {
      await pool.query(
        `UPDATE incident_alerts SET sent_at = ?, sending_at = NULL, next_try_at = NULL, last_error = NULL
         WHERE incident_id = ? AND kind = ? AND contact_id = ?`,
        [now, incidentId, kind, contactId],
      );
    },

    async release(incidentId, kind, contactId, error, nextTryAt) {
      await pool.query(
        'UPDATE incident_alerts SET sending_at = NULL, last_error = ?, next_try_at = ? WHERE incident_id = ? AND kind = ? AND contact_id = ?',
        [error.slice(0, 1024), nextTryAt, incidentId, kind, contactId],
      );
    },

    async saveAckToken(incidentId, tokenHash, now) {
      await pool.query('INSERT INTO incident_ack_tokens (token_hash, incident_id, created_at) VALUES (?, ?, ?)', [tokenHash, incidentId, now]);
    },
  };
}

export interface NewContact {
  organizationSlug: string;
  name: string;
  channel: Contact['channel'];
  address: string;
  priority: 'primary' | 'secondary';
}

/** For `npm run contact:add`; returns the row's id. */
export async function createContact(db: Queryable, clock: Clock, c: NewContact): Promise<number> {
  const [orgs] = await db.query<RowDataPacket[]>('SELECT id FROM organizations WHERE slug = ?', [c.organizationSlug]);
  if (!orgs[0]) throw new Error(`No organization with the slug "${c.organizationSlug}".`);
  const [result] = await db.query<RowDataPacket[]>(
    'INSERT INTO alert_contacts (organization_id, name, channel, address, priority, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [Number(orgs[0].id), c.name, c.channel, c.address, c.priority, clock.now()],
  );
  return (result as unknown as { insertId: number }).insertId;
}
