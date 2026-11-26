import type { RecordedCheck, ScheduledCheck } from '../../src/shared/incidents.js';
import type { FaultCounts, WindowCheck } from '../../src/shared/worker-fault.js';
import type { MonitorRow, MonitorTx, NewCheck, PendingConfirmation, WorkerStore } from '../../src/worker/store.js';
import type { WorkerRow } from '../../src/worker/assignment.js';

export interface StoredCheck extends NewCheck {
  id: number;
}

export interface StoredWorkerFault {
  workerId: number;
  startedAt: Date;
  endedAt: Date | null;
  counts: FaultCounts;
}

export interface StoredIncident {
  monitorId: number;
  startedAt: Date;
  resolvedAt: Date | null;
  cause: string;
  httpStatus: number | null;
}

const recorded = (c: StoredCheck): RecordedCheck => ({
  id: c.id,
  workerId: c.workerId,
  checkedAt: c.checkedAt,
  outcome: c.result.outcome,
  httpStatus: c.result.httpStatus,
  latencyMs: c.result.latencyMs,
  errorCause: c.result.errorCause,
});

const newestFirst = (a: StoredCheck, b: StoredCheck) => b.checkedAt.getTime() - a.checkedAt.getTime() || b.id - a.id;

/** WorkerStore over plain arrays, shared by the simulated workers of a test. */
export class MemoryStore implements WorkerStore {
  workers: (WorkerRow & { name: string })[] = [];
  monitors: MonitorRow[] = [];
  checks: StoredCheck[] = [];
  incidents: StoredIncident[] = [];
  maintenance: { monitorId: number; startsAt: Date; endsAt: Date }[] = [];
  workerFaults: StoredWorkerFault[] = [];
  statusVersion = 0;

  /** The worker's scheduled checks since `since`, each with its confirmation's outcome. */
  private windowOf(workerId: number, since: Date): WindowCheck[] {
    return this.checks
      .filter((c) => c.workerId === workerId && c.kind === 'scheduled' && c.checkedAt >= since)
      .map((c) => ({
        monitorId: c.monitorId,
        outcome: c.result.outcome,
        confirmation: this.checks.find((x) => x.confirmsCheckId === c.id)?.result.outcome ?? null,
      }));
  }

  async workerWindow(workerId: number, since: Date): Promise<WindowCheck[]> {
    return this.windowOf(workerId, since);
  }

  async hasOpenWorkerFault(workerId: number): Promise<boolean> {
    return this.workerFaults.some((f) => f.workerId === workerId && f.endedAt === null);
  }

  async openWorkerFault(workerId: number, startedAt: Date, counts: FaultCounts): Promise<void> {
    this.workerFaults.push({ workerId, startedAt, endedAt: null, counts });
  }

  async closeWorkerFault(workerId: number, endedAt: Date): Promise<void> {
    const found = this.workerFaults.find((f) => f.workerId === workerId && f.endedAt === null);
    if (found) found.endedAt = endedAt;
  }

  async registerWorker(name: string, now: Date): Promise<number> {
    const found = this.workers.find((w) => w.name === name);
    if (found) {
      found.lastSeenAt = now;
      return found.id;
    }
    const id = this.workers.length + 1;
    this.workers.push({ id, name, lastSeenAt: now });
    return id;
  }

  async heartbeat(workerId: number, now: Date): Promise<void> {
    const found = this.workers.find((w) => w.id === workerId);
    if (found) found.lastSeenAt = now;
  }

  async listWorkers(): Promise<WorkerRow[]> {
    return this.workers.map(({ id, lastSeenAt }) => ({ id, lastSeenAt }));
  }

  async listMonitors(): Promise<MonitorRow[]> {
    return this.monitors;
  }

  async pendingConfirmations(workerId: number, since: Date): Promise<PendingConfirmation[]> {
    return this.checks
      .filter(
        (c) =>
          c.kind === 'scheduled' &&
          c.result.outcome === 'down' &&
          c.workerId !== workerId &&
          c.checkedAt >= since &&
          !this.checks.some((x) => x.confirmsCheckId === c.id),
      )
      .map((c) => ({ checkId: c.id, monitorId: c.monitorId }));
  }

  async inMonitorTransaction<T>(_monitorId: number, fn: (tx: MonitorTx) => Promise<T>): Promise<T> {
    const tx: MonitorTx = {
      lastCheck: async (monitorId) => {
        const last = this.checks.filter((c) => c.monitorId === monitorId).sort(newestFirst)[0];
        return last ? recorded(last) : null;
      },
      workerWindow: async (workerId, since) => this.windowOf(workerId, since),
      hasConfirmation: async (checkId) => this.checks.some((c) => c.confirmsCheckId === checkId),
      insertCheck: async (check) => {
        const id = this.checks.length + 1;
        this.checks.push({ ...check, id });
        return id;
      },
      recentScheduled: async (monitorId, limit) =>
        this.checks
          .filter((c) => c.monitorId === monitorId && c.kind === 'scheduled')
          .sort(newestFirst)
          .slice(0, limit)
          .map((c): ScheduledCheck => {
            const confirmation = this.checks.find((x) => x.confirmsCheckId === c.id);
            return { check: recorded(c), confirmation: confirmation ? recorded(confirmation) : null };
          }),
      hasOpenIncident: async (monitorId) => this.incidents.some((i) => i.monitorId === monitorId && i.resolvedAt === null),
      inMaintenance: async (monitorId, at) =>
        this.maintenance.some((w) => w.monitorId === monitorId && w.startsAt <= at && w.endsAt > at),
      openIncident: async (monitorId, startedAt, cause, httpStatus) => {
        this.incidents.push({ monitorId, startedAt, resolvedAt: null, cause, httpStatus });
      },
      resolveIncident: async (monitorId, resolvedAt) => {
        const found = this.incidents.find((i) => i.monitorId === monitorId && i.resolvedAt === null);
        if (found) found.resolvedAt = resolvedAt;
      },
      bumpStatusVersion: async () => {
        this.statusVersion += 1;
      },
    };
    return fn(tx);
  }
}
