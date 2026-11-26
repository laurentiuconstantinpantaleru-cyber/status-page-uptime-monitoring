import type { RowDataPacket } from 'mysql2/promise';
import type { Queryable } from '../../db/maintenance.js';
import type { Clock } from '../../shared/clock.js';
import type { Role, SignedInUser } from './access.js';

// Users and sessions in MySQL (D-034, D-040). Every value goes in as a `?` parameter.

export interface UserCredentials extends SignedInUser {
  passwordHash: string | null;
}

export interface SessionRow {
  createdAt: Date;
  lastSeenAt: Date;
  user: SignedInUser;
}

export interface AuthStore {
  userByEmail(email: string): Promise<UserCredentials | null>;
  createSession(tokenHash: string, userId: number, now: Date): Promise<void>;
  session(tokenHash: string): Promise<SessionRow | null>;
  touchSession(tokenHash: string, now: Date): Promise<void>;
  deleteSession(tokenHash: string): Promise<void>;
}

const toUser = (row: RowDataPacket): SignedInUser => ({
  id: Number(row.id),
  displayName: row.display_name as string,
  role: row.role as Role,
  organizationId: row.organization_id === null ? null : Number(row.organization_id),
});

export function mysqlAuthStore(db: Queryable): AuthStore {
  return {
    async userByEmail(email) {
      const [rows] = await db.query<RowDataPacket[]>(
        'SELECT id, display_name, role, organization_id, password_hash FROM users WHERE email = ?',
        [email],
      );
      return rows[0] ? { ...toUser(rows[0]), passwordHash: rows[0].password_hash as string | null } : null;
    },
    async createSession(tokenHash, userId, now) {
      await db.query<RowDataPacket[]>(
        'INSERT INTO sessions (id, user_id, created_at, last_seen_at) VALUES (?, ?, ?, ?)',
        [tokenHash, userId, now, now],
      );
    },
    async session(tokenHash) {
      const [rows] = await db.query<RowDataPacket[]>(
        `SELECT s.created_at, s.last_seen_at, u.id, u.display_name, u.role, u.organization_id
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
        [tokenHash],
      );
      const row = rows[0];
      return row ? { createdAt: row.created_at as Date, lastSeenAt: row.last_seen_at as Date, user: toUser(row) } : null;
    },
    async touchSession(tokenHash, now) {
      await db.query<RowDataPacket[]>('UPDATE sessions SET last_seen_at = ? WHERE id = ?', [now, tokenHash]);
    },
    async deleteSession(tokenHash) {
      await db.query<RowDataPacket[]>('DELETE FROM sessions WHERE id = ?', [tokenHash]);
    },
  };
}

export interface NewUser {
  email: string;
  displayName: string;
  role: Role;
  organizationSlug: string | null;
  passwordHash: string;
}

/** For `npm run user:create`; refuses a taken email and an organization that does not fit the role. */
export async function createUser(db: Queryable, clock: Clock, u: NewUser): Promise<number> {
  if ((u.role === 'global_admin') !== (u.organizationSlug === null)) {
    throw new Error(u.role === 'global_admin'
      ? 'A global admin belongs to no organization.'
      : 'A member or org admin belongs to one organization.');
  }
  let organizationId: number | null = null;
  if (u.organizationSlug !== null) {
    const [orgs] = await db.query<RowDataPacket[]>('SELECT id FROM organizations WHERE slug = ?', [u.organizationSlug]);
    if (!orgs[0]) throw new Error(`No organization with the slug "${u.organizationSlug}".`);
    organizationId = Number(orgs[0].id);
  }
  try {
    const [result] = await db.query<RowDataPacket[]>(
      `INSERT INTO users (organization_id, email, display_name, password_hash, role, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [organizationId, u.email, u.displayName, u.passwordHash, u.role, clock.now()],
    );
    return (result as unknown as { insertId: number }).insertId;
  } catch (error) {
    if ((error as { code?: string }).code === 'ER_DUP_ENTRY') throw new Error(`A user with the email ${u.email} already exists.`);
    throw error;
  }
}
