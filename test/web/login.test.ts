import { afterEach, describe, expect, it } from 'vitest';
import { hashToken } from '../../src/web/auth/session.js';
import { HOST, PASSWORD, USERS, get, harness, post, type Harness } from './admin-fake.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.app.close();
  h = undefined;
});

const WRONG = 'Wrong email or password.';

describe('GET /login (DS-p26-login)', () => {
  it('renders the form with email and password', async () => {
    h = harness();
    const response = await get(h.app, '/login');

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/html/);
    expect(response.body).toContain('<h1 id="login-title">Log in</h1>');
    expect(response.body).toContain('<form class="form card" method="post" action="/login"');
    expect(response.body).toContain('name="email" type="email" autocomplete="username"');
    expect(response.body).toContain('name="password" type="password" autocomplete="current-password"');
    expect(response.body).not.toContain(WRONG);
  });
});

describe('POST /login (D-034, D-035)', () => {
  it('signs in: a session cookie and 303 to the dashboard', async () => {
    h = harness();
    const response = await post(h.app, '/login', { email: USERS.member.email, password: PASSWORD });

    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe('/admin/monitors');
    const cookie = String(response.headers['set-cookie']);
    expect(cookie).toMatch(/^sid=[A-Za-z0-9_-]{43};/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=604800');
    expect(cookie).not.toContain('Secure');
  });

  it('stores only the SHA-256 of the token, not the token', async () => {
    h = harness();
    const response = await post(h.app, '/login', { email: USERS.member.email, password: PASSWORD });
    const token = String(response.headers['set-cookie']).split(';')[0].slice('sid='.length);

    expect([...h.auth.sessions.keys()]).toEqual([hashToken(token)]);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(h.auth.sessions.has(token)).toBe(false);
  });

  it('marks the cookie Secure in production', async () => {
    h = harness({ secureCookies: true });
    const response = await post(h.app, '/login', { email: USERS.member.email, password: PASSWORD });

    expect(String(response.headers['set-cookie'])).toContain('; Secure');
  });

  it.each([
    ['a wrong password', USERS.member.email, 'not-the-password'],
    ['an unknown email', 'nobody@a.test', PASSWORD],
    ['a user without a password', 'nopassword@a.test', PASSWORD],
    ['a password longer than 72 bytes', USERS.member.email, `${PASSWORD}${'x'.repeat(72)}`],
  ])('refuses %s with the one generic message', async (_, email, password) => {
    h = harness();
    const response = await post(h.app, '/login', { email, password });

    expect(response.statusCode).toBe(401);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.body).toContain(WRONG);
    expect(h.auth.sessions.size).toBe(0);
  });

  it('keeps the email but never echoes the password', async () => {
    h = harness();
    const response = await post(h.app, '/login', { email: USERS.member.email, password: 'secret-typed-wrong' });

    expect(response.body).toContain(`value="${USERS.member.email}"`);
    expect(response.body).not.toContain('secret-typed-wrong');
  });

  it.each([
    [{ email: '', password: PASSWORD }, 'Enter your email address.'],
    [{ email: 'not-an-email', password: PASSWORD }, 'Enter an email address like name@example.test.'],
    [{ email: USERS.member.email, password: '' }, 'Enter your password.'],
    [{ email: `${'a'.repeat(250)}@a.test`, password: PASSWORD }, 'Enter an email address like name@example.test.'],
  ])('refuses invalid fields with 400 and says which one: %j', async (fields, message) => {
    h = harness();
    const response = await post(h.app, '/login', fields);

    expect(response.statusCode).toBe(400);
    expect(response.body).toContain(message);
    expect(response.body).toContain('aria-invalid="true"');
    expect(h.auth.sessions.size).toBe(0);
  });

  it('refuses a body that is not a form, without a stack trace', async () => {
    h = harness();
    const response = await h.app.inject({
      method: 'POST', url: '/login',
      headers: { host: HOST, origin: `https://${HOST}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ email: USERS.member.email, password: PASSWORD }),
    });

    expect(response.statusCode).toBe(400);
    expect(h.auth.sessions.size).toBe(0);
  });

  it('escapes what was typed as the email', async () => {
    h = harness();
    const response = await post(h.app, '/login', { email: '"><script>alert(1)</script>', password: PASSWORD });

    expect(response.body).not.toContain('<script>alert(1)</script>');
    expect(response.body).toContain('&quot;&gt;&lt;script&gt;');
  });
});

describe('POST /logout (D-035)', () => {
  it('deletes the session and clears the cookie', async () => {
    h = harness();
    const login = await post(h.app, '/login', { email: USERS.member.email, password: PASSWORD });
    const cookie = String(login.headers['set-cookie']).split(';')[0];

    const response = await post(h.app, '/logout', {}, cookie);

    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe('/login');
    expect(String(response.headers['set-cookie'])).toMatch(/^sid=; .*Max-Age=0/);
    expect(h.auth.sessions.size).toBe(0);
    const after = await get(h.app, '/admin/monitors', cookie);
    expect(after.statusCode).toBe(303);
    expect(after.headers.location).toBe('/login');
  });
});
