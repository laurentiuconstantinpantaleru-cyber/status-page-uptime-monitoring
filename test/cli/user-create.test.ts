import { describe, expect, it } from 'vitest';
import { parseUserArgs } from '../../src/cli/user-create.js';

describe('npm run user:create (D-034)', () => {
  it('reads email, name, role and organization from the arguments', () => {
    expect(parseUserArgs(['--email', 'mara@a.test', '--name', 'Mara Member', '--role', 'member', '--org', 'campus'])).toEqual({
      ok: true, user: { email: 'mara@a.test', displayName: 'Mara Member', role: 'member', organizationSlug: 'campus' },
    });
    expect(parseUserArgs(['--email', 'g@ops.test', '--name', 'Gabi', '--role', 'global_admin'])).toEqual({
      ok: true, user: { email: 'g@ops.test', displayName: 'Gabi', role: 'global_admin', organizationSlug: null },
    });
  });

  it.each([
    [['--name', 'X', '--role', 'member', '--org', 'a'], 'Give --email.'],
    [['--email', 'not-an-email', '--name', 'X', '--role', 'member', '--org', 'a'], 'Give --email as an address like name@example.test.'],
    [['--email', 'x@a.test', '--role', 'member', '--org', 'a'], 'Give --name.'],
    [['--email', 'x@a.test', '--name', 'X', '--role', 'owner', '--org', 'a'], 'Give --role as member, org_admin or global_admin.'],
    [['--email', 'x@a.test', '--name', 'X', '--role', 'member'], 'A member or org_admin needs --org <slug>.'],
    [['--email', 'x@a.test', '--name', 'X', '--role', 'global_admin', '--org', 'a'], 'A global_admin belongs to no organization: leave out --org.'],
    [['--email', 'x@a.test', '--name', 'X', '--role', 'member', '--org', 'a', '--password', 'secret'], 'Unknown option --password. The password is read from stdin.'],
  ])('refuses %j', (args, message) => {
    expect(parseUserArgs(args)).toEqual({ ok: false, message });
  });
});
