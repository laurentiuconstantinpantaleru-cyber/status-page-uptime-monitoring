import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildReport, type ReportMonitorInput } from '../../src/shared/report.js';
import { renderReportPdf } from '../../src/web/reports/pdf.js';

// The PDF is made by a library, no browser (D-019). Text drawn with an embedded TrueType font is
// stored as glyph ids, so the checks read the font and its ToUnicode map, not the page text.

const NOW = new Date('2026-12-01T00:30:00.000Z');
const monitor = (name: string): ReportMonitorInput => ({
  name,
  url: `https://${name.toLowerCase().replace(/[^a-z]/g, '')}.example/`,
  historyStart: new Date('2026-10-01T00:00:00.000Z'),
  incidents: [{ startedAt: new Date('2026-11-03T00:00:00.000Z'), resolvedAt: new Date('2026-11-03T02:00:00.000Z'), cause: 'timeout' }],
  maintenance: [],
  latency: { meanMs: 350, checks: 100 },
});

/** Every stream of the file, inflated when it is compressed, joined as text. */
function streams(pdf: Buffer): string {
  const text = pdf.toString('latin1');
  const out: string[] = [];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = m.index + m[0].length;
    const end = text.indexOf('endstream', start);
    const raw = pdf.subarray(start, end);
    try {
      out.push(inflateSync(raw).toString('latin1'));
    } catch {
      out.push(raw.toString('latin1'));
    }
    re.lastIndex = end;
  }
  return out.join('\n');
}

describe('renderReportPdf (D-019)', () => {
  it('is a complete PDF with the DejaVu Sans font embedded', async () => {
    const pdf = await renderReportPdf(buildReport({ organization: 'Campus projects', year: 2026, month: 11, monitors: [monitor('Bookings API')] }, NOW));
    const text = pdf.toString('latin1');

    expect(text.startsWith('%PDF-1.')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toMatch(/\/BaseFont \/[A-Z]{6}\+DejaVuSans\b/);
    expect(text).toContain('/FontFile2');
  });

  it('maps the Romanian letters ă â î ș ț to their characters, so they show and can be copied', async () => {
    const pdf = await renderReportPdf(buildReport(
      { organization: 'Școala Țară', year: 2026, month: 11, monitors: [monitor('Bibliotecă înscrieri')] }, NOW,
    ));
    const unicode = streams(pdf).toLowerCase();

    for (const code of ['0218', '021a', '0103', '00ee']) expect(unicode).toContain(`<${code}>`);
  });

  it('fits many monitors by adding pages', async () => {
    const monitors = Array.from({ length: 80 }, (_, i) => monitor(`Monitor ${i + 1}`));
    const pdf = await renderReportPdf(buildReport({ organization: 'Big org', year: 2026, month: 11, monitors }, NOW));

    expect((pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(1);
  });
});
