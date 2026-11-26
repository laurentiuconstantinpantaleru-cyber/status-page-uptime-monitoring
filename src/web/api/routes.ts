import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Clock } from '../../shared/clock.js';
import type { Status } from '../status/model.js';
import { renderBadge } from './badge.js';
import { parseBearer, verifySecret } from './keys.js';
import { parseNewMonitor } from './monitor-input.js';
import { RateLimiter } from './rate-limit.js';
import type { ApiKeyRow, ApiMonitor, ApiStore } from './store.js';

// The API under /api/v1 (D-025, D-039, C-004) and the public badge. A key, never a cookie,
// decides who is asking; its organization limits every query.

export interface ApiDeps {
  store: ApiStore;
}

const LIMIT = 60;
const WINDOW_MS = 60_000;
/** Only digits, no leading zero: anything else is a badge that does not exist. */
const BADGE_FILE = /^([1-9][0-9]{0,15})\.svg$/;

export const API_STATUS: Record<Status, string> = {
  ok: 'operational',
  degraded: 'degraded',
  outage: 'outage',
  maint: 'maintenance',
  nodata: 'no_data',
};

declare module 'fastify' {
  interface FastifyRequest {
    apiKey: ApiKeyRow | null;
  }
}

const fail = (reply: FastifyReply, code: number, error: string, message: string, extra: Record<string, unknown> = {}) =>
  reply.code(code).type('application/json; charset=utf-8').send({ error, message, ...extra });

const notJson = (reply: FastifyReply) =>
  fail(reply, 400, 'invalid_request', 'Send a JSON object with Content-Type: application/json.');

const toJson = (m: ApiMonitor) => ({ id: m.id, name: m.name, url: m.url, interval_minutes: m.intervalMinutes, status: API_STATUS[m.status] });

export function registerApiRoutes(app: FastifyInstance, deps: ApiDeps, clock: Clock): void {
  const { store } = deps;
  const limiter = new RateLimiter(clock, LIMIT, WINDOW_MS);

  app.get<{ Params: { file: string } }>('/badge/:file', async (request, reply) => {
    const match = BADGE_FILE.exec(request.params.file);
    const status = match ? await store.monitorStatus(Number(match[1]), clock.now()) : null;
    if (!status) return reply.code(404).type('text/plain; charset=utf-8').send('No monitor with this id.');
    return reply.type('image/svg+xml; charset=utf-8').header('cache-control', 'no-cache').send(renderBadge(status));
  });

  app.register(async (api) => {
    api.decorateRequest('apiKey', null);

    // onRequest: before the body is read, so a request without a valid key costs no parsing.
    api.addHook('onRequest', async (request, reply) => {
      const presented = parseBearer(request.headers.authorization);
      const key = presented ? await store.keyByPublicId(presented.publicId) : null;
      const valid = key !== null && key.revokedAt === null && (await verifySecret(presented!.secret, key.keyHash));
      if (!valid) {
        reply.header('www-authenticate', 'Bearer');
        return fail(reply, 401, 'unauthorized', 'Send a valid API key as Authorization: Bearer <public_id>.<secret>.');
      }
      const taken = limiter.take(presented!.publicId);
      if (!taken.ok) {
        const s = taken.retryAfterS;
        reply.header('retry-after', String(s));
        return fail(reply, 429, 'rate_limited',
          `This key made more than ${LIMIT} requests in the last minute. Try again in ${s} second${s === 1 ? '' : 's'}.`);
      }
      request.apiKey = key;
    });

    // A body Fastify cannot parse (broken JSON, unknown type, too large) is the client's to fix.
    api.setErrorHandler((error: FastifyError, request, reply) => {
      if (error.statusCode && error.statusCode < 500) return notJson(reply);
      request.log.error(error, 'api request failed');
      return fail(reply, 500, 'internal', 'Something went wrong on our side. Try again later.');
    });

    const key = (request: FastifyRequest) => request.apiKey!;
    const requireWrite = async (request: FastifyRequest, reply: FastifyReply) => {
      if (key(request).level !== 'write') {
        return fail(reply, 403, 'forbidden', 'This key can only read. Create a write key to change monitors.');
      }
    };

    api.get('/monitors', async (request) => ({
      monitors: (await store.monitors(key(request).organizationId, clock.now())).map(toJson),
    }));

    api.post('/monitors', { onRequest: requireWrite }, async (request, reply) => {
      if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') return notJson(reply);
      const parsed = parseNewMonitor(request.body);
      if (!parsed.ok) {
        if (parsed.errors.body) return notJson(reply);
        return fail(reply, 400, 'invalid_request', 'Some fields are wrong; see fields.', { fields: parsed.errors });
      }
      const now = clock.now();
      const id = await store.createMonitor(key(request).organizationId, parsed.monitor, now);
      const { name, url, intervalMinutes } = parsed.monitor;
      return reply.code(201).send(toJson({ id, name, url, intervalMinutes, status: 'nodata' }));
    });
  }, { prefix: '/api/v1' });
}
