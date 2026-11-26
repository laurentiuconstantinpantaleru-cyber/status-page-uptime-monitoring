import { readFileSync } from 'node:fs';
import { css, render, type HeaderView } from '../page.js';
import { MAX_TERM, searchDocs, type DocSection } from './search.js';

const CSS = css('docs.css');

/** The sections of DS-p26-docs, in order; their text lives in `src/web/views/docs/<id>.html`. */
const SECTIONS: DocSection[] = [
  ['checks', 'Checks'],
  ['incidents', 'Incidents'],
  ['maintenance', 'Maintenance windows'],
  ['uptime', 'How uptime is calculated'],
  ['alerts', 'Alerts and escalation'],
].map(([id, title]) => ({
  id,
  title,
  html: readFileSync(new URL(`../../../src/web/views/docs/${id}.html`, import.meta.url), 'utf8'),
}));

const HEADER: HeaderView = {
  brandHref: '/status',
  apiDocsHref: '/status#api-docs',
  links: [
    { label: 'Status', href: '/status', current: false },
    { label: 'Dashboard', href: '/admin', current: false },
    { label: 'API', href: '/status#api-docs', current: false },
    { label: 'Docs', href: '/docs', current: true },
  ],
};

/** The docs page, filtered by `q` on the server (no script, D-024). */
export function renderDocsPage(q: string): string {
  const { term, sections } = searchDocs(SECTIONS, q);
  const n = sections.length;
  const countText = n === 0 ? 'No section matches' : `${n} ${n === 1 ? 'section matches' : 'sections match'}`;
  return render('docs.html', { css: CSS, header: HEADER, term, sections, countText, maxTerm: MAX_TERM });
}
