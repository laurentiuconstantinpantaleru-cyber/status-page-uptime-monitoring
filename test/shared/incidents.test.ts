import { describe, expect, it } from 'vitest';
import {
  CLOSE_AFTER,
  OPEN_AFTER,
  decideIncident,
  publicStateChanged,
  type RecordedCheck,
  type ScheduledCheck,
} from '../../src/shared/incidents.js';

const T0 = new Date('2026-11-26T10:00:00.000Z');
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
let nextId = 1;

function check(outcome: 'up' | 'down', minute: number, extra: Partial<RecordedCheck> = {}): RecordedCheck {
  return {
    id: nextId++,
    checkedAt: at(minute),
    outcome,
    httpStatus: outcome === 'up' ? 200 : 503,
    latencyMs: outcome === 'up' ? 200 : null,
    errorCause: outcome === 'up' ? null : 'http_5xx',
    ...extra,
  };
}

/** A scheduled check and its confirmation by the other worker, 10 seconds later. */
function scheduled(outcome: 'up' | 'down', minute: number, confirmation?: 'up' | 'down'): ScheduledCheck {
  return {
    check: check(outcome, minute),
    confirmation: confirmation ? check(confirmation, minute + 1 / 6) : null,
  };
}

const closed = { openIncident: false, inMaintenance: false };
const open = { openIncident: true, inMaintenance: false };

describe('decideIncident (D-006, D-028)', () => {
  it('uses N = 2 and M = 2', () => {
    expect(OPEN_AFTER).toBe(2);
    expect(CLOSE_AFTER).toBe(2);
  });

  it('opens after 2 consecutive failures confirmed by the other worker', () => {
    const recent = [scheduled('down', 5, 'down'), scheduled('down', 0, 'down')];

    expect(decideIncident({ ...closed, recent })?.kind).toBe('open');
  });

  it('does not open after a single confirmed failure', () => {
    const recent = [scheduled('down', 5, 'down'), scheduled('up', 0)];

    expect(decideIncident({ ...closed, recent })).toBeNull();
  });

  it('does not open when a failure is not confirmed', () => {
    expect(decideIncident({ ...closed, recent: [scheduled('down', 5, 'down'), scheduled('down', 0, 'up')] })).toBeNull();
    expect(decideIncident({ ...closed, recent: [scheduled('down', 5), scheduled('down', 0, 'down')] })).toBeNull();
  });

  it('does not open during a maintenance window', () => {
    const recent = [scheduled('down', 5, 'down'), scheduled('down', 0, 'down')];

    expect(decideIncident({ ...closed, inMaintenance: true, recent })).toBeNull();
  });

  it('resolves after 2 consecutive successes', () => {
    const recent = [scheduled('up', 15), scheduled('up', 10), scheduled('down', 5, 'down')];

    expect(decideIncident({ ...open, recent })).toEqual({ kind: 'resolve', resolvedAt: at(10) });
  });

  it('does not resolve after a single success', () => {
    const recent = [scheduled('up', 10), scheduled('down', 5, 'down')];

    expect(decideIncident({ ...open, recent })).toBeNull();
  });

  it('resolves during a maintenance window', () => {
    const recent = [scheduled('up', 15), scheduled('up', 10)];

    expect(decideIncident({ ...open, inMaintenance: true, recent })?.kind).toBe('resolve');
  });

  it('starts the incident at the first failure, with the cause and code of the latest confirmation', () => {
    const latest: ScheduledCheck = {
      check: check('down', 5),
      confirmation: check('down', 5.2, { httpStatus: null, errorCause: 'timeout' }),
    };
    const recent = [latest, scheduled('down', 0, 'down')];

    expect(decideIncident({ ...closed, recent })).toEqual({
      kind: 'open',
      startedAt: at(0),
      cause: 'timeout',
      httpStatus: null,
    });
  });
});

describe('publicStateChanged (D-020, D-023)', () => {
  it('changes on the first check of a monitor', () => {
    expect(publicStateChanged(null, check('up', 0), null)).toBe(true);
  });

  it('changes when the latency crosses the threshold, either way', () => {
    const fast = check('up', 0, { latencyMs: 400 });
    const slow = check('up', 5, { latencyMs: 600 });

    expect(publicStateChanged(fast, slow, 500)).toBe(true);
    expect(publicStateChanged(slow, fast, 500)).toBe(true);
  });

  it('does not change otherwise', () => {
    expect(publicStateChanged(check('up', 0), check('up', 5), null)).toBe(false);
    expect(publicStateChanged(check('up', 0, { latencyMs: 400 }), check('down', 5), 500)).toBe(false);
    expect(publicStateChanged(check('up', 0, { latencyMs: 600 }), check('up', 5, { latencyMs: 700 }), 500)).toBe(false);
  });
});
