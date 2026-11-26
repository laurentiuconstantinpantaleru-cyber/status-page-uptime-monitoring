# Architecture questions

## Q-006 · How does the web in-memory cache learn about worker state changes?
- **Status:** answered 2026-11-26
- **Blocks:** Inter-process cache invalidation mechanism between check workers and the web process.
- **Who answers:** user
- **Answer:** Workers increment a version number in the database on every monitor state change; the web process reads it periodically and invalidates the cache when it changes. MySQL has no LISTEN/NOTIFY. Read interval: Q-007.
- **Recorded as:** D-020

## Q-007 · How often does the web process read the cache version number?
- **Status:** answered 2026-11-26
- **Blocks:** Status page cache invalidation (D-020); how soon after a monitor status change visitors see it.
- **Who answers:** user
- **Answer:** Every 30 seconds.
