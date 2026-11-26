/** A worker's scheduled check in the window, with the outcome of another worker's confirmation, if any. */
export interface WindowCheck {
  monitorId: number;
  outcome: 'up' | 'down';
  confirmation: 'up' | 'down' | null;
}

export interface FaultConfig {
  /** Fewer monitors checked in the window: no judgment, D-005 alone applies. */
  minMonitors: number;
  /** Share, in %, of failed checks and of failures confirmed up that makes a worker degraded. */
  thresholdPct: number;
  windowMs: number;
}

export const DEFAULT_FAULT_CONFIG: FaultConfig = { minMonitors: 3, thresholdPct: 70, windowMs: 10 * 60_000 };

/** What a judgment saw; stored with a worker_fault episode. */
export interface FaultCounts {
  monitorsChecked: number;
  checksTotal: number;
  checksFailed: number;
  confirmationsTotal: number;
  confirmationsUp: number;
}

/**
 * Degraded when at least `minMonitors` monitors were checked, at least `thresholdPct` % of the checks
 * failed, and at least `thresholdPct` % of the failures already confirmed were confirmed up by the
 * other worker (D-015). Null: too few monitors to judge.
 */
export function judgeWorker(
  checks: WindowCheck[],
  { minMonitors, thresholdPct }: FaultConfig,
): { degraded: boolean; counts: FaultCounts } | null {
  const monitorsChecked = new Set(checks.map((c) => c.monitorId)).size;
  if (monitorsChecked < minMonitors) return null;
  const failed = checks.filter((c) => c.outcome === 'down');
  const confirmed = failed.filter((c) => c.confirmation !== null);
  const counts: FaultCounts = {
    monitorsChecked,
    checksTotal: checks.length,
    checksFailed: failed.length,
    confirmationsTotal: confirmed.length,
    confirmationsUp: confirmed.filter((c) => c.confirmation === 'up').length,
  };
  // Whole numbers only, so 7 of 10 is exactly 70 %.
  const atLeast = (part: number, whole: number) => whole > 0 && part * 100 >= thresholdPct * whole;
  const degraded =
    atLeast(counts.checksFailed, counts.checksTotal) && atLeast(counts.confirmationsUp, counts.confirmationsTotal);
  return { degraded, counts };
}

/** Reads MIN_WORKER_MONITORS, WORKER_FAULT_THRESHOLD (%) and WORKER_FAULT_WINDOW_MINUTES; unset means the default. */
export function faultConfigFromEnv(env: Record<string, string | undefined>): FaultConfig {
  const read = (name: string, fallback: number, max = Infinity) => {
    const raw = env[name];
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (raw.trim() === '' || !Number.isInteger(value) || value < 1 || value > max) {
      const range = max === Infinity ? 'at least 1' : `from 1 to ${max}`;
      throw new Error(`${name} must be a whole number ${range}, got "${raw}"`);
    }
    return value;
  };
  return {
    minMonitors: read('MIN_WORKER_MONITORS', DEFAULT_FAULT_CONFIG.minMonitors),
    thresholdPct: read('WORKER_FAULT_THRESHOLD', DEFAULT_FAULT_CONFIG.thresholdPct, 100),
    windowMs: read('WORKER_FAULT_WINDOW_MINUTES', DEFAULT_FAULT_CONFIG.windowMs / 60_000) * 60_000,
  };
}
