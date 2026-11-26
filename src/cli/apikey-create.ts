import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { connect } from '../db/connection.js';
import { systemClock } from '../shared/clock.js';
import { hashSecret, newApiKey } from '../web/api/keys.js';
import { createApiKey, type KeyLevel } from '../web/api/store.js';

// npm run apikey:create -- --org <slug> --name <name> --level <read|write>
// Prints the key once (D-025). Only its public id and the bcrypt hash of its secret are stored.

const LEVELS: KeyLevel[] = ['read', 'write'];

export type ParsedApiKeyArgs =
  | { ok: true; key: { organizationSlug: string; name: string; level: KeyLevel } }
  | { ok: false; message: string };

export function parseApiKeyArgs(args: string[]): ParsedApiKeyArgs {
  let values: Record<string, string | undefined>;
  try {
    ({ values } = parseArgs({
      args,
      options: { org: { type: 'string' }, name: { type: 'string' }, level: { type: 'string' } },
      strict: true,
    }));
  } catch (error) {
    const option = /'(--[^']+)'/.exec((error as Error).message)?.[1] ?? 'option';
    return { ok: false, message: `Unknown option ${option}.` };
  }
  const { org, name, level } = values;
  if (!org) return { ok: false, message: 'Give --org <slug>.' };
  if (!name) return { ok: false, message: 'Give --name.' };
  if (name.length > 255) return { ok: false, message: 'Keep --name to 255 characters.' };
  if (!LEVELS.includes(level as KeyLevel)) return { ok: false, message: 'Give --level as read or write.' };
  return { ok: true, key: { organizationSlug: org, name, level: level as KeyLevel } };
}

async function main(): Promise<void> {
  const parsed = parseApiKeyArgs(process.argv.slice(2));
  if (!parsed.ok) throw new Error(parsed.message);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');

  const key = newApiKey();
  const conn = await connect(url);
  try {
    const id = await createApiKey(conn, systemClock, { ...parsed.key, publicId: key.publicId, keyHash: await hashSecret(key.secret) });
    console.log(`Created ${parsed.key.level} key ${id} (${parsed.key.name}) for ${parsed.key.organizationSlug}.`);
    console.log('This is the only time the key is shown. Store it somewhere safe:');
    console.log(key.plaintext);
  } finally {
    await conn.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error((error as Error).message);
    process.exit(1);
  });
}
