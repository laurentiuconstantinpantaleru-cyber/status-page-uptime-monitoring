import type { ErrorCause } from '../worker/check.js';

/** Consecutive confirmed failures that open an incident (D-006). */
export const OPEN_AFTER = 2;
/** Consecutive successes that resolve it (D-006). */
export const CLOSE_AFTER = 2;

/** A stored `checks` row as the incident engine reads it. */
export interface RecordedCheck {
  id: number;
  checkedAt: Date;
  outcome: 'up' | 'down';
  httpStatus: number | null;
  latencyMs: number | null;
  errorCause: ErrorCause | null;
}

/** A scheduled check and the other worker's confirmation of it, if any. */
export interface ScheduledCheck {
  check: RecordedCheck;
  confirmation: RecordedCheck | null;
}

export interface IncidentInput {
  /** The monitor's latest scheduled checks, newest first. */
  recent: ScheduledCheck[];
  openIncident: boolean;
  inMaintenance: boolean;
}

export type IncidentAction =
  | { kind: 'open'; startedAt: Date; cause: ErrorCause; httpStatus: number | null }
  | { kind: 'resolve'; resolvedAt: Date }
  | null;

/**
 * Opens after OPEN_AFTER consecutive scheduled failures, each confirmed down by the other worker,
 * outside maintenance; resolves after CLOSE_AFTER consecutive successes, maintenance or not (D-006, D-028).
 * The incident starts at the first failure and resolves at the first success.
 */
export function decideIncident({ recent, openIncident, inMaintenance }: IncidentInput): IncidentAction {
  if (!openIncident) {
    const last = recent.slice(0, OPEN_AFTER);
    const confirmedDown = (s: ScheduledCheck) => s.check.outcome === 'down' && s.confirmation?.outcome === 'down';
    if (inMaintenance || last.length < OPEN_AFTER || !last.every(confirmedDown)) return null;
    const latest = last[0].confirmation!;
    return {
      kind: 'open',
      startedAt: last[OPEN_AFTER - 1].check.checkedAt,
      cause: latest.errorCause ?? 'unknown',
      httpStatus: latest.httpStatus,
    };
  }
  const last = recent.slice(0, CLOSE_AFTER);
  if (last.length < CLOSE_AFTER || !last.every((s) => s.check.outcome === 'up')) return null;
  return { kind: 'resolve', resolvedAt: last[CLOSE_AFTER - 1].check.checkedAt };
}

/**
 * Whether a new check changes what the status page shows without an incident change: the first
 * check of a monitor, or its latency crossing the threshold either way (D-020, D-023).
 */
export function publicStateChanged(
  previous: RecordedCheck | null,
  latest: RecordedCheck,
  latencyThresholdMs: number | null,
): boolean {
  if (previous === null) return true;
  const slow = (c: RecordedCheck) =>
    latencyThresholdMs !== null && c.latencyMs !== null && c.latencyMs > latencyThresholdMs;
  return slow(previous) !== slow(latest);
}
