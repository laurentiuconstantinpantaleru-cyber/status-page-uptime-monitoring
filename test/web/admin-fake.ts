import type { FastifyInstance } from 'fastify';
import { FakeClock } from '../../src/shared/clock.js';
import { buildApp } from '../../src/web/app.js';
import type { AdminGroup, AdminIncident, AdminStore, NewIncidentUpdate } from '../../src/web/admin/store.js';
import { hashPassword } from '../../src/web/auth/password.js';
import type { AuthStore, SessionRow, UserCredentials } from '../../src/web/auth/store.js';
import type { ReportDownloads } from '../../src/web/reports/job.js';
import type { ReportOrg } from '../../src/web/reports/months.js';
import type { StatusData } from '../../src/web/status/model.js';

// In-memory stores for the admin routes (D-034–D-038): what the routes ask and write, without MySQL.

export const NOW = new Date('2026-11-26T14:55:00.000Z');
export const HOST = 'status.example';
export const ORIGIN = `https://${HOST}`;
export const PASSWORD = 'correct-horse-battery';
const HASH = await hashPassword(PASSWORD);

export const ORG_A = 1;
export const ORG_B = 2;
export const MONITOR_A = 10;
export const INCIDENT_A = 20;

export const USERS = {
  member: { id: 1, email: 'member@a.test', displayName: 'Mara Member', role: 'member', organizationId: ORG_A },
  orgAdmin: { id: 2, email: 'admin@a.test', displayName: 'Andrei Admin', role: 'org_admin', organizationId: ORG_A },
  otherAdmin: { id: 3, email: 'admin@b.test', displayName: 'Bianca Admin', role: 'org_admin', organizationId: ORG_B },
  global: { id: 4, email: 'global@ops.test', displayName: 'Gabi Global', role: 'global_admin', organizationId: null },
} as const;
export type Who = keyof typeof USERS | 'visitor';

export interface FakeAuth extends AuthStore {
  sessions: Map<string, SessionRow & { userId: number }>;
}

export function fakeAuth(): FakeAuth {
  const users: (UserCredentials & { email: string })[] = [
    ...Object.values(USERS).map((u) => ({ ...u, passwordHash: HASH })),
    { id: 5, email: 'nopassword@a.test', displayName: 'No Password', role: 'member', organizationId: ORG_A, passwordHash: null },
  ];
  const sessions = new Map<string, SessionRow & { userId: number }>();
  return {
    sessions,
    async userByEmail(email) {
      const u = users.find((x) => x.email === email);
      return u ? { id: u.id, displayName: u.displayName, role: u.role, organizationId: u.organizationId, passwordHash: u.passwordHash } : null;
    },
    async createSession(tokenHash, userId, now) {
      const u = users.find((x) => x.id === userId)!;
      const user = { id: u.id, displayName: u.displayName, role: u.role, organizationId: u.organizationId };
      sessions.set(tokenHash, { userId, createdAt: now, lastSeenAt: now, user });
    },
    async session(tokenHash) {
      return sessions.get(tokenHash) ?? null;
    },
    async touchSession(tokenHash, now) {
      const s = sessions.get(tokenHash);
      if (s) s.lastSeenAt = now;
    },
    async deleteSession(tokenHash) {
      sessions.delete(tokenHash);
    },
  };
}

export interface FakeAdmin extends AdminStore {
  maintenance: { monitorId: number; minutes: number; userId: number }[];
  deleted: number[];
  updates: (NewIncidentUpdate & { at: Date })[];
  fail: { monitors?: boolean; incidents?: boolean; addUpdate?: boolean };
}

