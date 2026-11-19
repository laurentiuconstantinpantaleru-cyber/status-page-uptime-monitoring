# DESIGN — status-page-uptime-monitoring

<!-- graffino-agentic:begin v1 -->
> The design guardrails for this app. Every UI change follows them. A change to a
> token or a rule here is a PROPOSAL (AGENTS.md → The gate).

## Where designs live
**Designs change only in this repo.** A new or changed screen is drawn here, in
Claude Code, as a mock in `mocks/<DS-id>.html` (using the tokens below), and
confirmed before it is built. The places:

| Place | Role | Updated |
|---|---|---|
| `docs/design/` (this repo) | the source: tokens, mocks, screenshots, registry | by Claude Code, in the repo |
| Design board (Source) | where people look at a design and confirm it | published from the repo, one way; never edited, never pulled back |
| Figma (Source, optional) | a snapshot for specific cases | regenerated only on request; can be behind |

When they disagree, the repo is right. A change made on the board or in Figma is lost
at the next publish. Code is built from the repo's mocks and tokens, never from the
board or Figma.

## Procedure for any UI change

1. **Find the design.** Resolve the screen's `DS-` ID in `registry.yaml` and open
   its mock (`mocks/`) and screenshots (`screens/`). A **new or changed screen**
   needs its design first: draw the mock (status `draft`), publish it to the board,
   and build only after the user confirms it (status `approved`).
2. **Reuse first.** Use an existing component from `registry.yaml` (kind
   `component`). A new component needs a reason in the plan.
3. **Tokens only.** Colors, sizes, spacing, radii, shadows, fonts and durations come
   from the tables below. No raw hex, px or font name in component code.
4. **Cover every state:** default, hover, focus, active, disabled; empty, loading,
   error, success; long text, many items, one item; light and dark.
5. **Screenshot and compare** (command in AGENTS.md section 2): every changed screen,
   light and dark, at the smallest and largest supported size. Save as
   `screens/<DS-id>.<light|dark>.png`. Look at each one before you report.
6. **Record.** Update `registry.yaml` (new DS- ID, status `implemented`, source
   file). Republish the changed screens to the board. A reusable UI practice becomes
   a `candidate` pattern.

## Guardrails

**Color and contrast**
- Text contrast ≥ 4.5:1 (≥ 3:1 for text ≥ 18.66 px bold / 24 px). Icons, borders of
  inputs and focus rings ≥ 3:1 against their background. Check both themes.
- Color never carries meaning alone: pair it with an icon or text.
- Dark mode uses its own token values, not inverted light values.

**Layout and spacing**
- Spacing comes from the scale only. Align to the grid; equal gaps for equal
  relationships.
- No horizontal scroll at the smallest supported width. Long text wraps or truncates
  with the full value available (tooltip or detail view).

**Typography**
- Only the type scale below. One primary heading per screen. Sentence case for
  labels, buttons and headings.

**Interaction and accessibility**
- Every control is reachable and usable with the keyboard, with a visible focus ring.
- Hit targets ≥ 44 × 44 px on touch, ≥ 24 × 24 px with a pointer.
- Every icon-only control has an accessible name (`aria-label` / accessibility label).
- Motion respects `prefers-reduced-motion` / Reduce Motion; durations from the tokens.

**Copy**
- Plain, short, active voice. Buttons name the action ("Save", not "OK").
- Error text says what happened and what to do next. No raw error codes alone.
- Terms from `CONTEXT.md` only.

**States**
- Empty states explain what will appear and offer the next action.
- Loading shows within 100 ms of a wait; skeletons keep the final layout.
- Destructive actions ask for confirmation or offer undo.

## Publishing to the board
Say **"publish the board"**. Publishing goes one way, repo → board; nothing is
pulled back.

<!-- graffino-agentic:end -->

## Source
- Design board: none yet
- Figma: none

- Token source in code: src/web/public/tokens.css

## Tokens

