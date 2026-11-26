import type { Clock } from '../shared/clock.js';

const MINUTE_MS = 60_000;

export interface ScheduledMonitor {
  id: number;
  intervalMinutes: number;
}

/** Where a monitor sits inside its interval, so monitors with the same interval do not all start together (D-027). */
export function slotOffsetMs(monitorId: number, intervalMinutes: number): number {
  return (monitorId * 1000) % (intervalMinutes * MINUTE_MS);
}

interface Entry {
  intervalMinutes: number;
  nextAt: number;
  running: boolean;
}

/**
 * Plans checks on a fixed grid per monitor: slot k is k * interval + offset (D-027). Starts never
 * drift with check duration, missed slots are not caught up, and a slot whose previous check of
 * the same monitor still runs is skipped.
 */
export class Scheduler {
  private readonly entries = new Map<number, Entry>();

  constructor(private readonly clock: Clock) {}

  /** The first slot at or after `t` (`strictlyAfter`: after `t`). */
  private slot(id: number, intervalMinutes: number, t: number, strictlyAfter: boolean): number {
    const interval = intervalMinutes * MINUTE_MS;
    const offset = slotOffsetMs(id, intervalMinutes);
    const k = strictlyAfter ? Math.floor((t - offset) / interval) + 1 : Math.ceil((t - offset) / interval);
    return k * interval + offset;
  }

  /** Replaces the monitors this worker runs; a new or re-timed monitor starts at its next slot. */
  setMonitors(monitors: ScheduledMonitor[]): void {
    const now = this.clock.now().getTime();
    const ids = new Set(monitors.map((m) => m.id));
    for (const id of this.entries.keys()) {
      if (!ids.has(id)) this.entries.delete(id);
    }
    for (const { id, intervalMinutes } of monitors) {
      const entry = this.entries.get(id);
      if (entry && entry.intervalMinutes === intervalMinutes) continue;
      this.entries.set(id, {
        intervalMinutes,
        nextAt: this.slot(id, intervalMinutes, now, false),
        running: entry?.running ?? false,
      });
    }
  }

  /** Monitors to start now. Each is marked running until `finished`; every due slot moves past now. */
  due(): number[] {
    const now = this.clock.now().getTime();
    const start: number[] = [];
    for (const [id, entry] of this.entries) {
      if (entry.nextAt > now) continue;
      entry.nextAt = this.slot(id, entry.intervalMinutes, now, true);
      if (entry.running) continue;
      entry.running = true;
      start.push(id);
    }
    return start;
  }

  finished(id: number): void {
    const entry = this.entries.get(id);
    if (entry) entry.running = false;
  }

  /** The earliest next slot, or null with no monitors. */
  nextWakeAt(): Date | null {
    let earliest = Infinity;
    for (const entry of this.entries.values()) earliest = Math.min(earliest, entry.nextAt);
    return earliest === Infinity ? null : new Date(earliest);
  }
}
