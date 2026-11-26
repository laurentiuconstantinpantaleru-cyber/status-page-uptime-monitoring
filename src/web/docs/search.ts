/** One section of the docs page: its anchor id, its sidebar title and its trusted HTML. */
export interface DocSection {
  id: string;
  title: string;
  html: string;
}

/** Longer search terms are cut: nobody types more, and it bounds the work per request. */
export const MAX_TERM = 100;

const escapeHtml = (text: string) =>
  text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The text a reader sees, HTML-escaped as it is in the source: tags dropped, entities kept. */
const textOf = (html: string) => html.replace(/<[^>]*>/g, '');

/** Wraps each match of `term` in the text of `html` (never inside a tag) in `<mark>`, ignoring case. */
export function highlight(html: string, term: string): string {
  const needle = new RegExp(escapeRegExp(escapeHtml(term)), 'gi');
  return html
    .split(/(<[^>]*>)/)
    .map((part) => (part.startsWith('<') ? part : part.replace(needle, (match) => `<mark>${match}</mark>`)))
    .join('');
}

/** The sections whose text contains `q`, highlighted; all of them, untouched, when `q` is blank. */
export function searchDocs(sections: DocSection[], q: string): { term: string; sections: DocSection[] } {
  const term = q.trim().slice(0, MAX_TERM);
  if (term === '') return { term: '', sections };
  const needle = escapeHtml(term).toLowerCase();
  return {
    term,
    sections: sections
      .filter((s) => textOf(s.html).toLowerCase().includes(needle))
      .map((s) => ({ ...s, html: highlight(s.html, term) })),
  };
}
