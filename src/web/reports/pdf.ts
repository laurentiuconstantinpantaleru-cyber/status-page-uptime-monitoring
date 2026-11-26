import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import type { Report } from '../../shared/report.js';

// The monthly report as a PDF, drawn with pdfkit: a library, no browser (D-019). The standard PDF
// fonts have no ș or ț, so DejaVu Sans is embedded (assets/fonts, Bitstream Vera licence).

/** `assets/fonts/` at the repo root; the same path from `src/web/reports/` and `dist/web/reports/`. */
const FONTS = new URL('../../../assets/fonts/', import.meta.url);
const REGULAR = fileURLToPath(new URL('DejaVuSans.ttf', FONTS));
const BOLD = fileURLToPath(new URL('DejaVuSans-Bold.ttf', FONTS));

/* Light-theme token values from tokens.css: print is light. */
const TEXT = '#0f172a'; // --color-text-primary
const SECONDARY = '#475569'; // --color-text-secondary
const BORDER = '#e2e8f0'; // --color-border

const MARGIN = 50;
const ROW_GAP = 6;
/** Monitor, uptime, incidents, downtime, mean latency; widths sum to the A4 text width (495 pt). */
const COLUMNS = [195, 70, 60, 85, 85];
const HEADINGS = ['Monitor', 'Uptime', 'Incidents', 'Downtime', 'Mean latency'];

const day = (d: Date) => `${d.getUTCDate()} ${d.toLocaleString('en', { month: 'short', timeZone: 'UTC' })} ${d.getUTCFullYear()}`;

export function renderReportPdf(report: Report): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: MARGIN,
    info: { Title: `Uptime report — ${report.organization}, ${report.title}`, CreationDate: report.generatedAt },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  doc.registerFont('regular', REGULAR);
  doc.registerFont('bold', BOLD);
  const left = MARGIN;
  const width = doc.page.width - 2 * MARGIN;
  const bottom = () => doc.page.height - MARGIN;

  const heading = (text: string) => {
    if (doc.y + 60 > bottom()) doc.addPage();
    doc.moveDown(1.2).font('bold').fontSize(13).fillColor(TEXT).text(text, left, doc.y, { width });
    doc.moveDown(0.4);
  };
  const line = (y: number) => doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.5).strokeColor(BORDER).stroke();
  const para = (text: string) => doc.font('regular').fontSize(10).fillColor(TEXT).text(text, left, doc.y, { width });

  /* ---------- Title ---------- */
  doc.font('bold').fontSize(20).fillColor(TEXT).text('Uptime report', left, MARGIN, { width });
  doc.moveDown(0.2).font('regular').fontSize(13).text(report.organization, { width });
  const last = new Date(report.to.getTime() - 1);
  doc.moveDown(0.2).fontSize(10).fillColor(SECONDARY)
    .text(`${report.title}: ${day(report.from)} to ${day(last)}, UTC. Generated ${report.generatedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC.`, { width });

  /* ---------- Uptime per monitor ---------- */
  heading('Uptime per monitor');
  if (report.monitors.length === 0) {
    para('This organization has no monitors.');
  } else {
    const headerRow = () => {
      const y = doc.y;
      let x = left;
      doc.font('bold').fontSize(9).fillColor(SECONDARY);
      HEADINGS.forEach((h, i) => {
        doc.text(h, x, y, { width: COLUMNS[i] - 6, align: i === 0 ? 'left' : 'right' });
        x += COLUMNS[i];
      });
      doc.y = y + 14;
      line(doc.y);
      doc.y += ROW_GAP;
    };
    headerRow();
    for (const m of report.monitors) {
      doc.font('bold').fontSize(10);
      const nameH = doc.heightOfString(m.name, { width: COLUMNS[0] - 6 });
      doc.font('regular').fontSize(8);
      const urlH = doc.heightOfString(m.url, { width: COLUMNS[0] - 6 });
      if (doc.y + nameH + urlH + ROW_GAP > bottom()) {
        doc.addPage();
        doc.y = MARGIN;
        headerRow();
      }
      const y = doc.y;
      doc.font('bold').fontSize(10).fillColor(TEXT).text(m.name, left, y, { width: COLUMNS[0] - 6 });
      doc.font('regular').fontSize(8).fillColor(SECONDARY).text(m.url, left, y + nameH, { width: COLUMNS[0] - 6 });
      let x = left + COLUMNS[0];
      doc.font('regular').fontSize(10).fillColor(TEXT);
      [m.uptime, String(m.incidents), m.downtime, m.meanLatency].forEach((value, i) => {
        doc.text(value, x, y, { width: COLUMNS[i + 1] - 6, align: 'right' });
        x += COLUMNS[i + 1];
      });
      doc.y = y + nameH + urlH + ROW_GAP;
      line(doc.y);
      doc.y += ROW_GAP;
    }
  }

  /* ---------- Top incident causes ---------- */
  heading('Top incident causes');
  if (report.topCauses.length === 0) {
    para('No incidents this month.');
  } else {
    report.topCauses.forEach((c, i) => {
      para(`${i + 1}. ${c.cause}: ${c.downtime} of downtime, ${c.incidents} ${c.incidents === 1 ? 'incident' : 'incidents'}`);
      doc.moveDown(0.2);
    });
  }

  /* ---------- Slowest monitor ---------- */
  heading('Slowest monitor');
  para(report.slowest
    ? `${report.slowest.name}: ${report.slowest.meanLatency} mean latency over the month's checks.`
    : 'No check got a response this month.');

  doc.moveDown(2).font('regular').fontSize(8).fillColor(SECONDARY).text(
    'Uptime counts confirmed incidents and leaves maintenance windows out. Downtime is outside maintenance. Mean latency is over scheduled checks that got a response. All times are UTC.',
    left, doc.y, { width },
  );

  doc.end();
  return done;
}
