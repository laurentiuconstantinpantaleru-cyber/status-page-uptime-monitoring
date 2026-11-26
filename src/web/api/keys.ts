import { randomBytes } from 'node:crypto';
import { hashPassword, verifyPassword } from '../auth/password.js';

// API keys (D-025): `<public_id>.<secret>`. The public id finds the row; only a bcrypt hash of
// the secret is stored. The plaintext exists once, when the key is made, and is never logged.

export interface NewApiKey {
  publicId: string;
  secret: string;
  /** What the person is shown once and sends as `Authorization: Bearer <plaintext>`. */
  plaintext: string;
}

/** 9 random bytes → 12 base64url characters (`api_keys.public_id CHAR(12)`); 32 bytes → 43. */
export function newApiKey(): NewApiKey {
  const publicId = randomBytes(9).toString('base64url');
  const secret = randomBytes(32).toString('base64url');
  return { publicId, secret, plaintext: `${publicId}.${secret}` };
}

const BEARER = /^Bearer ([A-Za-z0-9_-]{12})\.([A-Za-z0-9_-]{43})$/i;

/** The key in an `Authorization` header, or null for anything else. */
export function parseBearer(header: string | undefined): { publicId: string; secret: string } | null {
  const match = BEARER.exec(header ?? '');
  return match ? { publicId: match[1], secret: match[2] } : null;
}

/** The same bcrypt as passwords (D-034); a 43-character secret is well under bcrypt's 72 bytes. */
export const hashSecret = (secret: string) => hashPassword(secret);
export const verifySecret = (secret: string, hash: string) => verifyPassword(secret, hash);
