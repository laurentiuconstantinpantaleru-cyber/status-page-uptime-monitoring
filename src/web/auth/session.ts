import { createHash, randomBytes } from 'node:crypto';

// Sessions (D-040): the browser holds a random token; MySQL holds only its SHA-256.

export const SESSION_COOKIE = 'sid';
export const IDLE_MS = 8 * 60 * 60 * 1000;
export const MAX_MS = 7 * 24 * 60 * 60 * 1000;

export const newSessionToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** A session lasts 8 h after its last request and 7 days after sign-in, whichever ends first. */
export function sessionAlive(s: { createdAt: Date; lastSeenAt: Date }, now: Date): boolean {
  const t = now.getTime();
  return t < s.lastSeenAt.getTime() + IDLE_MS && t < s.createdAt.getTime() + MAX_MS;
}

export function readCookie(header: string | undefined, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim() || null;
  }
  return null;
}

const attributes = (secure: boolean) => `Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;

export const sessionCookie = (token: string, secure: boolean) =>
  `${SESSION_COOKIE}=${token}; ${attributes(secure)}; Max-Age=${MAX_MS / 1000}`;

export const clearedSessionCookie = (secure: boolean) => `${SESSION_COOKIE}=; ${attributes(secure)}; Max-Age=0`;
