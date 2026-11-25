import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { type Clock, systemClock } from '../shared/clock.js';
import { connect } from './connection.js';

/** `db/migrations/` at the repo root; the same path from `src/db/` and `dist/db/`. */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../../db/migrations/', import.meta.url));

const MIGRATION_FILE = /^(\d{4})_[a-z0-9_]+\.sql$/;

/** Migration files not applied yet, in version order (D-021). */
export function pendingMigrations(files: string[], applied: string[]): string[] {
  const migrations = files.filter((file) => MIGRATION_FILE.test(file)).sort();

  const seen = new Map<string, string>();
  for (const file of migrations) {
    const version = file.slice(0, 4);
    const other = seen.get(version);
    if (other) {
      throw new Error(`Two migrations share number ${version}: ${other}, ${file}`);
    }
    seen.set(version, file);
  }

  const missing = applied.filter((file) => !migrations.includes(file));
  if (missing.length > 0) {
    throw new Error(`Applied migrations have no file: ${missing.join(', ')}`);
  }

  return migrations.filter((file) => !applied.includes(file));
}

/**
 * Applies pending migrations in order, forward only, and returns their names.
 * MySQL commits DDL implicitly, so a migration that fails halfway is not rolled back.
 * The connection must allow multiple statements.
 */
export async function migrate(conn: Connection, dir: string, clock: Clock): Promise<string[]> {
  await conn.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version VARCHAR(255) NOT NULL PRIMARY KEY,
       applied_at DATETIME(3) NOT NULL
     ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci`,
  );
  const [rows] = await conn.query<RowDataPacket[]>('SELECT version FROM schema_migrations');
  const pending = pendingMigrations(
    await readdir(dir),
    rows.map((row) => row.version as string),
  );

  for (const file of pending) {
    await conn.query(await readFile(join(dir, file), 'utf8'));
    await conn.query('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [file, clock.now()]);
  }
  return pending;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set');
  }
  const conn = await connect(url, { multipleStatements: true });
  try {
    const applied = await migrate(conn, MIGRATIONS_DIR, systemClock);
    console.log(applied.length > 0 ? `Applied: ${applied.join(', ')}` : 'No pending migrations.');
  } finally {
    await conn.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