export function fakeAdmin(opts: { groups?: AdminGroup[]; incidents?: (AdminIncident & { organizationId: number })[] } = {}): FakeAdmin {
  const groups: (AdminGroup & { organizationId: number })[] = (opts.groups as (AdminGroup & { organizationId: number })[]) ?? [
    {
      organizationId: ORG_A,
      organization: 'Campus projects',
      monitors: [{
        id: MONITOR_A, name: 'Bookings API', url: 'https://api.bookings.example/health', intervalMinutes: 1, status: 'outage',
        lastCheck: { checkedAt: new Date('2026-11-26T14:54:00.000Z'), latencyMs: null },
      }],
    },
    {
      organizationId: ORG_B,
      organization: 'Local businesses',
      monitors: [{
        id: 11, name: 'Hug The Mug', url: 'https://hugthemug.ro/', intervalMinutes: 5, status: 'ok',
        lastCheck: { checkedAt: new Date('2026-11-26T14:50:00.000Z'), latencyMs: 182 },
      }],
    },
  ];
  const incidents = opts.incidents ?? [{
    id: INCIDENT_A, organizationId: ORG_A, monitor: 'Bookings API', cause: 'timeout',
    startedAt: new Date('2026-11-26T14:02:00.000Z'), resolvedAt: null,
    updates: [{ stage: 'investigating', body: 'The bookings API does not answer.', createdAt: new Date('2026-11-26T14:10:00.000Z') }],
  }];
  const store: FakeAdmin = {
    maintenance: [],
    deleted: [],
    updates: [],
    fail: {},
    async organizationName(id) {
      return groups.find((g) => g.organizationId === id)?.organization ?? null;
    },
    async monitors(orgId) {
      if (store.fail.monitors) throw new Error('database down');
      return groups.filter((g) => orgId === null || g.organizationId === orgId).map(({ organization, monitors }) => ({ organization, monitors }));
    },
    async monitor(id, orgId) {
      for (const g of groups) {
        const m = g.monitors.find((x) => x.id === id);
        if (m && (orgId === null || g.organizationId === orgId)) return { id: m.id, name: m.name };
      }
      return null;
    },
    async startQuickMaintenance(monitorId, minutes, userId) {
      store.maintenance.push({ monitorId, minutes, userId });
    },
    async deleteMonitor(id) {
      store.deleted.push(id);
    },
    async incidents(orgId) {
      if (store.fail.incidents) throw new Error('database down');
      return incidents.filter((i) => orgId === null || i.organizationId === orgId).map(({ organizationId: _, ...i }) => i);
    },
    async incident(id, orgId) {
      const i = incidents.find((x) => x.id === id && (orgId === null || x.organizationId === orgId));
      return i ? { id: i.id } : null;
    },
    async addIncidentUpdate(u, now) {
      if (store.fail.addUpdate) throw new Error('database down');
      store.updates.push({ ...u, at: now });
    },
  };
  return store;
}

/** Monthly report PDFs (D-019): one fake file per organization and month asked for. */
export interface FakeReports extends ReportDownloads {
  asked: { orgId: number; year: number; month: number }[];
  orgs: ReportOrg[];
  fail: boolean;
}

export function fakeReports(): FakeReports {
  const reports: FakeReports = {
    asked: [],
    fail: false,
    orgs: [
      {
        id: ORG_A, name: 'Campus projects', createdAt: new Date('2026-08-15T09:00:00.000Z'),
        reports: [
          { month: '2026-10', emailedAt: null, emailedTo: null, lastError: 'SMTP 421 try again later' },
          { month: '2026-09', emailedAt: new Date('2026-10-01T00:00:04.000Z'), emailedTo: 2, lastError: null },
        ],
      },
      { id: ORG_B, name: 'Local businesses', createdAt: new Date('2026-09-01T00:00:00.000Z'), reports: [] },
    ],
    async list(orgId) {
      if (reports.fail) throw new Error('database down');
      return reports.orgs.filter((o) => orgId === null || o.id === orgId);
    },
    async pdf(orgId, year, month) {
      if (orgId !== ORG_A && orgId !== ORG_B) return null;
      reports.asked.push({ orgId, year, month });
      return Buffer.from(`%PDF-fake ${orgId} ${year}-${month}`);
    },
  };
  return reports;
}

export interface Harness {
  app: FastifyInstance;
  clock: FakeClock;
  auth: FakeAuth;
  admin: FakeAdmin;
  reports: FakeReports;
}

export function harness(opts: { admin?: FakeAdmin; secureCookies?: boolean; status?: StatusData } = {}): Harness {
  const clock = new FakeClock(NOW);
  const auth = fakeAuth();
  const admin = opts.admin ?? fakeAdmin();
  const reports = fakeReports();
  const status = opts.status ?? { groups: [] };
  const app = buildApp({}, {
    clock,
    status: { load: async () => status, readVersion: async () => 1 },
    admin: { auth, store: admin, secureCookies: opts.secureCookies ?? false, reports },
  });
  return { app, clock, auth, admin, reports };
}

export const form = (fields: Record<string, string>) => new URLSearchParams(fields).toString();

/** A POST as a browser on this site sends it: same Origin, form-encoded. */
export function post(app: FastifyInstance, url: string, fields: Record<string, string>, cookie?: string) {
  return app.inject({
    method: 'POST',
    url,
    headers: {
      host: HOST,
      origin: ORIGIN,
      'content-type': 'application/x-www-form-urlencoded',
      ...(cookie ? { cookie } : {}),
    },
    payload: form(fields),
  });
}

export function get(app: FastifyInstance, url: string, cookie?: string) {
  return app.inject({ method: 'GET', url, headers: { host: HOST, ...(cookie ? { cookie } : {}) } });
}

/** Signs in and returns the `sid=…` pair to send back. */
export async function signIn(app: FastifyInstance, who: Exclude<Who, 'visitor'>): Promise<string> {
  const response = await post(app, '/login', { email: USERS[who].email, password: PASSWORD });
  if (response.statusCode !== 303) throw new Error(`sign-in failed: ${response.statusCode}`);
  const setCookie = String(response.headers['set-cookie']);
  return setCookie.split(';')[0];
}
