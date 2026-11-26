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
Contrast ratios are WCAG 2.x, measured against the background named in the column.
Status colors are for icons, bars, dots and borders only (≥ 3:1). Status *text* uses
`--color-text-primary` next to the icon, so the amber never has to reach 4.5:1.

### Colors
| Token | Light | Dark | Purpose | Contrast light / dark |
|---|---|---|---|---|
| `--color-bg-base` | `#ffffff` | `#0f172a` (Slate 900) | Page background | — |
| `--color-bg-surface` | `#f8fafc` (Slate 50) | `#1e293b` (Slate 800) | Cards, containers | — |
| `--color-bg-subtle` | `#f1f5f9` (Slate 100) | `#334155` (Slate 700) | Row hover, uptime bar track | — |
| `--color-border` | `#e2e8f0` (Slate 200) | `#334155` (Slate 700) | Card borders, dividers (decorative) | — |
| `--color-border-strong` | `#64748b` (Slate 500) | `#64748b` (Slate 500) | Input and control borders | 4.76 on base / 3.07 on surface |
| `--color-text-primary` | `#0f172a` (Slate 900) | `#f8fafc` (Slate 50) | Headings, body, metric values | 17.85 / 17.06 |
| `--color-text-secondary` | `#475569` (Slate 600) | `#cbd5e1` (Slate 300) | Labels, descriptions | 7.24 on surface / 9.85 on surface |
| `--color-text-muted` | `#64748b` (Slate 500) | `#94a3b8` (Slate 400) | Timestamps, footnotes, legends; not on `bg-subtle` | 4.55 on surface / 5.71 on surface |
| `--color-brand` | `#2563eb` (Blue 600) | `#60a5fa` (Blue 400) | Primary buttons, links, focus ring | 4.94 on surface / 5.75 on surface |
| `--color-on-brand` | `#ffffff` | `#0f172a` (Slate 900) | Text and icons on `--color-brand` | 5.17 / 7.02 |
| `--color-status-ok` | `#059669` (Emerald 600) | `#34d399` (Emerald 400) | Operational (Up) | 3.60 on surface / 7.61 |
| `--color-status-degraded` | `#d97706` (Amber 600) | `#fbbf24` (Amber 400) | High latency, degraded | 3.04 on surface / 8.76 |
| `--color-status-outage` | `#dc2626` (Red 600) | `#f87171` (Red 400) | Open incident (Down) | 4.83 / 5.29 |
| `--color-status-maint` | `#7c3aed` (Violet 600) | `#a78bfa` (Violet 400) | Maintenance window | 5.70 / 5.38 |
| `--color-status-nodata` | `#64748b` (Slate 500) | `#64748b` (Slate 500) | Uptime bar with no checks | 4.55 on surface / 3.07 |
| `--shadow-card` | `0 1px 3px 0 rgba(15,23,42,0.08), 0 1px 2px -1px rgba(15,23,42,0.08)` | `0 0 0 1px #334155` | Card elevation; dark uses an outline, not a shadow | — |

### Typography
System fonts stay (no download, which keeps the public page within its budget).
Every number uses `font-variant-numeric: tabular-nums`, so columns of values line up.

| Token | Family | Size / Line-height | Weight | Purpose |
|---|---|---|---|---|
| `--font-sans` | `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif` | — | — | Text, headings, buttons |
| `--font-mono` | `ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace` | — | — | Every metric, timestamp, HTTP code, URL |
| `--text-xs` | `--font-sans` | `12px / 16px` | 400 | Legends, uptime bar captions |
| `--text-sm` | `--font-sans` | `13px / 20px` | 400 / 500 | Secondary text, table cells |
| `--text-base` | `--font-sans` | `15px / 24px` | 400 | Body, incident updates |
| `--text-lg` | `--font-sans` | `17px / 26px` | 600 | Card titles, monitor names |
| `--text-xl` | `--font-sans` | `22px / 30px` | 700 | Status banner headline (one per screen) |
| `--text-metric` | `--font-mono` | `13px / 20px` | 500 | Inline metrics (`24 ms`, `200`, `14:05 UTC`) |
| `--text-metric-lg` | `--font-mono` | `20px / 28px` | 600 | Headline metrics (`99.98%` per monitor) |

### Spacing
4 px base. Airy layout: cards and sections get more room, and data inside them stays
tight.

| Token | Value | Purpose |
|---|---|---|
| `--space-0-5` | `2px` | Uptime bar gap only |
| `--space-1` | `4px` | Icon-to-text in badges |
| `--space-2` | `8px` | Badge padding, inline gaps |
| `--space-3` | `12px` | Table cell padding, list row gap |
| `--space-4` | `16px` | Gap between items inside a card |
| `--space-6` | `24px` | Card padding |
| `--space-8` | `32px` | Gap between cards and sections; page padding on mobile |
| `--space-12` | `48px` | Page padding on desktop, header to content |
| `--space-16` | `64px` | Top and bottom of the public status page |

### Radius
| Token | Value | Purpose |
|---|---|---|
| `--radius-sm` | `3px` | Uptime bars |
| `--radius-md` | `6px` | Inputs, buttons, badges |
| `--radius-lg` | `10px` | Cards, status banner |
| `--radius-pill` | `9999px` | Status pills |

### Breakpoints
| Name | Min | Max | Purpose |
|---|---|---|---|
| `mobile` | `0px` | `640px` | One column; uptime bars show the last 30 days, no horizontal scroll |
| `tablet` | `641px` | `1024px` | One column, centered `--container-max` container, 90-day bars |
| `desktop` | `1025px` | — | Centered `--container-max` container, 90-day bars |

### Layout
| Token | Value | Purpose |
|---|---|---|
| `--container-max` | `800px` | Widest content column on tablet and desktop |
