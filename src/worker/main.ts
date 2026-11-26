import { createPool } from '../db/connection.js';
import { systemClock } from '../shared/clock.js';
import { faultConfigFromEnv, type FaultConfig } from '../shared/worker-fault.js';
import { nodeHttpClient } from './http-client.js';
import { MySqlStore } from './store.js';
import { CONFIRM_POLL_MS, CheckWorker, HEARTBEAT_MS, REFRESH_MS } from './worker.js';

/** Upper bound on one wait, so a monitor added at the next refresh is not slept past. */
const MAX_WAIT_MS = 1_000;

const databaseUrl = process.env.DATABASE_URL;
const workerName = process.env.WORKER_NAME;
if (!databaseUrl || !workerName) {
  console.error('DATABASE_URL and WORKER_NAME must be set, e.g. WORKER_NAME=worker-1');
  process.exit(1);
}

let fault: FaultConfig;
try {
  fault = faultConfigFromEnv(process.env);
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}

const pool = createPool(databaseUrl);
const store = new MySqlStore(pool);
const clock = systemClock;
const workerId = await store.registerWorker(workerName, clock.now());
const worker = new CheckWorker({ clock, client: nodeHttpClient, store, workerId, fault });
const log = (what: string) => (error: unknown) => console.error(`[${workerName}] ${what} failed:`, error);

await worker.refresh();
console.log(`[${workerName}] started as worker ${workerId}`);

const timers = [
  setInterval(() => worker.heartbeat().catch(log('heartbeat')), HEARTBEAT_MS),
  setInterval(() => worker.refresh().catch(log('refresh')), REFRESH_MS),
  setInterval(() => worker.confirmPending().catch(log('confirmation')), CONFIRM_POLL_MS),
];

// Wakes at the next slot; the slots themselves come from the grid, so timer lateness never adds up.
let wake: NodeJS.Timeout;
let stopping = false;
function scheduleWake(): void {
  if (stopping) return;
  const next = worker.scheduler.nextWakeAt();
  const wait = next === null ? MAX_WAIT_MS : Math.min(Math.max(next.getTime() - clock.now().getTime(), 0), MAX_WAIT_MS);
  wake = setTimeout(() => {
    worker.runDue().catch(log('check'));
    scheduleWake();
  }, wait);
}
scheduleWake();

async function stop(): Promise<void> {
  stopping = true;
  clearTimeout(wake);
  for (const timer of timers) clearInterval(timer);
  await pool.end();
  console.log(`[${workerName}] stopped`);
}
process.once('SIGTERM', () => void stop());
process.once('SIGINT', () => void stop());
