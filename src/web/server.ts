import { createPool } from '../db/connection.js';
import { systemClock } from '../shared/clock.js';
import { mysqlAdminStore } from './admin/store.js';
import { mysqlApiStore } from './api/store.js';
import { reportPdf, startMonthlyReports } from './reports/job.js';
import { mailerFromEnv } from './reports/mailer.js';
import { mysqlReportStore } from './reports/store.js';
import { mysqlAuthStore } from './auth/store.js';
import { loadStatusData, readStatusVersion } from './status/data.js';
import { buildApp } from './app.js';

const port = Number(process.env.PORT ?? 3000);
const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? createPool(databaseUrl) : undefined;
const reportStore = pool ? mysqlReportStore(pool) : undefined;
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
        reports: { pdf: (orgId, year, month, now) => reportPdf(reportStore!, orgId, year, month, now) },
      },
      api: { store: mysqlApiStore(pool, systemClock) },
    }
    : {},
);
if (!pool) app.log.warn('DATABASE_URL is not set: GET /status, the admin pages and the API are not served');

// Monthly reports (D-019, D-041): made in this process, the only web process (D-029).
let stopReports = () => {};
if (reportStore) {
  const { mailer, missing } = mailerFromEnv(process.env);
  if (!mailer) app.log.warn(`${missing.join(' and ')} not set: monthly reports are stored but not emailed`);
  stopReports = startMonthlyReports({
    clock: systemClock,
    store: reportStore,
    mailer,
    log: (message, error) => app.log.error(error, message),
  });
}

app.addHook('onClose', async () => {
  stopReports();
  await pool?.end();
});

try {
  await app.listen({ port, host: '0.0.0.0' });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
