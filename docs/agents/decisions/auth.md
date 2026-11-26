# Sign-in and access decisions

## D-034 · Passwords hashed with bcrypt; accounts created from the command line
- **Status:** approved
- **Date:** 2026-11-26
- **Rule:** A user signs in with email and password (Q-008). `users.password_hash` holds the bcrypt hash (`bcryptjs`, cost 10, the library default); the plaintext is never stored or logged. A password is 1–72 bytes in UTF-8 (bcrypt reads at most 72), so longer ones are refused when the account is created. Wrong email, wrong password and a user without a password get the same "Wrong email or password." message. Accounts are created with `npm run user:create -- --email <email> --name <name> --role <member|org_admin|global_admin> [--org <slug>]`; the password is read from stdin, never from the arguments.
- **Why:** The user approved the plan on 2026-11-26. D-025 already hashes API key secrets with bcrypt, so one pure-JS dependency serves both and the runtime stays on Node 22; nobody asked for sign-up or user management, and the first account must come from somewhere.
- **Rejected:** argon2id from `node:crypto` (needs Node 24 in CI and in the image); the native `argon2` package (a native build); a password on the command line (it would land in the shell history and the process list).
- **Evidence:** src/web/auth/password.ts, src/cli/user-create.ts, db/migrations/0007_auth.sql, test/web/auth-password.test.ts
- **Source:** user · confidence high

## D-035 · Server-side sessions in MySQL; SameSite=Lax cookie and an Origin check on POST
- **Status:** approved
- **Date:** 2026-11-26
- **Rule:** A sign-in creates a row in `sessions` keyed by the SHA-256 of a random 32-byte token; the browser gets only the token, in the cookie `sid` (`HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` when `NODE_ENV=production`). A session ends 8 hours after its last request or 7 days after sign-in, whichever comes first; an ended session is deleted when it is next presented. `POST /logout` deletes the row and clears the cookie. Every POST must carry an `Origin` header whose host equals the request's `Host`, else 403.
- **Why:** The user approved the plan on 2026-11-26 (8 h idle, 7 days at most). A stored hash means a leaked database does not hand out live sessions; `SameSite=Lax` and the Origin check stop cross-site form posts without a token in every form.
- **Rejected:** A signed cookie holding the session (cannot be revoked on logout); a per-session CSRF token in every form (more code for the same protection with current browsers).
- **Evidence:** src/web/auth/session.ts, src/web/auth/access.ts, test/web/session.test.ts, test/web/access-matrix.test.ts
- **Source:** user · confidence high

## D-036 · What a refused request gets
- **Status:** approved
- **Date:** 2026-11-26
- **Rule:** A request to `/admin` or below without a valid session gets 303 to `/login`. A signed-in user whose role lacks the permission (D-018) gets 403. A monitor or incident of another organization, or one that does not exist, gets 404 for anyone but a global admin, so its existence does not leak. A successful sign-in goes to `/admin/monitors` with 303.
- **Why:** The user approved the plan on 2026-11-26.
- **Rejected:** 401 for a visitor (a browser shows nothing useful); 403 for another organization's resources (confirms that the id exists).
- **Evidence:** src/web/auth/access.ts, test/web/access-matrix.test.ts
- **Source:** user · confidence high
