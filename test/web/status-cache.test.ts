import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../src/shared/clock.js';
import { StatusCache } from '../../src/web/status/cache.js';

const START = new Date('2026-11-26T14:55:00.000Z');
const FAR = new Date('2026-12-31T00:00:00.000Z');

function setup(validUntil: Date = FAR) {
  const clock = new FakeClock(START);
  let version = 1;
  let renders = 0;
  let versionReads = 0;
  const cache = new StatusCache({
    clock,
    readVersion: async () => {
      versionReads += 1;
      return version;
    },
    render: async () => {
      renders += 1;
      return { html: `page ${renders}`, validUntil };
    },
  });
  return {
    clock,
    cache,
    bump: () => { version += 1; },
    counts: () => ({ renders, versionReads }),
  };
}

describe('StatusCache', () => {
  it('renders once and serves the copy without reading the version for 30 seconds (Q-007)', async () => {
    const { clock, cache, counts } = setup();

    expect(await cache.get()).toBe('page 1');
    clock.advance(29_999);
    expect(await cache.get()).toBe('page 1');

    expect(counts()).toEqual({ renders: 1, versionReads: 1 });
  });

  it('reads the version again after 30 seconds and keeps the copy when it did not change', async () => {
    const { clock, cache, counts } = setup();

    await cache.get();
    clock.advance(30_000);

    expect(await cache.get()).toBe('page 1');
    expect(counts()).toEqual({ renders: 1, versionReads: 2 });
  });

  it('renders again within 30 seconds of a version change', async () => {
    const { clock, cache, bump } = setup();

    await cache.get();
    bump();
    clock.advance(10_000);
    expect(await cache.get()).toBe('page 1');
    clock.advance(20_000);

    expect(await cache.get()).toBe('page 2');
  });

  it('renders again once the page is past its valid-until time (midnight, maintenance boundary)', async () => {
    const { clock, cache } = setup(new Date(START.getTime() + 5_000));

    await cache.get();
    clock.advance(5_000);

    expect(await cache.get()).toBe('page 2');
  });

  it('serves the old copy when the database fails after the first render', async () => {
    const clock = new FakeClock(START);
    let fail = false;
    const cache = new StatusCache({
      clock,
      readVersion: async () => {
        if (fail) throw new Error('connection lost');
        return 1;
      },
      render: async () => ({ html: 'page', validUntil: FAR }),
    });

    await cache.get();
    fail = true;
    clock.advance(30_000);

    expect(await cache.get()).toBe('page');
  });

  it('rejects when the database fails before any copy exists', async () => {
    const cache = new StatusCache({
      clock: new FakeClock(START),
      readVersion: async () => { throw new Error('connection refused'); },
      render: async () => ({ html: 'page', validUntil: FAR }),
    });

    await expect(cache.get()).rejects.toThrow('connection refused');
  });

  it('shares one render between requests that arrive together', async () => {
    const { cache, counts } = setup();

    const pages = await Promise.all([cache.get(), cache.get(), cache.get()]);

    expect(pages).toEqual(['page 1', 'page 1', 'page 1']);
    expect(counts().renders).toBe(1);
  });
});
