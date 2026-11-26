import { ICON_PATHS } from '../page.js';
import type { Status } from '../status/model.js';

// The status badge (DS-p26-api-docs `.shield`): a dark "status" key, then the icon and label.
// An SVG shown through <img> gets no CSS from the page that embeds it, so the light-theme token
// values from tokens.css are written in here; the label carries the meaning, not the color alone.

const TOKENS = {
  bgSurface: '#ffffff', // --color-bg-surface
  borderStrong: '#64748b', // --color-border-strong
  textPrimary: '#0f172a', // --color-text-primary
  textSecondary: '#475569', // --color-text-secondary
};

const STATUS_COLOR: Record<Status, string> = {
  ok: '#059669', // --color-status-ok
  degraded: '#d97706', // --color-status-degraded
  outage: '#dc2626', // --color-status-outage
  maint: '#7c3aed', // --color-status-maint
  nodata: '#64748b', // --color-status-nodata
};

export const BADGE_LABEL: Record<Status, string> = {
  ok: 'operational',
  degraded: 'degraded',
  outage: 'outage',
  maint: 'maintenance',
  nodata: 'no data',
};

const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;
/** An SVG cannot measure its text: 12px semibold averages about 7px a character. */
const CHAR_W = 7;
const PAD = 8; // --space-2
const ICON = 12; // --space-3
const GAP = 4; // --space-1
const H = 20;

export function renderBadge(status: Status): string {
  const label = BADGE_LABEL[status];
  const keyW = PAD + 'status'.length * CHAR_W + PAD;
  const valueW = PAD + ICON + GAP + label.length * CHAR_W + PAD;
  const w = keyW + valueW;
  const icon = ICON_PATHS[status].replaceAll('var(--color-bg-surface)', TOKENS.bgSurface);
  const name = `Status: ${label}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${H}" viewBox="0 0 ${w} ${H}" role="img" aria-label="${name}">`
    + `<title>${name}</title>`
    + `<clipPath id="r"><rect width="${w}" height="${H}" rx="3"/></clipPath>`
    + `<g clip-path="url(#r)"><rect width="${keyW}" height="${H}" fill="${TOKENS.textSecondary}"/>`
    + `<rect x="${keyW}" width="${valueW}" height="${H}" fill="${TOKENS.bgSurface}"/></g>`
    + `<rect x="0.5" y="0.5" width="${w - 1}" height="${H - 1}" rx="2.5" fill="none" stroke="${TOKENS.borderStrong}"/>`
    + `<g font-family="${FONT}" font-size="12" font-weight="600">`
    + `<text x="${PAD}" y="14" fill="${TOKENS.bgSurface}">status</text>`
    + `<svg x="${keyW + PAD}" y="${(H - ICON) / 2}" width="${ICON}" height="${ICON}" viewBox="0 0 16 16" color="${STATUS_COLOR[status]}">${icon}</svg>`
    + `<text x="${keyW + PAD + ICON + GAP}" y="14" fill="${TOKENS.textPrimary}">${label}</text>`
    + '</g></svg>';
}
