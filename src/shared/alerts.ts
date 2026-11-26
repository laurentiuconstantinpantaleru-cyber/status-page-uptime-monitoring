import { CAUSE_LABEL } from './report.js';

// Which alerts an incident is due, and what they say (D-007, D-013, D-044). Pure, so the rules
// are tested with plain dates (D-004). The dispatcher sends; this only decides and words.

export type AlertKind = 'opened' | 'escalated' | 'resolved';

export interface AlertIncident {
  id: number;
  organizationId: number;
  organization: string;
  monitor: string;
  url: string;
  /** The `ErrorCause` it opened with. */
  cause: string;
  httpStatus: number | null;
  startedAt: Date;
  resolvedAt: Date | null;
  acknowledgedAt: Date | null;
  /** The monitor's last `up` check before now; null when it never had one. */
  lastSuccessAt: Date | null;
  /** When the first opened alert reached a primary contact; null before. */
  openedSentAt: Date | null;
  /** The organization's escalation timeout (D-007: default 15, up to 60). */
  escalationMinutes: number;
}

const MINUTE = 60_000;

/**
 * An open incident is due its opened alert, and once its opened alert went out and nobody
 * acknowledged it for the organization's timeout, its escalation. A resolved one is due its
 * resolved alert (the store lists only those that were alerted).
 */
export function dueKinds(i: AlertIncident, now: Date): AlertKind[] {
  if (i.resolvedAt !== null) return ['resolved'];
  const kinds: AlertKind[] = ['opened'];
  if (i.acknowledgedAt === null && i.openedSentAt !== null
    && now.getTime() - i.openedSentAt.getTime() >= i.escalationMinutes * MINUTE) kinds.push('escalated');
  return kinds;
}

const utc = (d: Date) => `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

/** "28 min", "1 h 5 min": the same words as the reports and the status page. */
function span(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / MINUTE));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

const causeOf = (i: AlertIncident) => CAUSE_LABEL[i.cause] ?? CAUSE_LABEL.unknown;

/** Plain text, the same for email and Telegram (no markup to escape). */
export function alertMessage(kind: AlertKind, i: AlertIncident, now: Date, ackUrl: string | null): { subject: string; text: string } {
  const cause = causeOf(i);
  if (kind === 'resolved') {
    const end = i.resolvedAt ?? now;
    return {
      subject: `[RESOLVED] ${i.monitor} is up again`,
      text: [
        `${i.monitor} is up again after ${span(end.getTime() - i.startedAt.getTime())}.`,
        `URL: ${i.url}`,
        `Down from ${utc(i.startedAt)} to ${utc(end)} (${cause}).`,
        `Organization: ${i.organization}`,
      ].join('\n'),
    };
  }
  const first = kind === 'opened'
    ? `${i.monitor} is down: ${cause}.`
    : `${i.monitor} has been down for ${span(now.getTime() - i.startedAt.getTime())} and nobody has acknowledged it: ${cause}.`;
  const lastSuccess = i.lastSuccessAt
    ? `${span(now.getTime() - i.lastSuccessAt.getTime())} ago (${utc(i.lastSuccessAt)})`
    : 'none yet';
  return {
    subject: `[${kind === 'opened' ? 'DOWN' : 'ESCALATED'}] ${i.monitor}: ${cause}`,
    text: [
      first,
      `URL: ${i.url}`,
      `Error: ${i.httpStatus === null ? 'no HTTP response' : `HTTP ${i.httpStatus}`}`,
      `Down since: ${utc(i.startedAt)}`,
      `Last successful check: ${lastSuccess}`,
      `Acknowledge: ${ackUrl ?? 'in the admin panel, Incidents'}`,
      `Organization: ${i.organization}`,
    ].join('\n'),
  };
}
