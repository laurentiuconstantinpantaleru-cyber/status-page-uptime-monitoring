import { describe, expect, it } from 'vitest';
import { parseApiKeyArgs } from '../../src/cli/apikey-create.js';

describe('npm run apikey:create (D-025)', () => {
  it('reads organization, name and level from the arguments', () => {
    expect(parseApiKeyArgs(['--org', 'hug-the-mug', '--name', 'Grafana', '--level', 'read'])).toEqual({
      ok: true, key: { organizationSlug: 'hug-the-mug', name: 'Grafana', level: 'read' },
    });
    expect(parseApiKeyArgs(['--org', 'campus', '--name', 'CI', '--level', 'write'])).toEqual({
      ok: true, key: { organizationSlug: 'campus', name: 'CI', level: 'write' },
    });
  });

  it.each([
    [['--name', 'X', '--level', 'read'], 'Give --org <slug>.'],
    [['--org', 'a', '--level', 'read'], 'Give --name.'],
    [['--org', 'a', '--name', 'x'.repeat(256), '--level', 'read'], 'Keep --name to 255 characters.'],
    [['--org', 'a', '--name', 'X'], 'Give --level as read or write.'],
    [['--org', 'a', '--name', 'X', '--level', 'admin'], 'Give --level as read or write.'],
    [['--org', 'a', '--name', 'X', '--level', 'read', '--secret', 's'], 'Unknown option --secret.'],
  ])('refuses %j', (args, message) => {
    expect(parseApiKeyArgs(args)).toEqual({ ok: false, message });
  });
});
