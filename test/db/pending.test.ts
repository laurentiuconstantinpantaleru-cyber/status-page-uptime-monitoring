import { describe, expect, it } from 'vitest';
import { pendingMigrations } from '../../src/db/migrate.js';

describe('pendingMigrations', () => {
  it('returns unapplied migrations in version order', () => {
    const files = ['0002_seed.sql', '0001_initial.sql', '0003_more.sql'];

    expect(pendingMigrations(files, [])).toEqual(['0001_initial.sql', '0002_seed.sql', '0003_more.sql']);
  });

  it('skips migrations already applied', () => {
    const files = ['0001_initial.sql', '0002_seed.sql', '0003_more.sql'];

    expect(pendingMigrations(files, ['0001_initial.sql', '0002_seed.sql'])).toEqual(['0003_more.sql']);
  });

  it('ignores files that are not migrations', () => {
    expect(pendingMigrations(['README.md', '0001_initial.sql', 'notes.sql'], [])).toEqual(['0001_initial.sql']);
  });

  it('rejects two migrations with the same number', () => {
    expect(() => pendingMigrations(['0001_initial.sql', '0001_other.sql'], [])).toThrow(/0001/);
  });

  it('rejects an applied migration whose file is missing', () => {
    expect(() => pendingMigrations(['0002_seed.sql'], ['0001_initial.sql'])).toThrow(/0001_initial\.sql/);
  });
});
