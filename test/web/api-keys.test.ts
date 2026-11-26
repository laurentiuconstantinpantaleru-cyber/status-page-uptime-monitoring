import { describe, expect, it } from 'vitest';
import { hashSecret, newApiKey, parseBearer, verifySecret } from '../../src/web/api/keys.js';

describe('API keys (D-025)', () => {
  it('a new key is <public_id>.<secret>: 12 url-safe characters, a dot, 43 more', () => {
    const key = newApiKey();

    expect(key.publicId).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(key.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(key.plaintext).toBe(`${key.publicId}.${key.secret}`);
  });

  it('every new key is different', () => {
    const keys = Array.from({ length: 50 }, () => newApiKey());

    expect(new Set(keys.map((k) => k.publicId)).size).toBe(50);
    expect(new Set(keys.map((k) => k.secret)).size).toBe(50);
  });

  it('stores only a bcrypt hash of the secret, which verifies the secret and nothing else', async () => {
    const key = newApiKey();
    const hash = await hashSecret(key.secret);

    expect(hash).toMatch(/^\$2[aby]\$10\$.{53}$/);
    expect(hash).not.toContain(key.secret);
    expect(hash).not.toContain(key.publicId);
    expect(await verifySecret(key.secret, hash)).toBe(true);
    expect(await verifySecret(newApiKey().secret, hash)).toBe(false);
    expect(await verifySecret(key.plaintext, hash)).toBe(false);
  });

  it('reads the key from an Authorization: Bearer header', () => {
    const key = newApiKey();

    expect(parseBearer(`Bearer ${key.plaintext}`)).toEqual({ publicId: key.publicId, secret: key.secret });
    expect(parseBearer(`bearer ${key.plaintext}`)).toEqual({ publicId: key.publicId, secret: key.secret });
  });

  it.each([
    ['no header', undefined],
    ['an empty header', ''],
    ['another scheme', `Basic ${newApiKey().plaintext}`],
    ['the key without a scheme', newApiKey().plaintext],
    ['no dot', `Bearer ${'a'.repeat(56)}`],
    ['a short public id', `Bearer abc.${'a'.repeat(43)}`],
    ['a short secret', `Bearer ${'a'.repeat(12)}.abc`],
    ['characters outside base64url', `Bearer ${'a'.repeat(11)}'.${'a'.repeat(43)}`],
    ['two keys', `Bearer ${newApiKey().plaintext} ${newApiKey().plaintext}`],
  ])('reads no key from %s', (_, header) => {
    expect(parseBearer(header)).toBeNull();
  });
});
