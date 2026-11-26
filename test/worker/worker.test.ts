import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../src/shared/clock.js';
import type { HttpClient, HttpResponse } from '../../src/worker/check.js';
import type { MonitorRow } from '../../src/worker/store.js';
import { CONFIRM_POLL_MS, CONFIRM_WITHIN_MS, CheckWorker } from '../../src/worker/worker.js';
import { MemoryStore } from './memory-store.js';

const T0 = new Date('2026-11-26T10:00:00.000Z');
const MIN = 60_000;

/** Monitor 3: primary is active_workers[3 % 2], the second worker; slot offset 3 s on a 5-minute grid. */
const MONITOR: MonitorRow = {
  id: 3,
  url: 'https://example.test/',
  intervalMinutes: 5,
  expectedStatus: 200,
  timeoutMs: 10_000,
  keyword: null,
  checkTls: false,
  latencyThresholdMs: null,
};

const UP: HttpResponse = { status: 200, body: 'ok' };
const DOWN: HttpResponse = { status: 503, body: 'Service Unavailable' };

/** Every request answers with whatever `answer` holds at the time, after no simulated time. */
function switchableClient(): HttpClient & { answer: HttpResponse } {
  return {
    answer: UP,
    async request() {
      return this.answer;
    },
  };
}

async function setup() {
  const clock = new FakeClock(T0);
  const store = new MemoryStore();
  store.monitors = [MONITOR];
  const client = switchableClient();
  const first = new CheckWorker({ clock, client, store, workerId: await store.registerWorker('worker-1', T0) });
  const second = new CheckWorker({ clock, client, store, workerId: await store.registerWorker('worker-2', T0) });
  for (const w of [first, second]) await w.refresh();
  return { clock, store, client, first, second };
}

/** Moves to the monitor's next slot, keeps both workers alive, and runs what is due on both. */
async function nextSlot(env: Awaited<ReturnType<typeof setup>>) {
  const { clock, first, second } = env;
  const wake = second.scheduler.nextWakeAt()!;
  clock.advance(wake.getTime() - clock.now().getTime());
  for (const w of [first, second]) await w.heartbeat();
  for (const w of [first, second]) await w.refresh();
  await Promise.all([first.runDue(), second.runDue()]);
}

/** One confirmation poll on both workers, a poll period after the slot. */
async function confirmationPoll(env: Awaited<ReturnType<typeof setup>>) {
  env.clock.advance(CONFIRM_POLL_MS);
  await Promise.all([env.first.confirmPending(), env.second.confirmPending()]);
}

describe('CheckWorker', () => {
  it('checks a monitor only on its primary worker', async () => {
    const env = await setup();

    await nextSlot(env);

    expect(env.store.checks).toHaveLength(1);
    expect(env.store.checks[0]).toMatchObject({ monitorId: 3, workerId: 2, kind: 'scheduled', confirmsCheckId: null });
    expect(env.store.checks[0].checkedAt.toISOString()).toBe('2026-11-26T10:00:03.000Z');
  });

  it('has the other worker confirm a down check at its next poll, once', async () => {
    const env = await setup();
    env.client.answer = DOWN;
    await nextSlot(env);

    await confirmationPoll(env);
    await confirmationPoll(env);

    expect(CONFIRM_POLL_MS).toBe(5_000);
    const [scheduled, confirmation, ...rest] = env.store.checks;
    expect(rest).toHaveLength(0);
    expect(confirmation).toMatchObject({ kind: 'confirmation', workerId: 1, confirmsCheckId: scheduled.id });
    expect(confirmation.result).toMatchObject({ outcome: 'down', errorCause: 'http_5xx' });
  });

  it('leaves a down check older than 2 minutes unconfirmed', async () => {
    const env = await setup();
    env.client.answer = DOWN;
    await nextSlot(env);

    env.clock.advance(CONFIRM_WITHIN_MS + 1);
    await env.first.confirmPending();

    expect(CONFIRM_WITHIN_MS).toBe(2 * MIN);
    expect(env.store.checks.filter((c) => c.kind === 'confirmation')).toHaveLength(0);
  });

  it('opens an incident after 2 confirmed failures and resolves it after 2 successes', async () => {
    const env = await setup();
    const slot = (n: number) => new Date(T0.getTime() + n * 5 * MIN + 3_000);
    env.client.answer = DOWN;

    await nextSlot(env);
    await confirmationPoll(env);
    expect(env.store.incidents).toHaveLength(0);

    await nextSlot(env);
    await confirmationPoll(env);
    expect(env.store.incidents).toEqual([
      { monitorId: 3, startedAt: slot(0), resolvedAt: null, cause: 'http_5xx', httpStatus: 503 },
    ]);

    env.client.answer = UP;
    await nextSlot(env);
    expect(env.store.incidents[0].resolvedAt).toBeNull();
    await nextSlot(env);

    expect(env.store.incidents[0].resolvedAt).toEqual(slot(2));
    expect(env.store.statusVersion).toBe(3); // first check, open, resolve
  });

  it('keeps checking during maintenance but opens no incident', async () => {
    const env = await setup();
    env.store.maintenance = [{ monitorId: 3, startsAt: T0, endsAt: new Date(T0.getTime() + 60 * MIN) }];
    env.client.answer = DOWN;

    for (let i = 0; i < 3; i++) {
      await nextSlot(env);
      await confirmationPoll(env);
    }

    expect(env.store.checks.filter((c) => c.kind === 'scheduled')).toHaveLength(3);
    expect(env.store.incidents).toHaveLength(0);
  });
});
