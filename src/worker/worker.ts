import type { Clock } from '../shared/clock.js';
import { CLOSE_AFTER, OPEN_AFTER, decideIncident, publicStateChanged, type ScheduledCheck } from '../shared/incidents.js';
import { DEFAULT_FAULT_CONFIG, judgeWorker, type FaultConfig } from '../shared/worker-fault.js';
import { activeWorkers, primaryWorker } from './assignment.js';
import { runCheck, type HttpClient } from './check.js';
import { Scheduler } from './scheduler.js';
import type { MonitorRow, MonitorTx, NewCheck, WorkerStore } from './store.js';

/** How often a worker writes its heartbeat, re-reads monitors and polls for checks to confirm (D-027). */
export const HEARTBEAT_MS = 10_000;
export const REFRESH_MS = 60_000;
export const CONFIRM_POLL_MS = 5_000;
/** Down checks older than this are left unconfirmed, which breaks a run of failures. */
export const CONFIRM_WITHIN_MS = 2 * 60_000;

/** Whether a worker behind the run that would open an incident is degraded at `at` (D-015). */
async function runHasDegradedWorker(tx: MonitorTx, run: ScheduledCheck[], at: Date, fault: FaultConfig): Promise<boolean> {
  const workers = new Set(run.flatMap((s) => [s.check.workerId, ...(s.confirmation ? [s.confirmation.workerId] : [])]));
  const since = new Date(at.getTime() - fault.windowMs);
  for (const workerId of workers) {
    if (judgeWorker(await tx.workerWindow(workerId, since), fault)?.degraded) return true;
  }
  return false;
}

/**
 * Stores a check and, under the monitor's lock, opens or resolves its incident and bumps the status
 * version when what the status page shows changes. A second confirmation of the same check is dropped.
 * No incident opens while a worker behind its run of failures is degraded (D-015).
 */
export async function recordCheck(
  store: WorkerStore,
  check: NewCheck,
  monitor: Pick<MonitorRow, 'latencyThresholdMs'>,
  fault: FaultConfig = DEFAULT_FAULT_CONFIG,
): Promise<'recorded' | 'duplicate'> {
  return store.inMonitorTransaction(check.monitorId, async (tx) => {
    if (check.confirmsCheckId !== null && (await tx.hasConfirmation(check.confirmsCheckId))) return 'duplicate';
    const previous = await tx.lastCheck(check.monitorId);
    const id = await tx.insertCheck(check);
    const { outcome, httpStatus, latencyMs, errorCause } = check.result;
    let changed = publicStateChanged(
      previous,
      { id, workerId: check.workerId, checkedAt: check.checkedAt, outcome, httpStatus, latencyMs, errorCause },
      monitor.latencyThresholdMs,
    );

    const recent = await tx.recentScheduled(check.monitorId, Math.max(OPEN_AFTER, CLOSE_AFTER));
    let action = decideIncident({
      recent,
      openIncident: await tx.hasOpenIncident(check.monitorId),
      inMaintenance: await tx.inMaintenance(check.monitorId, check.checkedAt),
    });
    if (action?.kind === 'open' && (await runHasDegradedWorker(tx, recent.slice(0, OPEN_AFTER), check.checkedAt, fault))) {
      action = null;
    }
    if (action?.kind === 'open') {
      await tx.openIncident(check.monitorId, action.startedAt, action.cause, action.httpStatus);
      changed = true;
    } else if (action?.kind === 'resolve') {
      await tx.resolveIncident(check.monitorId, action.resolvedAt);
      changed = true;
    }
    if (changed) await tx.bumpStatusVersion();
    return 'recorded';
  });
}

export interface WorkerDeps {
  clock: Clock;
  client: HttpClient;
  store: WorkerStore;
  workerId: number;
  /** Degradation thresholds (D-015); the defaults when omitted. */
  fault?: FaultConfig;
}

/** One check worker: scheduled checks of the monitors it is primary for, confirmations for the others (D-005, D-027). */
export class CheckWorker {
  readonly scheduler: Scheduler;
  private monitors = new Map<number, MonitorRow>();
  private readonly confirming = new Set<number>();

  constructor(private readonly deps: WorkerDeps) {
    this.scheduler = new Scheduler(deps.clock);
  }

  /** Writes the heartbeat, then judges this worker and opens or ends its worker_fault episode (D-015). */
  async heartbeat(): Promise<void> {
    const { store, clock, workerId, fault = DEFAULT_FAULT_CONFIG } = this.deps;
    const now = clock.now();
    await store.heartbeat(workerId, now);
    const judgment = judgeWorker(await store.workerWindow(workerId, new Date(now.getTime() - fault.windowMs)), fault);
    const open = await store.hasOpenWorkerFault(workerId);
    if (judgment?.degraded && !open) await store.openWorkerFault(workerId, now, judgment.counts);
    else if (!judgment?.degraded && open) await store.closeWorkerFault(workerId, now);
  }

  /** Re-reads monitors and active workers, and keeps the monitors this worker is primary for. */
  async refresh(): Promise<void> {
    const { store, clock, workerId } = this.deps;
    const [workers, monitors] = await Promise.all([store.listWorkers(), store.listMonitors()]);
    const active = activeWorkers(workers, clock.now());
    this.monitors = new Map(monitors.map((m) => [m.id, m]));
    this.scheduler.setMonitors(
      monitors
        .filter((m) => primaryWorker(m.id, active) === workerId)
        .map((m) => ({ id: m.id, intervalMinutes: m.intervalMinutes })),
    );
  }

  /** Starts the checks that are due and resolves when they are stored. */
  async runDue(): Promise<void> {
    await Promise.all(this.scheduler.due().map((id) => this.runScheduled(id)));
  }

  private async runScheduled(monitorId: number): Promise<void> {
    try {
      const monitor = this.monitors.get(monitorId);
      if (!monitor) return;
      await this.check(monitor, 'scheduled', null);
    } finally {
      this.scheduler.finished(monitorId);
    }
  }

  /** Confirms other workers' recent down checks; a check already being confirmed here is not started twice. */
  async confirmPending(): Promise<void> {
    const { store, clock, workerId } = this.deps;
    const since = new Date(clock.now().getTime() - CONFIRM_WITHIN_MS);
    const pending = await store.pendingConfirmations(workerId, since);
    await Promise.all(
      pending
        .filter((p) => !this.confirming.has(p.checkId) && this.monitors.has(p.monitorId))
        .map(async (p) => {
          this.confirming.add(p.checkId);
          try {
            await this.check(this.monitors.get(p.monitorId)!, 'confirmation', p.checkId);
          } finally {
            this.confirming.delete(p.checkId);
          }
        }),
    );
  }

  private async check(monitor: MonitorRow, kind: NewCheck['kind'], confirmsCheckId: number | null): Promise<void> {
    const { clock, client, store, workerId, fault } = this.deps;
    const checkedAt = clock.now();
    const result = await runCheck(monitor, { client, clock });
    await recordCheck(store, { monitorId: monitor.id, workerId, checkedAt, kind, confirmsCheckId, result }, monitor, fault);
  }
}
