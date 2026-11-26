import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { connect } from '../db/connection.js';
import { systemClock } from '../shared/clock.js';
import type { Role } from '../web/auth/access.js';
import { hashPassword, passwordProblem } from '../web/auth/password.js';
import { createUser, type NewUser } from '../web/auth/store.js';

// npm run user:create -- --email <email> --name <name> --role <member|org_admin|global_admin> [--org <slug>]
// The password is read from stdin (D-034): typed without echo, or piped. It never goes in the arguments.

const ROLES: Role[] = ['member', 'org_admin', 'global_admin'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ParsedUserArgs = { ok: true; user: Omit<NewUser, 'passwordHash'> } | { ok: false; message: string };

export function parseUserArgs(args: string[]): ParsedUserArgs {
  let values: Record<string, string | undefined>;
  try {
    ({ values } = parseArgs({
      args,
      options: { email: { type: 'string' }, name: { type: 'string' }, role: { type: 'string' }, org: { type: 'string' } },
      strict: true,
    }));
  } catch (error) {
    const option = /'(--[^']+)'/.exec((error as Error).message)?.[1] ?? 'option';
    return { ok: false, message: `Unknown option ${option}. The password is read from stdin.` };
  }
  const { email, name, role, org } = values;
  if (!email) return { ok: false, message: 'Give --email.' };
  if (!EMAIL.test(email) || email.length > 255) return { ok: false, message: 'Give --email as an address like name@example.test.' };
  if (!name) return { ok: false, message: 'Give --name.' };
  if (!ROLES.includes(role as Role)) return { ok: false, message: 'Give --role as member, org_admin or global_admin.' };
  if (role === 'global_admin' && org) return { ok: false, message: 'A global_admin belongs to no organization: leave out --org.' };
  if (role !== 'global_admin' && !org) return { ok: false, message: 'A member or org_admin needs --org <slug>.' };
  return { ok: true, user: { email, displayName: name, role: role as Role, organizationSlug: org ?? null } };
}

/** One line from stdin; on a terminal the typed characters are not shown. */
function readPassword(): Promise<string> {
  return new Promise((resolve) => {
    const tty = process.stdin.isTTY;
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: tty });
    if (tty) {
      process.stdout.write('Password: ');
      // Echo nothing while the password is typed.
      (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => {};
    }
    rl.once('line', (line) => {
      // Resolve before close(): close() runs the 'close' listener at once.
      resolve(line);
      if (tty) process.stdout.write('\n');
      rl.close();
    });
    rl.once('close', () => resolve(''));
  });
}

async function main(): Promise<void> {
  const parsed = parseUserArgs(process.argv.slice(2));
  if (!parsed.ok) throw new Error(parsed.message);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');

  const password = await readPassword();
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);

  const conn = await connect(url);
  try {
    const id = await createUser(conn, systemClock, { ...parsed.user, passwordHash: await hashPassword(password) });
    console.log(`Created user ${id} (${parsed.user.email}, ${parsed.user.role}).`);
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
