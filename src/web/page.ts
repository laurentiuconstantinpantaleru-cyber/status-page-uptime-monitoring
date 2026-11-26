import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Eta } from 'eta';
import type { Status } from './status/model.js';

/** What the web pages share: the template engine, the stylesheets, the icons and the header. */

/** The placeholder product name from the confirmed mock (DS-p26-public-status). */
export const PRODUCT = 'Campus Uptime';

/** `src/web/` at the repo root; the same path from `src/web/` and `dist/web/`. */
const WEB_DIR = new URL('../../src/web/', import.meta.url);
const eta = new Eta({ views: fileURLToPath(new URL('views/', WEB_DIR)), cache: true, autoEscape: true });

/** The tokens, the shared styles and one page's own, inlined into the page: no extra request. */
export function css(pageFile: string): string {
  return ['public/tokens.css', 'public/base.css', `public/${pageFile}`]
    .map((file) => readFileSync(new URL(file, WEB_DIR), 'utf8'))
    .join('\n');
}

/* Status icons: shape and text together, never color alone (DESIGN.md). */
export const ICON_PATHS: Record<Status, string> = {
  ok: '<circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M4.5 8.2l2.3 2.3 4.7-4.8" fill="none" stroke="var(--color-bg-surface)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  degraded: '<path d="M8 1.2l7 13H1z" fill="currentColor"/><path d="M8 6v3.6M8 11.6v.1" stroke="var(--color-bg-surface)" stroke-width="1.8" stroke-linecap="round"/>',
  outage: '<rect x="1" y="1" width="14" height="14" rx="3" fill="currentColor"/><path d="M5.3 5.3l5.4 5.4M10.7 5.3l-5.4 5.4" stroke="var(--color-bg-surface)" stroke-width="1.8" stroke-linecap="round"/>',
  maint: '<circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M8 4.2v4l2.6 1.6" fill="none" stroke="var(--color-bg-surface)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  nodata: '<circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2.4 2"/>',
};
export const STATUSES = Object.keys(ICON_PATHS) as Status[];
const iconSet = (size: string) => Object.fromEntries(
  STATUSES.map((s) => [s, `<svg class="${size} s-${s}" viewBox="0 0 16 16" aria-hidden="true">${ICON_PATHS[s]}</svg>`]),
) as Record<Status, string>;
export const ICONS = {
  ...iconSet('icon'),
  logo: '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="1" y="1" width="30" height="30" rx="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6 17h5l3-7 4 12 3-5h5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  moon: '<svg class="i-moon" viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 9.8A6 6 0 016.2 2.5a6 6 0 107.3 7.3z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  sun: '<svg class="i-sun" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 1v1.8M8 13.2V15M1 8h1.8M13.2 8H15M3 3l1.3 1.3M11.7 11.7L13 13M13 3l-1.3 1.3M4.3 11.7L3 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  menu: '<svg class="i-open" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg><svg class="i-close" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
};
export const SMALL_ICONS = iconSet('icon-sm');

export interface HeaderView {
  /** Where the product name goes: the top of the page, or the status page from elsewhere. */
  brandHref: string;
  /** The "API docs" pill; the admin and login pages have none (DS-p26-admin-monitors, DS-p26-login). */
  apiDocsHref?: string;
  links: { label: string; href: string; current: boolean }[];
  /** "Login" (on the login page, the current page), or "Log out" once signed in. Default: Login. */
  account?: 'login' | 'login-current' | 'signed-in';
}

/** Renders a view from `src/web/views/` with what every page needs. */
export function render(template: string, view: Record<string, unknown>): string {
  return eta.render(template, { product: PRODUCT, icons: ICONS, smallIcons: SMALL_ICONS, ...view });
}
