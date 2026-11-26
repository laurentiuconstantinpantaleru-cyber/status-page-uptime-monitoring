import { describe, expect, it } from 'vitest';
import { highlight, searchDocs, type DocSection } from '../../src/web/docs/search.js';

const SECTIONS: DocSection[] = [
  { id: 'checks', title: 'Checks', html: '<h2>Checks</h2><p>The <code>TLS</code> certificate is read for HTTPS monitors.</p>' },
  { id: 'alerts', title: 'Alerts and escalation', html: '<h2>Alerts and escalation</h2><p class="escalation-note">Escalation after 15 minutes.</p>' },
];

describe('searchDocs', () => {
  it('returns every section unchanged without a term', () => {
    expect(searchDocs(SECTIONS, '')).toEqual({ term: '', sections: SECTIONS });
    expect(searchDocs(SECTIONS, '   ').sections).toEqual(SECTIONS);
  });

  it('keeps only the sections whose text matches, ignoring case', () => {
    const result = searchDocs(SECTIONS, 'tls');

    expect(result.term).toBe('tls');
    expect(result.sections.map((s) => s.id)).toEqual(['checks']);
  });

  it('matches text, not tag names or attributes', () => {
    expect(searchDocs(SECTIONS, 'code').sections).toEqual([]);
    expect(searchDocs(SECTIONS, 'escalation-note').sections).toEqual([]);
  });

  it('finds nothing for a term that is in no section', () => {
    expect(searchDocs(SECTIONS, 'kubernetes').sections).toEqual([]);
  });
});

describe('highlight', () => {
  it('wraps every match in the text in <mark>, keeping its case', () => {
    expect(highlight('<p>Escalation and escalation</p>', 'escalation')).toBe('<p><mark>Escalation</mark> and <mark>escalation</mark></p>');
  });

  it('leaves tags and attributes alone', () => {
    expect(highlight('<p class="escalation-note">Escalation</p>', 'escalation')).toBe('<p class="escalation-note"><mark>Escalation</mark></p>');
  });

  it('matches a term with HTML characters against the escaped text', () => {
    expect(highlight('<p>a &lt;b&gt; c</p>', '<b>')).toBe('<p>a <mark>&lt;b&gt;</mark> c</p>');
  });
});
