import type { Clock } from '../../shared/clock.js';
import { alertMessage, dueKinds, type AlertIncident, type AlertKind } from '../../shared/alerts.js';
import { hashToken, newSessionToken } from '../auth/session.js';
import { mailErrorFields, mailErrorLog, mailErrorText, type Mailer } from '../mail.js';

// The alert dispatcher (D-007, D-013, D-044). It runs every 30 seconds in the web process and
// reads the incidents the workers open and resolve; the workers are not changed. One row per
// (incident, kind, contact) in incident_alerts is claimed before a send, so re-runs, overlapping
// runs and retries send each alert to each contact once (PATTERN-013).

export interface Contact {
  id: number;
  name: string;
  channel: 'email' | 'telegram';
  /** An email address, or a Telegram chat id. */
  address: string;
}

export interface TelegramClient {
  send(chatId: string, text: string): Promise<void>;
}

export interface AlertStore {
  /** Open incidents, with when their first opened alert went out. */
  openIncidents(): Promise<AlertIncident[]>;
  /** Resolved incidents that were alerted and still owe someone their resolved alert. */
  resolvedIncidents(): Promise<AlertIncident[]>;
  contacts(orgId: number, priority: 'primary' | 'secondary'): Promise<Contact[]>;
  /** Contacts that got an opened or escalated alert for the incident. */
  alertedContacts(incidentId: number): Promise<Contact[]>;
  /** True when this caller may send the alert now: not sent, not claimed in the last 10 minutes,
   *  and not waiting for `nextTryAt`. Creates the row the first time. */
  claim(incidentId: number, kind: AlertKind, contactId: number, now: Date): Promise<boolean>;
  markSent(incidentId: number, kind: AlertKind, contactId: number, now: Date): Promise<void>;
  /** Gives the claim back after a failed send, with what may be stored of the error. */
  release(incidentId: number, kind: AlertKind, contactId: number, error: string, nextTryAt: Date | null): Promise<void>;
  saveAckToken(incidentId: number, tokenHash: string, now: Date): Promise<void>;
}

export interface AlertDeps {
  clock: Clock;
  store: AlertStore;
  /** Null without SMTP settings: email contacts wait until there is one. */
  mailer: Mailer | null;
  /** Null without TELEGRAM_BOT_TOKEN: Telegram contacts wait until there is one. */
  telegram: TelegramClient | null;
  /** Where acknowledge links point (PUBLIC_URL); without it the alert says to use the admin panel. */
  publicUrl: string | null;
  log: (message: string, error?: unknown) => void;
}

export const ALERT_JOB_MS = 30_000;

const recipientsFor = async (store: AlertStore, i: AlertIncident, kind: AlertKind) =>
  kind === 'opened' ? store.contacts(i.organizationId, 'primary')
    : kind === 'escalated' ? store.contacts(i.organizationId, 'secondary')
      : store.alertedContacts(i.id);

async function sendOne(deps: AlertDeps, i: AlertIncident, kind: AlertKind, contact: Contact): Promise<void> {
  const { store, clock, mailer, telegram, publicUrl, log } = deps;
  const client = contact.channel === 'email' ? mailer : telegram;
  if (client === null) return;
  const now = clock.now();
  if (!(await store.claim(i.id, kind, contact.id, now))) return;
  try {
    let ackUrl: string | null = null;
    if (kind !== 'resolved' && publicUrl) {
      // A token per message, so a retry or an escalation always has a working link; only its hash is kept.
      const token = newSessionToken();
      await store.saveAckToken(i.id, hashToken(token), now);
      ackUrl = `${publicUrl.replace(/\/+$/, '')}/ack/${token}`;
    }
    const message = alertMessage(kind, i, now, ackUrl);
    if (contact.channel === 'email') await mailer!.send({ to: [contact.address], subject: message.subject, text: message.text, attachments: [] });
    else await telegram!.send(contact.address, `${message.subject}\n\n${message.text}`);
  } catch (error) {
    const retryAfterS = (error as { retryAfterS?: unknown })?.retryAfterS;
    const nextTryAt = typeof retryAfterS === 'number' ? new Date(now.getTime() + retryAfterS * 1000) : null;
    await store.release(i.id, kind, contact.id, mailErrorText(mailErrorFields(error)), nextTryAt);
    log(`${kind} alert for incident ${i.id} to contact ${contact.id} (${contact.channel}) failed; it is tried again`, mailErrorLog(error));
    return;
  }
  await store.markSent(i.id, kind, contact.id, now);
}

export async function dispatchAlerts(deps: AlertDeps): Promise<void> {
  const { store, clock, log } = deps;
  const incidents = [...(await store.openIncidents()), ...(await store.resolvedIncidents())];
  for (const i of incidents) {
    for (const kind of dueKinds(i, clock.now())) {
      try {
        for (const contact of await recipientsFor(store, i, kind)) await sendOne(deps, i, kind, contact);
      } catch (error) {
        log(`${kind} alerts for incident ${i.id} failed`, mailErrorLog(error));
      }
    }
  }
}

/** Runs now and every 30 seconds; a run still going when the next is due is not doubled. */
export function startAlerts(deps: AlertDeps): () => void {
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    dispatchAlerts(deps)
      .catch((error: unknown) => deps.log('alert dispatch failed', mailErrorLog(error)))
      .finally(() => {
        running = false;
      });
  };
  tick();
  const timer = setInterval(tick, ALERT_JOB_MS);
  return () => clearInterval(timer);
}
