import bcrypt from 'bcryptjs';

// Passwords (D-034): bcrypt, which reads at most 72 bytes, so longer ones are refused, never cut.

const COST = 10;
const MAX_BYTES = 72;

const tooLong = (password: string) => Buffer.byteLength(password, 'utf8') > MAX_BYTES;

/** Why a new password cannot be used, or null. */
export function passwordProblem(password: string): string | null {
  if (password.length === 0) return 'The password is empty.';
  if (tooLong(password)) return `The password is longer than ${MAX_BYTES} bytes.`;
  return null;
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, COST);
}

/** False for a password over 72 bytes: bcrypt would compare only its first 72. */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (password.length === 0 || tooLong(password)) return false;
  return bcrypt.compare(password, hash);
}
