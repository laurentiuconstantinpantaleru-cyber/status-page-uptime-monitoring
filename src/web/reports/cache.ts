import type { Clock } from '../../shared/clock.js';

// Report PDFs made on demand (D-041, D-043). pdfkit renders synchronously, 30–65 ms on the web
// process that also serves the status page (D-020), so a month is rendered at most once per
// `ttlMs`, and concurrent requests for it share one render. In memory, least recently used out.

export class PdfCache {
  /** Insertion order is use order: the first key is the least recently used. */
  private readonly entries = new Map<string, { pdf: Buffer; at: number }>();
  private readonly inFlight = new Map<string, Promise<Buffer | null>>();

  constructor(
    private readonly clock: Clock,
    private readonly max: number,
    private readonly ttlMs: number,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  /** The cached PDF, else the one `make` returns; null (no such report) and failures are not kept. */
  get(key: string, make: () => Promise<Buffer | null>): Promise<Buffer | null> {
    const now = this.clock.now().getTime();
    const hit = this.entries.get(key);
    if (hit && now - hit.at < this.ttlMs) {
      this.entries.delete(key);
      this.entries.set(key, hit);
      return Promise.resolve(hit.pdf);
    }
    this.entries.delete(key);

    const pending = this.inFlight.get(key);
    if (pending) return pending;
    const run = make()
      .then((pdf) => {
        if (pdf) {
          this.entries.set(key, { pdf, at: now });
          while (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value!);
        }
        return pdf;
      })
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, run);
    return run;
  }
}
