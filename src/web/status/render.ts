import {
  days, duration, hhmm, monitorStatus, monitorUptime, nextChange, pastIncidents, startOfUtcDay, worstOf,
  type IncidentUpdate, type Period, type Status, type StatusData,
} from './model.js';
import type { RenderedPage } from './cache.js';
import { STATUSES, css, render, type HeaderView } from '../page.js';

const CSS = css('status.css');
export const LABEL: Record<Status, string> = { ok: 'Operational', degraded: 'Degraded', outage: 'Down', maint: 'Maintenance', nodata: 'No data yet' };
const DAY_LABEL: Record<Status, string> = { ...LABEL, nodata: 'No data' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const longDay = (d: Date) => `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

/** An incident has no written title, so it is named after its monitor and the cause it opened with. */
const CAUSE_PHRASE: Record<string, string> = {
  timeout: 'timed out',
  http_5xx: 'returned server errors',
  unexpected_status: 'returned an unexpected status',
  keyword_missing: 'is missing its expected text',
  dns: 'could not be found in DNS',
  tls: 'has a TLS certificate problem',
  connection: 'could not be reached',
};
export const incidentTitle = (monitor: string, incident: Period) => `${monitor} ${CAUSE_PHRASE[incident.cause ?? ''] ?? 'is down'}`;
export const stageLabel = (stage: IncidentUpdate['stage']) => stage[0].toUpperCase() + stage.slice(1);

/** A time in UTC, with the day when it is not on the day of `today`. */
export function utcTime(at: Date, today: Date): { iso: string; text: string } {
  const sameDay = startOfUtcDay(at).getTime() === startOfUtcDay(today).getTime();
  return { iso: at.toISOString(), text: `${sameDay ? '' : `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} `}${hhmm(at)} UTC` };
}

export function timeline(updates: IncidentUpdate[], today: Date) {
  return updates.map((u) => ({ stage: stageLabel(u.stage), body: u.body, time: utcTime(u.createdAt, today) }));
}

/** Status goes to the top, API to the badge and API section in the footer. */
const HEADER: HeaderView = {
  brandHref: '#top',
  apiDocsHref: '#api-docs',
  links: [
    { label: 'Status', href: '#top', current: true },
    { label: 'Dashboard', href: '/admin', current: false },
    { label: 'API', href: '#api-docs', current: false },
    { label: 'Docs', href: '/docs', current: false },
  ],
};

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
  return render('status.html', { css: CSS, header: HEADER, org: null, ...view });
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
        uptime90: monitorUptime(monitor, now, 90),
        uptime30: monitorUptime(monitor, now, 30),
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
  const active = data.groups.flatMap((g) => g.monitors.flatMap((m) =>
    m.incidents.filter((i) => i.resolvedAt === null).map((i) => {
      const updates = i.updates ?? [];
      return {
        title: incidentTitle(m.name, i),
        affects: m.name,
        stage: updates.length ? stageLabel(updates[0].stage) : null,
        started: utcTime(i.startedAt, now),
        downFor: duration(now.getTime() - i.startedAt.getTime()),
        updates: timeline(updates, now),
      };
    })));
  const past = pastIncidents(data, now).map((day) => ({
    iso: day.date.toISOString().slice(0, 10),
    label: longDay(day.date),
    items: day.items.map(({ monitor, incident }) => {
      const updates = incident.updates ?? [];
      return {
        title: incidentTitle(monitor, incident),
        affects: monitor,
        lasted: duration(incident.resolvedAt!.getTime() - incident.startedAt.getTime()),
        summary: updates[0]?.body ?? null,
        updates: timeline(updates, day.date),
      };
    }),
  }));
  const html = page({
    error: false,
    groups,
    active,
    past,
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
    active: [],
    past: [],
    legend: [],
    worst: 'nodata',
    headline: 'Status could not load',
    summary: 'This page could not reach the status service, so it cannot show current status, uptime or incidents. Try again in a moment.',
  });
}
