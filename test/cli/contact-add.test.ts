import { describe, expect, it } from 'vitest';
import { parseContactArgs } from '../../src/cli/contact-add.js';

describe('npm run contact:add (D-007, D-044)', () => {
  it('reads an email contact and a Telegram chat', () => {
    expect(parseContactArgs(['--org', 'campus', '--name', 'Ana', '--channel', 'email', '--address', 'ana@a.test', '--priority', 'primary'])).toEqual({
      ok: true, contact: { organizationSlug: 'campus', name: 'Ana', channel: 'email', address: 'ana@a.test', priority: 'primary' },
    });
    expect(parseContactArgs(['--org', 'campus', '--name', 'Ops', '--channel', 'telegram', '--address', '-1001234567890', '--priority', 'secondary'])).toEqual({
      ok: true, contact: { organizationSlug: 'campus', name: 'Ops', channel: 'telegram', address: '-1001234567890', priority: 'secondary' },
    });
  });

  it.each([
    [['--name', 'A', '--channel', 'email', '--address', 'a@a.test', '--priority', 'primary'], 'Give --org <slug>.'],
    [['--org', 'a', '--channel', 'email', '--address', 'a@a.test', '--priority', 'primary'], 'Give --name.'],
    [['--org', 'a', '--name', 'x'.repeat(256), '--channel', 'email', '--address', 'a@a.test', '--priority', 'primary'], 'Keep --name to 255 characters.'],
    [['--org', 'a', '--name', 'A', '--channel', 'sms', '--address', 'a@a.test', '--priority', 'primary'], 'Give --channel as email or telegram.'],
    [['--org', 'a', '--name', 'A', '--channel', 'email', '--priority', 'primary'], 'Give --address.'],
    [['--org', 'a', '--name', 'A', '--channel', 'email', '--address', 'not-an-email', '--priority', 'primary'], 'Give an email --address like name@example.test.'],
    [['--org', 'a', '--name', 'A', '--channel', 'telegram', '--address', '@mychannel', '--priority', 'primary'], 'Give a Telegram --address as the numeric chat id, e.g. -1001234567890.'],
    [['--org', 'a', '--name', 'A', '--channel', 'email', '--address', 'a@a.test', '--priority', 'urgent'], 'Give --priority as primary or secondary.'],
    [['--org', 'a', '--name', 'A', '--channel', 'email', '--address', 'a@a.test', '--priority', 'primary', '--token', 'x'], 'Unknown option --token.'],
  ])('refuses %j', (args, message) => {
    expect(parseContactArgs(args)).toEqual({ ok: false, message });
  });
});