### Colors
| Token | Light | Dark (Slate) | Purpose |
|---|---|---|---|
| `--color-bg-base` | `#ffffff` | `#0f172a` (Slate 900) | Main page background |
| `--color-bg-surface` | `#f8fafc` (Slate 50) | `#1e293b` (Slate 800) | Card and container background |
| `--color-bg-subtle` | `#f1f5f9` (Slate 100) | `#334155` (Slate 700) | Hover row background, chart bar background |
| `--color-border` | `#e2e8f0` (Slate 200) | `#334155` (Slate 700) | Card borders, dividers |
| `--color-border-strong` | `#cbd5e1` (Slate 300) | `#475569` (Slate 600) | Interactive control borders, inputs |
| `--color-text-primary` | `#0f172a` (Slate 900) | `#f8fafc` (Slate 50) | Headings, primary text, metric values |
| `--color-text-secondary` | `#475569` (Slate 600) | `#94a3b8` (Slate 400) | Labels, descriptions, subtitles |
| `--color-text-muted` | `#64748b` (Slate 500) | `#64748b` (Slate 500) | Timestamps, footnotes, chart legends |
| `--color-brand` | `#2563eb` (Blue 600) | `#3b82f6` (Blue 500) | Primary buttons, links, accents |
| `--color-status-ok` | `#10b981` (Emerald 500) | `#34d399` (Emerald 400) | Service operational (Up) |
| `--color-status-degraded` | `#f59e0b` (Amber 500) | `#fbbf24` (Amber 400) | High latency, degraded performance |
| `--color-status-outage` | `#ef4444` (Red 500) | `#f87171` (Red 400) | Open incident, major outage (Down) |
| `--color-status-maint` | `#3b82f6` (Blue 500) | `#60a5fa` (Blue 400) | Scheduled maintenance window |

### Typography
| Token | Family | Size / Line-height | Weight | Purpose |
|---|---|---|---|---|
| `--font-sans` | `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif` | — | — | Body text, headings, buttons |
| `--font-mono` | `ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace` | — | — | Latencies, uptime percentages, HTTP codes |
| `--text-xs` | `--font-sans` | `11px / 16px` | 400 | Small labels, uptime bar legends |
| `--text-sm` | `--font-sans` | `13px / 20px` | 400 / 500 | Secondary text, table cells |
| `--text-base` | `--font-sans` | `14px / 22px` | 400 | Body text, incident update notes |
| `--text-lg` | `--font-sans` | `16px / 24px` | 600 | Card titles, component names |
| `--text-xl` | `--font-sans` | `20px / 28px` | 700 | Status banner headline |
| `--text-metric` | `--font-mono` | `13px / 18px` | 500 | Metric values (`24ms`, `99.98%`) |

### Spacing
| Token | Value | Purpose |
|---|---|---|
| `--space-1` | `4px` | Fine gaps, bar gaps |
| `--space-2` | `8px` | Badge padding, icon gap |
| `--space-3` | `12px` | Compact cell padding |
| `--space-4` | `16px` | Standard card padding |
| `--space-6` | `24px` | Section gap |
| `--space-8` | `32px` | Page content padding |
| `--space-12` | `48px` | Top-level header gap |

### Radius and Shadows
| Token | Value | Purpose |
|---|---|---|
| `--radius-sm` | `4px` | Individual uptime bars, form inputs |
| `--radius-md` | `6px` | Buttons, incident cards |
| `--radius-lg` | `8px` | Status banner container, major cards |
| `--radius-pill` | `9999px` | Status badges and pills |
| `--shadow-card` | `0 1px 3px 0 rgba(0,0,0,0.1), 0 1px 2px -1px rgba(0,0,0,0.1)` | Surface card shadow |

### Breakpoints
| Name | Min | Max | Purpose |
|---|---|---|---|
| `mobile` | `0px` | `640px` | Single column stacked layout, horizontal scroll for 90d bars |
| `tablet` | `641px` | `1024px` | Optimized tablet column |
| `desktop` | `1025px` | `1280px` | Centered 960px container, full 90d uptime bars |
