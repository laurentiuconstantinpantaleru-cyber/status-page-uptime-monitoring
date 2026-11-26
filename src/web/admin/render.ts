import { css, render, type HeaderView } from '../page.js';
import { duration, hhmm } from '../status/model.js';
import { LABEL, incidentTitle, longDay, stageLabel, timeline, utcTime } from '../status/render.js';
import type { UpdateErrors } from './incidents.js';
import { STAGES } from './incidents.js';
import { monthTitle } from '../../shared/report.js';
import { nextFirst, reportMonths, type ReportOrg } from '../reports/months.js';
import type { AdminGroup, AdminIncident } from './store.js';

// The sign-in and admin pages (DS-p26-login, DS-p26-admin-monitors, DS-p26-admin-incidents, DS-p26-admin-reports).
// Eta escapes every value (autoEscape), so names, URLs and update texts stay text (XSS).

const ADMIN_CSS = css('admin.css');
const LOGIN_CSS = css('login.css');

/** `admin`: the user may download reports (D-042), so Reports is linked; members never see it. */
function adminHeader(current: 'monitors' | 'incidents' | 'reports', admin: boolean): HeaderView {
  return {
    brandHref: '/status',
    links: [
      { label: 'Status', href: '/status', current: false },
      { label: 'Dashboard', href: '/admin/monitors', current: current === 'monitors' },
      { label: 'Incidents', href: '/admin/incidents', current: current === 'incidents' },
      ...(admin ? [{ label: 'Reports', href: '/admin/reports', current: current === 'reports' }] : []),
      { label: 'API', href: '/status#api-docs', current: false },
      { label: 'Docs', href: '/docs', current: false },
    ],
    account: 'signed-in',
  };
}

const LOGIN_HEADER: HeaderView = {
  brandHref: '/status',
  links: [
    { label: 'Status', href: '/status', current: false },
    { label: 'Dashboard', href: '/admin/monitors', current: false },
    { label: 'API', href: '/status#api-docs', current: false },
    { label: 'Docs', href: '/docs', current: false },
  ],
  account: 'login-current',
};

export interface LoginView {
  email: string;
  errors: { email?: string; password?: string };
  wrong: boolean;
}

export function renderLogin(view: LoginView): string {
  return render('login.html', { css: LOGIN_CSS, header: LOGIN_HEADER, title: 'Log in', ...view });
}

export interface MonitorsView {
  groups: AdminGroup[] | null;
  /** The organization line above the heading: its name, or "All organizations". */
  org: string;
  everyOrg: boolean;
  admin: boolean;
  notice: string | null;
}

export function renderMonitors(view: MonitorsView): string {
  const groups = (view.groups ?? []).map((g) => ({
    organization: g.organization,
    monitors: g.monitors.map((m) => ({
      id: m.id,
      name: m.name,
      url: m.url,
      status: m.status,
      label: LABEL[m.status],
      interval: m.intervalMinutes,
      last: m.lastCheck ? { time: hhmm(m.lastCheck.checkedAt), latency: m.lastCheck.latencyMs } : null,
    })),
  }));
  return render('admin/monitors.html', {
    css: ADMIN_CSS,
    header: adminHeader('monitors', view.admin),
    title: 'Monitors',
    org: view.org,
    error: view.groups === null,
    groups,
    showGroups: view.everyOrg,
    admin: view.admin,
    notice: view.notice,
  });
}

/** Only org and global admins reach this page, so Reports is linked. */
export function renderDeleteConfirm(monitor: { id: number; name: string }): string {
  return render('admin/monitor-delete.html', { css: ADMIN_CSS, header: adminHeader('monitors', true), title: 'Delete monitor', monitor });
}

/** What one incident's form shows: what was typed, its errors, or that it was posted. */
export interface FormState {
  stage?: string;
  body?: string;
  errors?: UpdateErrors;
  failed?: boolean;
  posted?: boolean;
}

export interface IncidentsView {
  incidents: AdminIncident[] | null;
  org: string;
  now: Date;
  forms: Map<number, FormState>;
  admin: boolean;
}

export function renderIncidents(view: IncidentsView): string {
  const { now } = view;
  const form = (id: number) => {
    const f = view.forms.get(id) ?? {};
    return {
      stage: f.stage ?? null,
      body: f.body ?? '',
      errors: f.errors ?? {},
      failed: f.failed ?? false,
      posted: f.posted ?? false,
      open: Boolean(view.forms.get(id)),
    };
  };
  const all = view.incidents ?? [];
  const open = all.filter((i) => i.resolvedAt === null).map((i) => ({
    id: i.id,
    title: incidentTitle(i.monitor, i),
    stage: i.updates.length ? stageLabel(i.updates[0].stage) : null,
    started: utcTime(i.startedAt, now).text,
    downFor: duration(now.getTime() - i.startedAt.getTime()),
    updates: timeline(i.updates, now),
    form: form(i.id),
  }));
  const past = all.filter((i) => i.resolvedAt !== null).map((i) => ({
    id: i.id,
    title: incidentTitle(i.monitor, i),
    day: longDay(i.startedAt),
    lasted: duration(i.resolvedAt!.getTime() - i.startedAt.getTime()),
    updates: timeline(i.updates, now),
    form: form(i.id),
  }));
  return render('admin/incidents.html', {
    css: ADMIN_CSS,
    header: adminHeader('incidents', view.admin),
    title: 'Incidents',
    org: view.org,
    error: view.incidents === null,
    open,
    past,
    stages: STAGES.map((s) => ({ value: s, label: stageLabel(s) })),
  });
}

export interface ReportsView {
  /** Null when they could not load. */
  orgs: ReportOrg[] | null;
  org: string;
  everyOrg: boolean;
  now: Date;
}

/** Months shown at once; the older ones are folded under a <details>. */
const RECENT_MONTHS = 12;
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* DS-p26-admin-reports (D-041): how each closed month's report was sent, and its download. */
export function renderReports(view: ReportsView): string {
  const sent = (state: ReturnType<typeof reportMonths>[number]['state']) => {
    switch (state.kind) {
      case 'emailed': {
        const d = state.at;
        const who = `${state.to} org admin${state.to === 1 ? '' : 's'}`;
        return { icon: 'ok', text: `Emailed to ${who} on ${d.getUTCDate()} ${SHORT_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hhmm(d)} UTC.` };
      }
      case 'failed':
        return { icon: 'degraded', text: 'Not emailed yet: the mail server did not take it. It is tried again every hour.' };
      case 'waiting':
        return { icon: 'degraded', text: 'Not emailed yet. It is tried again every hour.' };
      default:
        return { icon: 'nodata', text: 'Made when you download it. Months before reports existed were not emailed.' };
    }
  };
  const first = nextFirst(view.now);
  const orgs = (view.orgs ?? []).map((o) => {
    const months = reportMonths(o, view.now).map((m) => ({ title: m.title, href: m.href, ...sent(m.state) }));
    return { name: o.name, recent: months.slice(0, RECENT_MONTHS), older: months.slice(RECENT_MONTHS) };
  });
  return render('admin/reports.html', {
    css: ADMIN_CSS,
    header: adminHeader('reports', true),
    title: 'Monthly reports',
    org: view.org,
    error: view.orgs === null,
    orgs,
    showOrgs: view.everyOrg,
    firstReport: `1 ${monthTitle(first.getUTCFullYear(), first.getUTCMonth() + 1)}`,
  });
}
