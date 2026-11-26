import { describe, expect, it } from 'vitest';
import { hashPassword, passwordProblem, verifyPassword } from '../../src/web/auth/password.js';

describe('passwords (D-034)', () => {
  it('stores a bcrypt hash, never the password', async () => {
    const hash = await hashPassword('correct-horse-battery');

    expect(hash).toMatch(/^\$2[aby]\$10\$/);
    expect(hash).toHaveLength(60);
    expect(hash).not.toContain('correct-horse-battery');
  });

  it('verifies the right password and refuses a wrong one', async () => {
    const hash = await hashPassword('correct-horse-battery');

    expect(await verifyPassword('correct-horse-battery', hash)).toBe(true);
    expect(await verifyPassword('correct-horse-batterY', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('refuses a password longer than 72 bytes, which bcrypt would cut', async () => {
    const long = 'a'.repeat(72);
    const hash = await hashPassword(long);

    expect(await verifyPassword(`${long}b`, hash)).toBe(false);
  });

  it('accepts 1–72 bytes when an account is created', () => {
    expect(passwordProblem('')).toBe('The password is empty.');
    expect(passwordProblem('x')).toBeNull();
    expect(passwordProblem('a'.repeat(72))).toBeNull();
    expect(passwordProblem('a'.repeat(73))).toBe('The password is longer than 72 bytes.');
    // 25 × "ț" is 50 bytes; 37 × "ț" is 74 bytes although only 37 characters.
    expect(passwordProblem('ț'.repeat(25))).toBeNull();
    expect(passwordProblem('ț'.repeat(37))).toBe('The password is longer than 72 bytes.');
  });
});
