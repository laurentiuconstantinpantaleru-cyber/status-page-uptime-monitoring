import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Eta } from 'eta';
import { days, hhmm, monitorStatus, nextChange, worstOf, type Status, type StatusData } from './model.js';
import type { RenderedPage } from './cache.js';

/** The placeholder product name from the confirmed mock (DS-p26-public-status). */
export const PRODUCT = 'Campus Uptime';

/** `src/web/` at the repo root; the same path from `src/web/status/` and `dist/web/status/`. */
const WEB_DIR = new URL('../../../src/web/', import.meta.url);
const eta = new Eta({ views: fileURLToPath(new URL('views/', WEB_DIR)), cache: true, autoEscape: true });
/** Inlined into the page: no extra request, and the page is cached whole (D-020). */
const CSS = ['public/tokens.css', 'public/status.css']
  .map((file) => readFileSync(new URL(file, WEB_DIR), 'utf8'))
  .join('\n');

const LABEL: Record<Status, string> = { ok: 'Operational', degraded: 'Degraded', outage: 'Down', maint: 'Maintenance', nodata: 'No data yet' };
const DAY_LABEL: Record<Status, string> = { ...LABEL, nodata: 'No data' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const longDay = (d: Date) => `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

/* Status icons: shape and text together, never color alone (DESIGN.md). */
const ICON_PATHS: Record<Status, string> = {
  ok: '<circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M4.5 8.2l2.3 2.3 4.7-4.8" fill="none" stroke="var(--color-bg-surface)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  degraded: '<path d="M8 1.2l7 13H1z" fill="currentColor"/><path d="M8 6v3.6M8 11.6v.1" stroke="var(--color-bg-surface)" stroke-width="1.8" stroke-linecap="round"/>',
  outage: '<rect x="1" y="1" width="14" height="14" rx="3" fill="currentColor"/><path d="M5.3 5.3l5.4 5.4M10.7 5.3l-5.4 5.4" stroke="var(--color-bg-surface)" stroke-width="1.8" stroke-linecap="round"/>',
  maint: '<circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M8 4.2v4l2.6 1.6" fill="none" stroke="var(--color-bg-surface)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  nodata: '<circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2.4 2"/>',
};
const STATUSES = Object.keys(ICON_PATHS) as Status[];
const iconSet = (size: string) => Object.fromEntries(
  STATUSES.map((s) => [s, `<svg class="${size} s-${s}" viewBox="0 0 16 16" aria-hidden="true">${ICON_PATHS[s]}</svg>`]),
) as Record<Status, string>;
const ICONS = {
  ...iconSet('icon'),
  logo: '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="1" y="1" width="30" height="30" rx="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6 17h5l3-7 4 12 3-5h5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  moon: '<svg class="i-moon" viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 9.8A6 6 0 016.2 2.5a6 6 0 107.3 7.3z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  sun: '<svg class="i-sun" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 1v1.8M8 13.2V15M1 8h1.8M13.2 8H15M3 3l1.3 1.3M11.7 11.7L13 13M13 3l-1.3 1.3M4.3 11.7L3 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  menu: '<svg class="i-open" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg><svg class="i-close" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
};
const SMALL_ICONS = iconSet('icon-sm');

/** Status goes to the top, API to the badge and API section in the footer. The Dashboard,
 *  Docs and Login pages do not exist yet (DS-p26-admin-monitors, Q-016, Q-008). */
const LINKS = [
  { label: 'Status', href: '#top', current: true },
  { label: 'Dashboard', href: '/admin', current: false },
  { label: 'API', href: '#api-docs', current: false },
  { label: 'Docs', href: '/docs', current: false },
];

function listNames(names: string[]): string {
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The banner: the worst status by name, the rest as counts, in one line. */
function banner(monitors: { name: string; status: Status }[]): { worst: Status; headline: string; summary: string } {
  const worst = worstOf(monitors.map((m) => m.status));
  const named = (s: Status) => monitors.filter((m) => m.status === s).map((m) => m.name);
  if (monitors.length === 0) {
    return { worst, headline: 'No components yet', summary: 'Each component appears here after its first check.' };
  }
  if (worst === 'nodata') {
    return { worst, headline: 'No data yet', summary: 'Each component shows its status after its first check.' };
  }
  if (worst === 'ok') {
    return { worst, headline: 'All components operational', summary: 'Every component passed its last check.' };
  }
  const withData = monitors.filter((m) => m.status !== 'nodata').length;
  const headline = {
    outage: named('outage').length === withData ? 'All components are down' : 'Some components are down',
    degraded: 'Some components are slow',
    maint: 'Maintenance in progress',
  }[worst];
  const names = named(worst);
  const verb = { outage: 'down', degraded: 'slow', maint: 'in maintenance' }[worst];
  const rest: string[] = [];
  if (worst !== 'degraded' && named('degraded').length) rest.push(`${named('degraded').length} slow`);
  if (worst !== 'maint' && named('maint').length) rest.push(`${named('maint').length} in maintenance`);
  const summary = `${listNames(names)} ${names.length > 1 ? 'are' : 'is'} ${verb}${rest.length ? `; ${rest.join(', ')}` : ''}. Everything else is working.`;
  return { worst, headline, summary };
}

function page(view: Record<string, unknown>): string {
  return eta.render('status.html', { css: CSS, product: PRODUCT, icons: ICONS, smallIcons: SMALL_ICONS, links: LINKS, org: null, ...view });
}

export function renderStatusPage(data: StatusData, now: Date): RenderedPage {
  const groups = data.groups.map((group) => ({
    name: group.name,
    count: `${group.monitors.length} ${group.monitors.length === 1 ? 'component' : 'components'}`,
    monitors: group.monitors.map((monitor) => {
      const status = monitorStatus(monitor, now);
      return {
        name: monitor.name,
        status,
        label: LABEL[status],
        days: days(monitor, now).map((day, i, all) => ({
          status: day.status,
          label: DAY_LABEL[day.status],
          detail: day.detail,
          date: `${longDay(day.date)}${i === all.length - 1 ? ' (today)' : ''}`,
          /* DESIGN.md mobile breakpoint: only the last 30 days show */
          older: i < all.length - 30,
          tabindex: i === all.length - 1 ? 0 : -1,
        })),
      };
    }),
  }));
  const html = page({
    error: false,
    groups,
    legend: STATUSES.map((s) => ({ status: s, label: DAY_LABEL[s] })),
    updatedIso: now.toISOString(),
    updatedHhmm: hhmm(now),
    ...banner(groups.flatMap((g) => g.monitors)),
  });
  return { html, validUntil: nextChange(data, now) };
}

export function renderErrorPage(): string {
  return page({
    error: true,
    groups: [],
    legend: [],
    worst: 'nodata',
    headline: 'Status could not load',
    summary: 'This page could not reach the status service, so it cannot show current status, uptime or incidents. Try again in a moment.',
  });
}
