/** A `workers` row as assignment needs it. */
export interface WorkerRow {
  id: number;
  lastSeenAt: Date | null;
}

/** A worker counts as active with a heartbeat this recent; heartbeats come every 10 s (D-027). */
export const ACTIVE_WITHIN_MS = 30_000;

/** Ids of the active workers, in id order. */
export function activeWorkers(workers: WorkerRow[], now: Date): number[] {
  return workers
    .filter((w) => w.lastSeenAt !== null && now.getTime() - w.lastSeenAt.getTime() <= ACTIVE_WITHIN_MS)
    .map((w) => w.id)
    .sort((a, b) => a - b);
}

/** The worker that runs a monitor's scheduled checks: active[monitor_id % count] (D-027). */
export function primaryWorker(monitorId: number, active: number[]): number | null {
  return active.length === 0 ? null : active[monitorId % active.length];
}
