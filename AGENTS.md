# AGENTS.md — status-page-uptime-monitoring

<!-- graffino-agentic:begin v1 -->
## How we work here

**Before any work:** `git fetch --all --prune`, then `git pull --ff-only`. Stop on a
non-fast-forward or on uncommitted changes you did not make.

**Always load** (indexes; open the entry, or its topic file, before you rely on it):
`docs/agents/DECISIONS.md`, `docs/agents/PATTERNS.md`,
`docs/agents/CONTRACTS.md`, `docs/agents/OPEN-QUESTIONS.md`, `CONTEXT.md`.

**Load on demand:**

| When | Load |
|---|---|
| You rely on an entry | the entry, or its topic file under `docs/agents/<kind>/` |
| Structural work | `docs/agents/ARCHITECTURE.md` |
| Old code or a past decision needs explaining | `docs/agents/DECISIONS-SUPERSEDED.md`, `PATTERNS-SUPERSEDED.md` (never obeyed) |
| UI work | `docs/design/DESIGN.md`, `docs/design/registry.yaml` |

**Flow:** a change to more than a few lines, or one with a design choice, starts with
`/plan`. The approved plan runs with `/build`. Small fixes go straight to build, with
tests first where tests exist.

### The gate
Ask yourself: **does this change something already approved?**
- **Do, then report:** add a `candidate` pattern; add or answer an open question
  (only with an answer the user gave); write a `Proposed answer` the evidence
  supports (the question stays `investigating` until the user confirms it); fix a
  typo, link or moved path; code that follows the approved entries.
- **Propose and wait:** change, supersede or delete an `approved` pattern or
  decision; promote `candidate → approved`; add a decision; code that contradicts an
  entry. Use this shape, then stop:

```text
PROPOSAL: <add-decision | change | supersede | promote | delete>
- Existing: <ID and what it says, or "none">
- Proposed: <the new rule>
- Why now: <what changed>
- Impact: <files that follow the old rule>
- If approved: <old ID> → superseded-by <new ID> (kept, not deleted)
```
Before you propose, check `docs/agents/REJECTED.md`: never re-propose a rejected item
without new evidence. A rejected proposal is added there with the reason.

### Hard rules
- Reply to the user in Romanian (questions, plans, reports); code, comments, commit
  messages, file names and ledger terms (PROPOSAL, D-, Q-, `Status: approved`) stay in English.
- Build only from `approved` entries. Unanswered means out of scope: record a Q-,
  never invent a value, a requirement or a behaviour.
- Add nothing nobody asked for. Note it as a suggestion instead.
- Build the smallest change that meets the approved criteria, reusing existing code.
  A new abstraction, dependency, configuration option, extension point or broad
  refactor needs a concrete reason today. Never at the cost of tests or error handling.
- Tests first where the repo has tests. Never change what an existing test asserts
  to make code pass; an assertion you think is wrong goes to the user.
- Never write a secret, token, password or personal data into a file, commit or log.
- Never push, tag, release, or deploy without the user's go for that action.
- When you cite past work, label the intent: **replicate** (only for an `approved`
  pattern) or **for awareness only**. History is not a template.
- The code wins over any document. When they disagree, say so and fix the document.
- Report honestly: a failed check is reported with its output; a skipped step is
  named with its reason.

### Ledger rules
- IDs are one sequence per kind in this repo: `D-`, `PATTERN-`, `C-`, `Q-`. Never renumber.
- A provided contract (C-) lives here only; consumers link to it. Changing one is a
  PROPOSAL, and the plan names the consumer files too.
- Superseded entries stay (`status: superseded-by <ID>`) so old code stays explainable.
  Their index lines live in `DECISIONS-SUPERSEDED.md` / `PATTERNS-SUPERSEDED.md`, not
  in the always-loaded indexes; the lint (`--fix`) moves them.
- After any ledger change: `python3 docs/agents/tools/ledger-lint.py --fix` (next free
  ID: `--next D`). It must pass.
- **Confirmed:** when the user confirms an entry in a plan, set `- **Confirmed:** <date>`
  on it. Any edit to an entry removes its Confirmed line.
- A new reusable practice becomes a `candidate` pattern in the same session.
- A settled constraint becomes a decision PROPOSAL in the same session.
<!-- graffino-agentic:end -->

## 1. What this repo is
Status page + uptime monitoring — availability monitoring service for student projects and local businesses.
Provides HTTP/TLS/keyword/latency checks, automated incident lifecycle, maintenance windows,
email/Telegram alerts, sub-100ms cached public status pages, and monthly uptime reporting.

## 2. Stack and commands
Node.js, TypeScript, Fastify, MySQL 8, Vitest.

```bash
# install dependencies
npm install

# compile TypeScript
npm run build

# run test suite with simulated time
npm test

# run linter and ledger check
npm run lint
python3 docs/agents/tools/ledger-lint.py
```

## 3. Layout
- `src/`: application source code (web API, SSR views, scheduler, checker workers, db migrations)
- `docs/`: project brief, design registry, and agent knowledge ledger
- `.claude/`: skills (/plan, /build) and agent definitions (planner, builder)
- `.github/`: continuous integration workflows

## 4. Rules for this repo
- Run check workers in separate processes; require secondary confirmation before declaring an incident.
- Drift-free scheduling: all timing logic must be verified using simulated clocks, never sleep.
- Raw check retention is 7 days, compacted into hourly and daily roll-ups thereafter.
- Cache public status pages in-memory and invalidate within 30 seconds of a monitor status change (D-020).

## 5. Release
Branch `main`. Releases tagged with semver (`v1.x.y`).
Local tests and CI workflow must pass cleanly before release.
Never push or release without explicit user authorization.

## 6. Definition of done
- `npm test` passes (including simulated time tests).
- `python3 docs/agents/tools/ledger-lint.py` passes with zero errors.
