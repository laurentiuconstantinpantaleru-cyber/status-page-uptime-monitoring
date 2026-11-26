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
| `--color-bg-base` | `#f8fafc` (Slate 50) | `#0a0b0f` (near-black) | Page background, deeper than the cards | — |
| `--color-bg-surface` | `#ffffff` | `#111318` | Cards, containers, status badges | — |
| `--color-bg-subtle` | `#f1f5f9` (Slate 100) | `#1a1d24` | Row hover, uptime bar track | — |
| `--color-border` | `#e2e8f0` (Slate 200) | `#23272f` | Card borders, dividers (decorative) | — |
| `--color-border-strong` | `#64748b` (Slate 500) | `#64748b` (Slate 500) | Input and control borders | light 4.76 on surface, 4.55 on base / dark 3.90 on surface |
| `--color-text-primary` | `#0f172a` (Slate 900) | `#f8fafc` (Slate 50) | Headings, body, metric values | 17.85 on surface, 17.06 on base / 17.76 |
| `--color-text-secondary` | `#475569` (Slate 600) | `#cbd5e1` (Slate 300) | Labels, descriptions | 7.58 on surface, 7.24 on base / 12.52 on surface |
| `--color-text-muted` | `#64748b` (Slate 500) | `#94a3b8` (Slate 400) | Timestamps, footnotes, legends; not on `bg-subtle` | 4.76 on surface, 4.55 on base / 7.25 on surface |
| `--color-brand` | `#2563eb` (Blue 600) | `#60a5fa` (Blue 400) | Primary buttons, links, focus ring | 5.17 on surface, 4.94 on base / 7.31 on surface |
| `--color-on-brand` | `#ffffff` | `#0f172a` (Slate 900) | Text and icons on `--color-brand` | 5.17 / 7.02 |
| `--color-status-ok` | `#059669` (Emerald 600) | `#34d399` (Emerald 400) | Operational (Up) | 3.77 on surface / 9.67 |
| `--color-status-degraded` | `#d97706` (Amber 600) | `#fbbf24` (Amber 400) | High latency, degraded | 3.19 on surface, 3.04 on base / 11.13 |
| `--color-status-outage` | `#dc2626` (Red 600) | `#f87171` (Red 400) | Open incident (Down) | 4.83 / 6.72 |
| `--color-status-maint` | `#7c3aed` (Violet 600) | `#a78bfa` (Violet 400) | Maintenance window | 5.70 / 6.83 |
| `--color-status-nodata` | `#64748b` (Slate 500) | `#64748b` (Slate 500) | Uptime bar with no checks | 4.76 on surface / 3.90 |
| `--shadow-card` | `0 1px 3px 0 rgba(15,23,42,0.08), 0 1px 2px -1px rgba(15,23,42,0.08)` | `0 1px 2px 0 rgba(0,0,0,0.5)` | Faint card elevation; every card also has a 1px solid `--color-border` border in both themes | — |
| `--color-btn-hero-bg` | `#ffffff` | `#f8fafc` (Slate 50) | The light pill button on the hero card | — |
| `--color-btn-hero-text` | `#0f172a` (Slate 900) | `#0a0b0f` | Text on `--color-btn-hero-bg` | 17.85 / 18.80 |
| `--color-btn-hero-border` | `#475569` (Slate 600) | `transparent` | Border of the hero button (light only) | 5.09 on the hero bottom / — |

**Backgrounds**

| Token | Value | Purpose | Contrast |
|---|---|---|---|
| `--gradient-hero` | `linear-gradient(to top, color-mix(in srgb, var(--color-brand) var(--hero-mix), var(--color-bg-surface)) 0%, var(--color-bg-surface) 65%)`; `--hero-mix` is `25%` light, `35%` dark | Hero card on DS-p26-home; rises from the bottom edge, the headline sits on the plain surface. Fallback: `--color-bg-surface` | Bottom edge (worst case) light `#c8d8fa`: text-primary 12.46, text-secondary 5.29, brand 3.61. Dark `#2d4667`: text-primary 9.19, text-secondary 6.48, brand 3.78; no `--color-text-muted` on the hero |
| `--bg-dots` | `radial-gradient(circle, var(--color-border) 1px, transparent 1.5px) 0 0 / var(--space-6) var(--space-6)` | Very subtle dotted page background on DS-p26-home and DS-p26-public-status | decorative |
| `--gradient-brand-soft` | `linear-gradient(to bottom, color-mix(in srgb, var(--color-brand) var(--wash-mix), var(--color-bg-base)) 0, var(--color-bg-base) 320px)`; `--wash-mix` is `6%` light, `14%` dark | Soft brand wash at the top of DS-p26-public-status, behind the header and under `--bg-dots`. Fallback: `--color-bg-base` | Top edge (worst case) light `#ebf1fb`: text-primary 15+, brand 4.56; **no `--color-text-muted` on the wash** (4.19). Dark `#162130`: text-muted 6.33, brand 6.38 |

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
| `--text-xl` | `--font-sans` | `22px / 30px` | 700 | Large card headings where `--text-2xl` is too loud |
| `--text-2xl` | `--font-sans` | `28px / 34px`, letter-spacing `-0.02em` | 600 | Section titles on DS-p26-home; status banner headline on DS-p26-public-status (one per screen) |
| `--text-display` | `--font-sans` | `56px / 60px`, letter-spacing `-0.035em`; ≤ 640 px: `36px / 40px` | 700 | Hero headline (the one primary heading on DS-p26-home) |
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
| `--radius-md` | `6px` | Inputs, segmented controls |
| `--radius-lg` | `12px` | Cards, status banner |
| `--radius-xl` | `16px` | Hero card |
| `--radius-pill` | `9999px` | Status badges (on `--color-bg-surface`, 1px `--color-border`, icon in the status color, label in `--color-text-primary`; no tinted background, amber on its tint is < 3:1); every button, with a 1px `--color-border-strong` border |

### Borders
| Token | Value | Purpose |
|---|---|---|
| `--border-accent` | `4px` | Colored left edge of the status banner, in the current status color (≥ 3:1 on surface) |

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
