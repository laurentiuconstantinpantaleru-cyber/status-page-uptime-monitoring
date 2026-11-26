import type { MaintenanceSpan } from './uptime.js';

const MINUTE = 60_000;
const DAY_MS = 24 * 60 * MINUTE;

/** A recurring maintenance rule (D-031); every time in it is UTC. */
export interface MaintenanceSchedule {
  frequency: 'daily' | 'weekly';
  /** Weekly only: UTC weekdays, 0 = Sunday. Empty for daily. */
  weekdays: number[];
  /** When each window starts, in minutes after UTC midnight. */
  startMinute: number;
  /** Under 24 h for daily, under 7 days for weekly. */
  durationMinutes: number;
  /** UTC midnight of the first day a window may start on. */
  startsOn: Date;
  /** No window starts from here on, and one in progress ends here; `null` while the rule runs. */
  endedAt: Date | null;
}

/** The quick maintenance lengths, in minutes (D-012). */
export const QUICK_MINUTES = [15, 30, 60];

/**
 * The rule's windows that overlap [from, to), including one that started on an earlier day
 * and runs past midnight into the period.
 */
export function occurrences(schedule: MaintenanceSchedule, from: Date, to: Date): MaintenanceSpan[] {
  const durationMs = schedule.durationMinutes * MINUTE;
  const firstDay = Math.max(
    schedule.startsOn.getTime(),
    Math.floor((from.getTime() - durationMs) / DAY_MS) * DAY_MS,
  );
  const ended = schedule.endedAt?.getTime() ?? Infinity;
  const spans: MaintenanceSpan[] = [];
  for (let day = firstDay; day < to.getTime(); day += DAY_MS) {
    if (schedule.frequency === 'weekly' && !schedule.weekdays.includes(new Date(day).getUTCDay())) continue;
    const start = day + schedule.startMinute * MINUTE;
    const end = Math.min(start + durationMs, ended);
    if (start < ended && end > from.getTime() && start < to.getTime()) {
      spans.push({ startsAt: new Date(start), endsAt: new Date(end) });
    }
  }
  return spans;
}

/**
 * A quick maintenance window from now for 15, 30 or 60 minutes (D-012). Pressed while maintenance
 * is in force, it extends that maintenance (with any window that follows on without a gap) by the
 * chosen length.
 */
export function quickWindow(now: Date, minutes: number, windows: MaintenanceSpan[]): MaintenanceSpan {
  if (!QUICK_MINUTES.includes(minutes)) throw new Error(`Quick maintenance lasts 15, 30 or 60 minutes, not ${minutes}`);
  let end = now.getTime();
  let grown = true;
  while (grown) {
    grown = false;
    for (const w of windows) {
      if (w.startsAt.getTime() <= end && w.endsAt.getTime() > end) {
        end = w.endsAt.getTime();
        grown = true;
      }
    }
  }
  return { startsAt: now, endsAt: new Date(end + minutes * MINUTE) };
}
