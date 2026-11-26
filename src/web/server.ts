import { createPool } from '../db/connection.js';
import { systemClock } from '../shared/clock.js';
import { mysqlAdminStore } from './admin/store.js';
import { startAlerts } from './alerts/dispatcher.js';
import { mysqlAlertStore } from './alerts/store.js';
import { telegramClient } from './alerts/telegram.js';
import { mysqlApiStore } from './api/store.js';
import { PdfCache } from './reports/cache.js';
import { reportPdf, startMonthlyReports } from './reports/job.js';
import { mailerFromEnv } from './mail.js';
import { mysqlReportStore } from './reports/store.js';
import { mysqlAuthStore } from './auth/store.js';
import { loadStatusData, readStatusVersion } from './status/data.js';
import { buildApp } from './app.js';

const port = Number(process.env.PORT ?? 3000);
const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? createPool(databaseUrl) : undefined;
const reportStore = pool ? mysqlReportStore(pool) : undefined;
// On-demand report PDFs: 50 at most, an hour each (D-043).
const pdfCache = new PdfCache(systemClock, 50, 60 * 60 * 1000);
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
        reports: {
          list: (orgId) => reportStore!.list(orgId),
          pdf: (orgId, year, month, now) => reportPdf(reportStore!, orgId, year, month, now, pdfCache),
        },
      },
      api: { store: mysqlApiStore(pool, systemClock) },
    }
    : {},
);
if (!pool) app.log.warn('DATABASE_URL is not set: GET /status, the admin pages and the API are not served');

// Monthly reports (D-019, D-041) and alerts (D-007, D-044): run in this process, the only web
// process (D-029). Without SMTP or a Telegram token, that channel waits.
let stopReports = () => {};
let stopAlerts = () => {};
if (reportStore && pool) {
  const { mailer, missing } = mailerFromEnv(process.env);
  if (!mailer) app.log.warn(`${missing.join(' and ')} not set: monthly reports are stored but not emailed, and email alerts wait`);
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) app.log.warn('TELEGRAM_BOT_TOKEN not set: Telegram alerts wait');
  const publicUrl = process.env.PUBLIC_URL || null;
  if (!publicUrl) app.log.warn('PUBLIC_URL not set: alerts have no acknowledge link');
  stopAlerts = startAlerts({
    clock: systemClock,
    store: mysqlAlertStore(pool),
    mailer,
    telegram: token ? telegramClient(token) : null,
    publicUrl,
    log: (message, fields) => app.log.error(fields, message),
  });
  stopReports = startMonthlyReports({
    clock: systemClock,
    store: reportStore,
    mailer,
    log: (message, error) => app.log.error(error, message),
  });
}

app.addHook('onClose', async () => {
  stopReports();
  stopAlerts();
  await pool?.end();
});

try {
  await app.listen({ port, host: '0.0.0.0' });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
