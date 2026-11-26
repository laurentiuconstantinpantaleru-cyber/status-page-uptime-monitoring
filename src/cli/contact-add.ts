import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { connect } from '../db/connection.js';
import { systemClock } from '../shared/clock.js';
import { createContact, type NewContact } from '../web/alerts/store.js';

// npm run contact:add -- --org <slug> --name <name> --channel <email|telegram> --address <address> --priority <primary|secondary>
// Primary contacts get an incident's alert at once; secondary ones when nobody acknowledges it
// within the organization's timeout (D-007, D-044). A Telegram address is the chat's numeric id.

const CHANNELS: NewContact['channel'][] = ['email', 'telegram'];
const PRIORITIES: NewContact['priority'][] = ['primary', 'secondary'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CHAT_ID = /^-?[0-9]{1,20}$/;

export type ParsedContactArgs = { ok: true; contact: NewContact } | { ok: false; message: string };

export function parseContactArgs(args: string[]): ParsedContactArgs {
  let values: Record<string, string | undefined>;
  // A Telegram group's chat id starts with "-", which parseArgs would read as an option.
  const joined = args.flatMap((arg, i) => (arg === '--address' && i + 1 < args.length ? [] : i > 0 && args[i - 1] === '--address' ? [`--address=${arg}`] : [arg]));
  try {
    ({ values } = parseArgs({
      args: joined,
      options: {
        org: { type: 'string' }, name: { type: 'string' }, channel: { type: 'string' }, address: { type: 'string' }, priority: { type: 'string' },
      },
      strict: true,
    }));
  } catch (error) {
    const option = /'(--[^']+)'/.exec((error as Error).message)?.[1] ?? 'option';
    return { ok: false, message: `Unknown option ${option}.` };
  }
  const { org, name, channel, address, priority } = values;
  if (!org) return { ok: false, message: 'Give --org <slug>.' };
  if (!name) return { ok: false, message: 'Give --name.' };
  if (name.length > 255) return { ok: false, message: 'Keep --name to 255 characters.' };
  if (!CHANNELS.includes(channel as NewContact['channel'])) return { ok: false, message: 'Give --channel as email or telegram.' };
  if (!address) return { ok: false, message: 'Give --address.' };
  if (channel === 'email' && (!EMAIL.test(address) || address.length > 255)) {
    return { ok: false, message: 'Give an email --address like name@example.test.' };
  }
  if (channel === 'telegram' && !CHAT_ID.test(address)) {
    return { ok: false, message: 'Give a Telegram --address as the numeric chat id, e.g. -1001234567890.' };
  }
  if (!PRIORITIES.includes(priority as NewContact['priority'])) return { ok: false, message: 'Give --priority as primary or secondary.' };
  return {
    ok: true,
    contact: { organizationSlug: org, name, channel: channel as NewContact['channel'], address, priority: priority as NewContact['priority'] },
  };
}

async function main(): Promise<void> {
  const parsed = parseContactArgs(process.argv.slice(2));
  if (!parsed.ok) throw new Error(parsed.message);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const conn = await connect(url);
  try {
    const id = await createContact(conn, systemClock, parsed.contact);
    console.log(`Created ${parsed.contact.priority} ${parsed.contact.channel} contact ${id} (${parsed.contact.name}) for ${parsed.contact.organizationSlug}.`);
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
