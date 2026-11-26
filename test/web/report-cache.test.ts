import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../src/shared/clock.js';
import { PdfCache } from '../../src/web/reports/cache.js';
import { reportPdf, type ReportStore } from '../../src/web/reports/job.js';

// On-demand report PDFs (D-041, D-043): pdfkit blocks the web process for 30–65 ms per render,
// so a month is rendered once per hour at most, and concurrent requests share one render.

const NOW = new Date('2026-12-05T10:00:00.000Z');
const HOUR = 60 * 60 * 1000;

function counter(result: Buffer | null = Buffer.from('%PDF-made')) {
  const made = { n: 0 };
  const make = async () => {
    made.n += 1;
    return result;
  };
  return { made, make };
}

describe('PdfCache', () => {
  it('a second request within the hour is served without rendering; after an hour it renders again', async () => {
    const clock = new FakeClock(NOW);
    const cache = new PdfCache(clock, 50, HOUR);
    const { made, make } = counter();

    expect((await cache.get('1/2026-10', make))?.toString()).toBe('%PDF-made');
    clock.advance(HOUR - 1);
    await cache.get('1/2026-10', make);
    expect(made.n).toBe(1);

    clock.advance(1);
    await cache.get('1/2026-10', make);
    expect(made.n).toBe(2);
  });

  it('concurrent requests for the same month share one render', async () => {
    const cache = new PdfCache(new FakeClock(NOW), 50, HOUR);
    const { made, make } = counter();

    const results = await Promise.all(Array.from({ length: 5 }, () => cache.get('1/2026-10', make)));

    expect(made.n).toBe(1);
    expect(results.every((r) => r?.toString() === '%PDF-made')).toBe(true);
  });

  it('a failed render is not kept: the next request tries again', async () => {
    const cache = new PdfCache(new FakeClock(NOW), 50, HOUR);
    let calls = 0;
    const flaky = async () => {
      calls += 1;
      if (calls === 1) throw new Error('database down');
      return Buffer.from('%PDF-ok');
    };

    await expect(cache.get('1/2026-10', flaky)).rejects.toThrow('database down');
    expect((await cache.get('1/2026-10', flaky))?.toString()).toBe('%PDF-ok');
    expect(calls).toBe(2);
  });

  it('no report (an unknown organization) is not kept', async () => {
    const cache = new PdfCache(new FakeClock(NOW), 50, HOUR);
    const { made, make } = counter(null);

    expect(await cache.get('99/2026-10', make)).toBeNull();
    expect(await cache.get('99/2026-10', make)).toBeNull();
    expect(made.n).toBe(2);
  });

  it('keeps at most `max` PDFs; the least recently used goes first', async () => {
    const cache = new PdfCache(new FakeClock(NOW), 2, HOUR);
    const { made, make } = counter();

    await cache.get('a', make);
    await cache.get('b', make);
    await cache.get('a', make); // a is now the most recently used
    await cache.get('c', make); // b goes
    expect(made.n).toBe(3);
    expect(cache.size).toBe(2);

    await cache.get('a', make);
    expect(made.n).toBe(3);
    await cache.get('b', make);
    expect(made.n).toBe(4);
  });
});

describe('reportPdf with the cache', () => {
  const store = (stored: Buffer | null) => {
    const loads: number[] = [];
    const s = {
      loads,
      async storedReport() {
        return stored;
      },
      async loadMonth(orgId: number, year: number, month: number) {
        loads.push(orgId);
        return { organization: 'Campus projects', year, month, monitors: [] };
      },
    } as unknown as ReportStore & { loads: number[] };
    return s;
  };

  it('a stored report is served as stored and not cached', async () => {
    const cache = new PdfCache(new FakeClock(NOW), 50, HOUR);
    const s = store(Buffer.from('%PDF-stored'));

    expect((await reportPdf(s, 1, 2026, 10, NOW, cache))?.toString()).toBe('%PDF-stored');
    expect(cache.size).toBe(0);
    expect(s.loads).toEqual([]);
  });

  it('a month made on demand is loaded and rendered once for two downloads', async () => {
    const cache = new PdfCache(new FakeClock(NOW), 50, HOUR);
    const s = store(null);

    const [a, b] = await Promise.all([reportPdf(s, 1, 2026, 10, NOW, cache), reportPdf(s, 1, 2026, 10, NOW, cache)]);
    await reportPdf(s, 1, 2026, 10, NOW, cache);

    expect(a?.subarray(0, 5).toString()).toBe('%PDF-');
    expect(b?.equals(a!)).toBe(true);
    expect(s.loads).toEqual([1]);
  });
});
