import { createPool } from '../db/connection.js';
import { systemClock } from '../shared/clock.js';
import { mysqlAdminStore } from './admin/store.js';
import { mysqlAuthStore } from './auth/store.js';
import { loadStatusData, readStatusVersion } from './status/data.js';
import { buildApp } from './app.js';

const port = Number(process.env.PORT ?? 3000);
const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? createPool(databaseUrl) : undefined;
const app = buildApp(
  { logger: true },
  pool
    ? {
      status: { load: (now) => loadStatusData(pool, now), readVersion: () => readStatusVersion(pool) },
      admin: {
        auth: mysqlAuthStore(pool),
        store: mysqlAdminStore(pool, systemClock),
        // Behind Caddy's HTTPS in production (D-029); plain HTTP on a laptop.
        secureCookies: process.env.NODE_ENV === 'production',
      },
    }
    : {},
);
if (!pool) app.log.warn('DATABASE_URL is not set: GET /status and the admin pages are not served');
app.addHook('onClose', async () => {
  await pool?.end();
});

try {
  await app.listen({ port, host: '0.0.0.0' });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
