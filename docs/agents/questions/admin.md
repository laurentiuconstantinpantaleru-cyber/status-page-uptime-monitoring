# Admin questions

## Q-008 · How do users sign in to the admin interface?
- **Status:** answered 2026-11-26
- **Blocks:** Credential columns on `users` and the admin login.
- **Who answers:** user
- **Answer:** Email and password, as drawn on DS-p26-login: wrong credentials get one message that does not say which field was wrong. Passwords are bcrypt hashes, accounts come from `npm run user:create`, sessions live in MySQL for 8 h idle and 7 days at most. Password reset is not part of it.
- **Recorded as:** D-034, D-035, D-036

## Q-019 · Where and how does the admin panel show worker_fault episodes?
- **Status:** open
- **Blocks:** Surfacing `worker_faults` (D-015) to operators; there is no admin panel yet.
- **Who answers:** user
