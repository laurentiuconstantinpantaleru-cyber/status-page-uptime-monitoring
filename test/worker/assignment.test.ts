import { describe, expect, it } from 'vitest';
import { ACTIVE_WITHIN_MS, activeWorkers, primaryWorker } from '../../src/worker/assignment.js';

const NOW = new Date('2026-11-26T10:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe('worker assignment', () => {
  it('gives a monitor to active_workers[monitor_id % count]', () => {
    const active = activeWorkers(
      [
        { id: 7, lastSeenAt: ago(1_000) },
        { id: 3, lastSeenAt: ago(5_000) },
      ],
      NOW,
    );

    expect(active).toEqual([3, 7]);
    expect(primaryWorker(10, active)).toBe(3);
    expect(primaryWorker(11, active)).toBe(7);
  });

  it('leaves out a worker without a heartbeat in the last 30 seconds, so the other takes its monitors', () => {
    const active = activeWorkers(
      [
        { id: 1, lastSeenAt: ago(ACTIVE_WITHIN_MS + 1) },
        { id: 2, lastSeenAt: ago(ACTIVE_WITHIN_MS) },
        { id: 3, lastSeenAt: null },
      ],
      NOW,
    );

    expect(ACTIVE_WITHIN_MS).toBe(30_000);
    expect(active).toEqual([2]);
    expect(primaryWorker(10, active)).toBe(2);
    expect(primaryWorker(11, active)).toBe(2);
  });

  it('has no primary when no worker is active', () => {
    expect(primaryWorker(10, [])).toBeNull();
  });
});
