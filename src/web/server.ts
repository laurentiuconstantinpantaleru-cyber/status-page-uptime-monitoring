import { createPool } from '../db/connection.js';
import { loadStatusData, readStatusVersion } from './status/data.js';
import { buildApp } from './app.js';

const port = Number(process.env.PORT ?? 3000);
const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? createPool(databaseUrl) : undefined;
const app = buildApp(
  { logger: true },
  pool ? { status: { load: (now) => loadStatusData(pool, now), readVersion: () => readStatusVersion(pool) } } : {},
);
if (!pool) app.log.warn('DATABASE_URL is not set: GET /status is not served');
app.addHook('onClose', async () => {
  await pool?.end();
});

try {
  await app.listen({ port, host: '0.0.0.0' });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
