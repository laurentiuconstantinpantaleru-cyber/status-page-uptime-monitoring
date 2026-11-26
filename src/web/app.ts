import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { type Clock, systemClock } from '../shared/clock.js';
import { StatusCache } from './status/cache.js';
import type { StatusData } from './status/model.js';
import { renderErrorPage, renderStatusPage } from './status/render.js';
import { renderDocsPage } from './docs/render.js';
import { registerAdminRoutes, type AdminDeps } from './admin/routes.js';
import { registerApiRoutes, type ApiDeps } from './api/routes.js';

/** Where the public status page reads from: MySQL in production, a fake in tests. */
export interface StatusSource {
  load(now: Date): Promise<StatusData>;
  readVersion(): Promise<number>;
}

export interface AppDeps {
  clock?: Clock;
  /** Without one, `GET /status` is not registered. */
  status?: StatusSource;
  /** Without them, the sign-in and admin routes are not registered. */
  admin?: AdminDeps;
  /** Without it, `/api/v1` and `/badge` are not registered. */
  api?: ApiDeps;
}

export function buildApp(options: FastifyServerOptions = {}, deps: AppDeps = {}): FastifyInstance {
  const app = Fastify(options);
  const clock = deps.clock ?? systemClock;

  app.get('/health', async () => ({ status: 'ok' }));

  /* DS-p26-docs: static text, filtered by ?q= on the server. */
  app.get<{ Querystring: { q?: string | string[] } }>('/docs', async (request, reply) => {
    const q = request.query.q;
    reply.type('text/html; charset=utf-8');
    return renderDocsPage(typeof q === 'string' ? q : '');
  });

  const source = deps.status;
  if (source) {
    const cache = new StatusCache({
      clock,
      readVersion: () => source.readVersion(),
      render: async () => {
        const now = clock.now();
        return renderStatusPage(await source.load(now), now);
      },
    });

    app.get('/status', async (request, reply) => {
      reply.type('text/html; charset=utf-8');
      try {
        return await cache.get();
      } catch (error) {
        request.log.error(error, 'status page could not load');
        reply.code(503);
        return renderErrorPage();
      }
    });
  }

  if (deps.admin) registerAdminRoutes(app, deps.admin, clock);
  if (deps.api) registerApiRoutes(app, deps.api, clock);

  return app;
}
