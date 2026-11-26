import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Clock } from '../../shared/clock.js';
import { can, sameOrigin, scopeOf, type Permission, type SignedInUser } from '../auth/access.js';
import { verifyPassword } from '../auth/password.js';
import {
  SESSION_COOKIE, clearedSessionCookie, hashToken, newSessionToken, readCookie, sessionAlive, sessionCookie,
} from '../auth/session.js';
import type { AuthStore } from '../auth/store.js';
import { parseUpdate } from './incidents.js';
import { renderDeleteConfirm, renderIncidents, renderLogin, renderMonitors, type FormState } from './render.js';
import type { AdminStore } from './store.js';

// Sign-in and the admin pages (D-034–D-038). Every check runs on the server: the role (D-018)
// in `guard`, the organization in the store's queries, the form fields here.

export interface AdminDeps {
  auth: AuthStore;
  store: AdminStore;
  /** `Secure` on the session cookie; true in production (D-035). */
  secureCookies: boolean;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const QUICK_MINUTES = ['15', '30', '60'];
/** Only digits: anything else in an id is a page that does not exist. */
const ID = /^[1-9][0-9]{0,15}$/;

type Fields = Record<string, string>;

declare module 'fastify' {
  interface FastifyRequest {
    user: SignedInUser | null;
  }
}

const fieldsOf = (request: FastifyRequest): Fields => (request.body ?? {}) as Fields;
const idOf = (request: FastifyRequest) => {
  const raw = (request.params as { id?: string }).id ?? '';
  return ID.test(raw) ? Number(raw) : null;
};

function plain(reply: FastifyReply, code: number, text: string) {
  return reply.code(code).type('text/plain; charset=utf-8').send(text);
}
const notFound = (reply: FastifyReply) => plain(reply, 404, 'This page does not exist, or it belongs to another organization.');
const html = (reply: FastifyReply, code: number, body: string) => reply.code(code).type('text/html; charset=utf-8').send(body);

export function registerAdminRoutes(app: FastifyInstance, deps: AdminDeps, clock: Clock): void {
  const { auth, store, secureCookies } = deps;

  // Forms arrive URL-encoded; repeated names keep the last value.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 64 * 1024 }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  app.decorateRequest('user', null);

  // D-035: a POST must come from a page of this site.
  app.addHook('onRequest', async (request, reply) => {
    if (request.method === 'POST' && !sameOrigin(request.headers.origin, request.headers.host)) {
      return plain(reply, 403, 'This form was sent from another site, so it was refused.');
    }
  });

  /** The signed-in user, if any. An ended session is deleted; a live one moves its idle limit. */
  const signedIn = async (request: FastifyRequest): Promise<SignedInUser | null> => {
    const token = readCookie(request.headers.cookie, SESSION_COOKIE);
    if (!token) return null;
    const tokenHash = hashToken(token);
    const session = await auth.session(tokenHash);
    if (!session) return null;
    const now = clock.now();
    if (!sessionAlive(session, now)) {
      await auth.deleteSession(tokenHash);
      return null;
    }
    await auth.touchSession(tokenHash, now);
    return session.user;
  };

  /** D-036: no session → 303 to /login; a role without the permission → 403. Only admin routes
   *  look the session up, so the cached status page never waits on MySQL. */
  const guard = (permission: Permission) => async (request: FastifyRequest, reply: FastifyReply) => {
    request.user = await signedIn(request);
    if (!request.user) return reply.redirect('/login', 303);
    if (!can(request.user, permission)) return plain(reply, 403, 'Only an org admin can do this. Ask one in your organization.');
  };
  const user = (request: FastifyRequest) => request.user!;
  const orgLine = async (u: SignedInUser) =>
    u.organizationId === null ? 'All organizations' : ((await store.organizationName(u.organizationId)) ?? '');

  /* ---------- Sign-in ---------- */

  app.get('/login', async (_request, reply) => html(reply, 200, renderLogin({ email: '', errors: {}, wrong: false })));

  app.post('/login', async (request, reply) => {
    if (request.headers['content-type']?.split(';')[0].trim() !== 'application/x-www-form-urlencoded') {
      return plain(reply, 400, 'Send the login form.');
    }
    const fields = fieldsOf(request);
    const email = typeof fields.email === 'string' ? fields.email.trim() : '';
    const password = typeof fields.password === 'string' ? fields.password : '';
    const errors: { email?: string; password?: string } = {};
    if (!email) errors.email = 'Enter your email address.';
    else if (email.length > 255 || !EMAIL.test(email)) errors.email = 'Enter an email address like name@example.test.';
    if (!password) errors.password = 'Enter your password.';
    if (errors.email || errors.password) return html(reply, 400, renderLogin({ email, errors, wrong: false }));

    const found = await auth.userByEmail(email);
    const ok = found?.passwordHash ? await verifyPassword(password, found.passwordHash) : false;
    if (!found || !ok) return html(reply, 401, renderLogin({ email, errors: {}, wrong: true }));

    const token = newSessionToken();
    await auth.createSession(hashToken(token), found.id, clock.now());
    reply.header('set-cookie', sessionCookie(token, secureCookies));
    return reply.redirect('/admin/monitors', 303);
  });

  app.post('/logout', async (request, reply) => {
    const token = readCookie(request.headers.cookie, SESSION_COOKIE);
    if (token) await auth.deleteSession(hashToken(token));
    reply.header('set-cookie', clearedSessionCookie(secureCookies));
    return reply.redirect('/login', 303);
  });

  /* ---------- Monitors (DS-p26-admin-monitors, D-037) ---------- */

  app.get('/admin', { preHandler: guard('view') }, async (_request, reply) => reply.redirect('/admin/monitors', 303));

  app.get<{ Querystring: { started?: string; minutes?: string; deleted?: string } }>(
    '/admin/monitors',
    { preHandler: guard('view') },
    async (request, reply) => {
      const u = user(request);
      const scope = scopeOf(u);
      const view = { org: await orgLine(u), everyOrg: scope === null, admin: can(u, 'manage_monitors') };
      let groups;
      try {
        groups = await store.monitors(scope, clock.now());
      } catch (error) {
        request.log.error(error, 'monitors could not load');
        return html(reply, 503, renderMonitors({ ...view, groups: null, notice: null }));
      }
      const { started, minutes, deleted } = request.query;
      let notice: string | null = null;
      const startedOn = typeof started === 'string' && ID.test(started)
        ? groups.flatMap((g) => g.monitors).find((m) => m.id === Number(started))
        : undefined;
      if (startedOn && typeof minutes === 'string' && QUICK_MINUTES.includes(minutes)) {
        notice = `Maintenance started for ${startedOn.name}: alerts paused for ${minutes} minutes.`;
      } else if (typeof deleted === 'string' && deleted) {
        notice = `${deleted} was deleted.`;
      }
      return html(reply, 200, renderMonitors({ ...view, groups, notice }));
    },
  );

  app.post('/admin/monitors/:id/maintenance', { preHandler: guard('maintenance') }, async (request, reply) => {
    const id = idOf(request);
    const monitor = id === null ? null : await store.monitor(id, scopeOf(user(request)));
    if (!monitor) return notFound(reply);
    const minutes = fieldsOf(request).minutes;
    if (!QUICK_MINUTES.includes(minutes)) return plain(reply, 400, 'Choose 15, 30 or 60 minutes.');
    await store.startQuickMaintenance(monitor.id, Number(minutes), user(request).id);
    return reply.redirect(`/admin/monitors?started=${monitor.id}&minutes=${minutes}`, 303);
  });

  app.get('/admin/monitors/:id/delete', { preHandler: guard('manage_monitors') }, async (request, reply) => {
    const id = idOf(request);
    const monitor = id === null ? null : await store.monitor(id, scopeOf(user(request)));
    if (!monitor) return notFound(reply);
    return html(reply, 200, renderDeleteConfirm(monitor));
  });

  app.post('/admin/monitors/:id/delete', { preHandler: guard('manage_monitors') }, async (request, reply) => {
    const id = idOf(request);
    const monitor = id === null ? null : await store.monitor(id, scopeOf(user(request)));
    if (!monitor) return notFound(reply);
    await store.deleteMonitor(monitor.id);
    return reply.redirect(`/admin/monitors?${new URLSearchParams({ deleted: monitor.name })}`, 303);
  });

  /* ---------- Incidents (DS-p26-admin-incidents, D-038) ---------- */

  const incidentsPage = async (request: FastifyRequest, reply: FastifyReply, code: number, forms: Map<number, FormState>) => {
    const u = user(request);
    const now = clock.now();
    const org = await orgLine(u);
    try {
      const incidents = await store.incidents(scopeOf(u), now);
      return html(reply, code, renderIncidents({ incidents, org, now, forms }));
    } catch (error) {
      request.log.error(error, 'incidents could not load');
      return html(reply, 503, renderIncidents({ incidents: null, org, now, forms }));
    }
  };

  app.get<{ Querystring: { posted?: string } }>('/admin/incidents', { preHandler: guard('view') }, async (request, reply) => {
    const posted = request.query.posted;
    const forms = new Map<number, FormState>();
    if (typeof posted === 'string' && ID.test(posted)) forms.set(Number(posted), { posted: true });
    return incidentsPage(request, reply, 200, forms);
  });

  app.post('/admin/incidents/:id/updates', { preHandler: guard('write_update') }, async (request, reply) => {
    const id = idOf(request);
    const now = clock.now();
    const incident = id === null ? null : await store.incident(id, scopeOf(user(request)), now);
    if (!incident) return notFound(reply);
    const fields = fieldsOf(request);
    const typed = { stage: fields.stage, body: typeof fields.body === 'string' ? fields.body : '' };
    const parsed = parseUpdate(fields);
    if (!parsed.ok) return incidentsPage(request, reply, 400, new Map([[incident.id, { ...typed, errors: parsed.errors }]]));
    try {
      await store.addIncidentUpdate({ incidentId: incident.id, userId: user(request).id, stage: parsed.stage, body: parsed.body }, now);
    } catch (error) {
      request.log.error(error, 'incident update could not be saved');
      return incidentsPage(request, reply, 503, new Map([[incident.id, { ...typed, failed: true }]]));
    }
    return reply.redirect(`/admin/incidents?posted=${incident.id}#incident-${incident.id}`, 303);
  });
}
