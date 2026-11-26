import type { FastifyInstance } from 'fastify';
import { FakeClock } from '../../src/shared/clock.js';
import { buildApp } from '../../src/web/app.js';
import type { NewMonitor } from '../../src/web/api/monitor-input.js';
import { hashSecret, newApiKey } from '../../src/web/api/keys.js';
import type { ApiKeyRow, ApiMonitor, ApiStore } from '../../src/web/api/store.js';
import type { Status } from '../../src/web/status/model.js';
import { HOST, MONITOR_A, NOW, ORG_A, ORG_B, fakeAdmin, fakeAuth, type FakeAdmin } from './admin-fake.js';

// An in-memory ApiStore (D-025, D-039): keys with real bcrypt hashes, monitors of two organizations.

/** The plaintext keys the tests send; their rows hold only the hash. */
export const KEYS = {
  read: newApiKey(),
  write: newApiKey(),
  otherWrite: newApiKey(),
  revoked: newApiKey(),
};
export type KeyName = keyof typeof KEYS;

const ROWS: (ApiKeyRow & { publicId: string })[] = [
  { id: 1, publicId: KEYS.read.publicId, organizationId: ORG_A, level: 'read', keyHash: await hashSecret(KEYS.read.secret), revokedAt: null },
  { id: 2, publicId: KEYS.write.publicId, organizationId: ORG_A, level: 'write', keyHash: await hashSecret(KEYS.write.secret), revokedAt: null },
  { id: 3, publicId: KEYS.otherWrite.publicId, organizationId: ORG_B, level: 'write', keyHash: await hashSecret(KEYS.otherWrite.secret), revokedAt: null },
  { id: 4, publicId: KEYS.revoked.publicId, organizationId: ORG_A, level: 'write', keyHash: await hashSecret(KEYS.revoked.secret), revokedAt: new Date('2026-11-20T00:00:00.000Z') },
];

export const MONITOR_B = 11;

export interface FakeApi extends ApiStore {
  created: { organizationId: number; monitor: NewMonitor; at: Date }[];
  bumps: number;
  fail: { monitors?: boolean };
}

export function fakeApi(): FakeApi {
  const monitors: (ApiMonitor & { organizationId: number })[] = [
    { id: MONITOR_A, organizationId: ORG_A, name: 'Bookings API', url: 'https://api.bookings.example/health', intervalMinutes: 1, status: 'outage' },
    { id: MONITOR_B, organizationId: ORG_B, name: 'Hug The Mug', url: 'https://hugthemug.ro/', intervalMinutes: 5, status: 'ok' },
  ];
  let nextId = 100;
  const store: FakeApi = {
    created: [],
    bumps: 0,
    fail: {},
    async keyByPublicId(publicId) {
      const row = ROWS.find((r) => r.publicId === publicId);
      if (!row) return null;
      const { publicId: _, ...key } = row;
      return key;
    },
    async monitors(orgId) {
      if (store.fail.monitors) throw new Error('database down');
      return monitors.filter((m) => m.organizationId === orgId).map(({ organizationId: _, ...m }) => m);
    },
    async createMonitor(organizationId, monitor, now) {
      const id = nextId++;
      store.created.push({ organizationId, monitor, at: now });
      store.bumps += 1;
      monitors.push({ id, organizationId, name: monitor.name, url: monitor.url, intervalMinutes: monitor.intervalMinutes, status: 'nodata' });
      return id;
    },
    async monitorStatus(id) {
      return monitors.find((m) => m.id === id)?.status ?? null;
    },
  };
  return store;
}

/** Sets the status a monitor's badge shows. */
export async function setStatus(api: FakeApi, id: number, status: Status) {
  const original = api.monitorStatus.bind(api);
  api.monitorStatus = async (x, now) => (x === id ? status : original(x, now));
}

export interface ApiHarness {
  app: FastifyInstance;
  clock: FakeClock;
  api: FakeApi;
  admin: FakeAdmin;
}

/** The whole app, with the admin routes too, so the Origin hook and cookies are in play. */
export function apiHarness(): ApiHarness {
  const clock = new FakeClock(NOW);
  const api = fakeApi();
  const admin = fakeAdmin();
  const app = buildApp({}, {
    clock,
    status: { load: async () => ({ groups: [] }), readVersion: async () => 1 },
    admin: { auth: fakeAuth(), store: admin, secureCookies: false },
    api: { store: api },
  });
  return { app, clock, api, admin };
}

export const bearer = (key: KeyName) => `Bearer ${KEYS[key].plaintext}`;

/** A script's request: no Origin, no cookie, JSON. */
export function apiGet(app: FastifyInstance, url: string, authorization?: string) {
  return app.inject({ method: 'GET', url, headers: { host: HOST, ...(authorization ? { authorization } : {}) } });
}

export function apiPost(app: FastifyInstance, url: string, body: unknown, authorization?: string) {
  return app.inject({
    method: 'POST',
    url,
    headers: { host: HOST, 'content-type': 'application/json', ...(authorization ? { authorization } : {}) },
    payload: JSON.stringify(body),
  });
}
