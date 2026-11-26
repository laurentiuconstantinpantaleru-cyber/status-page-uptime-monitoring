import type { Clock } from '../../shared/clock.js';

/** Q-007: how often the web process reads the status version. */
export const VERSION_POLL_MS = 30_000;

export interface RenderedPage {
  html: string;
  /** The page changes by itself at this time (UTC midnight, a maintenance boundary). */
  validUntil: Date;
}

export interface StatusCacheDeps {
  clock: Clock;
  readVersion(): Promise<number>;
  render(): Promise<RenderedPage>;
}

/**
 * The rendered status page, kept in memory (D-020). The version is read at most every
 * 30 seconds, on a request, so a status change shows within 30 seconds without a timer.
 * When the database fails after a first render, the last copy is served.
 */
export class StatusCache {
  private page: RenderedPage | null = null;
  private version: number | null = null;
  private versionReadAt = Number.NEGATIVE_INFINITY;
  private pending: Promise<string> | null = null;

  constructor(private readonly deps: StatusCacheDeps) {}

  get(): Promise<string> {
    const now = this.deps.clock.now().getTime();
    const page = this.page;
    if (page && now - this.versionReadAt < VERSION_POLL_MS && now < page.validUntil.getTime()) {
      return Promise.resolve(page.html);
    }
    this.pending ??= this.refresh(now).finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async refresh(now: number): Promise<string> {
    try {
      const version = await this.deps.readVersion();
      this.versionReadAt = now;
      if (this.page === null || version !== this.version || now >= this.page.validUntil.getTime()) {
        this.page = await this.deps.render();
        this.version = version;
      }
      return this.page.html;
    } catch (error) {
      if (this.page) return this.page.html;
      throw error;
    }
  }
}
