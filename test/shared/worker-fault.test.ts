import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FAULT_CONFIG,
  faultConfigFromEnv,
  judgeWorker,
  type WindowCheck,
} from '../../src/shared/worker-fault.js';

const MIN = 60_000;

/** A scheduled check of a monitor by the judged worker, and the other worker's confirmation, if any. */
const c = (monitorId: number, outcome: 'up' | 'down', confirmation: 'up' | 'down' | null = null): WindowCheck => ({
  monitorId,
  outcome,
  confirmation,
});

describe('judgeWorker (D-015)', () => {
  it('uses 3 monitors, 70 % and a 10-minute window by default', () => {
    expect(DEFAULT_FAULT_CONFIG).toEqual({ minMonitors: 3, thresholdPct: 70, windowMs: 10 * MIN });
  });

  it('makes no judgment with fewer than 3 monitors checked', () => {
    const checks = [c(1, 'down', 'up'), c(2, 'down', 'up'), c(1, 'down', 'up'), c(2, 'down', 'up')];

    expect(judgeWorker(checks, DEFAULT_FAULT_CONFIG)).toBeNull();
  });

  it('finds a worker degraded at exactly 70 % of its checks failed', () => {
    // 10 checks on 3 monitors, 7 failed, each failure confirmed up by the other worker.
    const checks = [
      c(1, 'down', 'up'), c(2, 'down', 'up'), c(3, 'down', 'up'), c(1, 'down', 'up'), c(2, 'down', 'up'),
      c(3, 'down', 'up'), c(1, 'down', 'up'), c(2, 'up'), c(3, 'up'), c(1, 'up'),
    ];

    expect(judgeWorker(checks, DEFAULT_FAULT_CONFIG)).toEqual({
      degraded: true,
      counts: { monitorsChecked: 3, checksTotal: 10, checksFailed: 7, confirmationsTotal: 7, confirmationsUp: 7 },
    });
  });

  it('finds a worker healthy just under 70 % failed (69 of 100)', () => {
    const checks = Array.from({ length: 100 }, (_, i) => (i < 69 ? c((i % 3) + 1, 'down', 'up') : c((i % 3) + 1, 'up')));

    expect(judgeWorker(checks, DEFAULT_FAULT_CONFIG)?.degraded).toBe(false);
  });

  it('counts 70 % of the confirmations up as enough (7 of 10), not 6 of 10', () => {
    const at = (up: number) =>
      Array.from({ length: 10 }, (_, i) => c((i % 3) + 1, 'down', i < up ? 'up' : 'down'));

    expect(judgeWorker(at(7), DEFAULT_FAULT_CONFIG)?.degraded).toBe(true);
    expect(judgeWorker(at(6), DEFAULT_FAULT_CONFIG)?.degraded).toBe(false);
  });

  it('counts 70 % of the confirmations up as enough', () => {
    const checks = [
      c(1, 'down', 'up'), c(2, 'down', 'up'), c(3, 'down', 'up'), c(1, 'down', 'up'), c(2, 'down', 'up'),
      c(3, 'down', 'up'), c(1, 'down', 'up'), c(2, 'down', 'down'), c(3, 'down', 'down'), c(1, 'down', 'down'),
    ];

    expect(judgeWorker(checks, DEFAULT_FAULT_CONFIG)?.degraded).toBe(true);
  });

  it('finds a worker healthy when 2 of 3 checks failed (66 %)', () => {
    const checks = [c(1, 'down', 'up'), c(2, 'down', 'up'), c(3, 'up')];

    expect(judgeWorker(checks, DEFAULT_FAULT_CONFIG)?.degraded).toBe(false);
  });

  it('finds a worker healthy when the other worker also sees the sites down', () => {
    const checks = [c(1, 'down', 'down'), c(2, 'down', 'down'), c(3, 'down', 'up')];

    expect(judgeWorker(checks, DEFAULT_FAULT_CONFIG)?.degraded).toBe(false);
  });

  it('finds a worker healthy while none of its failures is confirmed yet', () => {
    const checks = [c(1, 'down'), c(2, 'down'), c(3, 'down')];

    expect(judgeWorker(checks, DEFAULT_FAULT_CONFIG)).toEqual({
      degraded: false,
      counts: { monitorsChecked: 3, checksTotal: 3, checksFailed: 3, confirmationsTotal: 0, confirmationsUp: 0 },
    });
  });

  it('follows configured thresholds', () => {
    const checks = [c(1, 'down', 'up'), c(2, 'up')];

    expect(judgeWorker(checks, { minMonitors: 2, thresholdPct: 50, windowMs: MIN })?.degraded).toBe(true);
  });
});

describe('faultConfigFromEnv', () => {
  it('uses the defaults when nothing is set', () => {
    expect(faultConfigFromEnv({})).toEqual(DEFAULT_FAULT_CONFIG);
  });

  it('reads the three variables', () => {
    expect(
      faultConfigFromEnv({ MIN_WORKER_MONITORS: '4', WORKER_FAULT_THRESHOLD: '80', WORKER_FAULT_WINDOW_MINUTES: '15' }),
    ).toEqual({ minMonitors: 4, thresholdPct: 80, windowMs: 15 * MIN });
  });

  it.each([
    ['MIN_WORKER_MONITORS', '0'],
    ['MIN_WORKER_MONITORS', 'three'],
    ['WORKER_FAULT_THRESHOLD', '0'],
    ['WORKER_FAULT_THRESHOLD', '101'],
    ['WORKER_FAULT_THRESHOLD', '70.5'],
    ['WORKER_FAULT_WINDOW_MINUTES', '0'],
    ['WORKER_FAULT_WINDOW_MINUTES', ''],
  ])('rejects %s=%j', (name, value) => {
    expect(() => faultConfigFromEnv({ [name]: value })).toThrow(name);
  });
});
