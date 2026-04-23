# HFSE SIS — Design System

> **Hard rule.** Every page, layout, and component must conform to this document. Enforced by `CLAUDE.md` § Hard Rule #7.
>
> **Source of truth.** All design tokens live in [`app/globals.css`](../../app/globals.css). Never redefine them in component code or a `tailwind.config.*` file — Tailwind v4 has no JS config.

---

## 1. Philosophy

**"Digital Ledger"** — institutional editorial aesthetic, corporate trust, data-first. Expansive whitespace, confidently colored, profoundly organized. Every pixel earns its place, but restraint ≠ drabness: a page with no primary color is almost certainly wrong.

The [**login page**](../../app/(auth)/login/page.tsx) is the auth-tier reference (navy brand panel + glass card). The [**dashboard home**](../../app/(dashboard)/page.tsx) is the staff-tier reference (white canvas, gradient CTAs, ink typography). Both follow the same craft standard (§7).

---

## 2. Hard rules

1. **Tokens only in `globals.css`.** Never hardcode `#rrggbb`, `oklch(...)`, `slate-*`, `zinc-*`, `gray-*`, `bg-white`, or `bg-black` in `app/` or `components/`. Exceptions are documented inline in the file (e.g. auth brand panel decorative overlays).
2. **shadcn primitives over custom wrappers.** Use `Card`, `Table`, `Field`, `Select`, `Tabs`, `Sheet`, `Dialog`, `DropdownMenu` directly. `Surface` / `PageHeader` / `PageShell` are legacy wrappers kept for backwards-compat — do not reach for them on new work. Migrate existing pages to primitives *when you touch them*, not in bulk.
3. **One primary CTA per page.** The default shadcn `Button` ships the Aurora Vault gradient + `shadow-button`. Do not re-style it per page.
4. **shadcn `Table` for numeric grids; list of `Card`s for multi-line editors.** See §6 matrix.
5. **Dark mode stays token-driven.** `.dark` overrides live in `globals.css`; components must not branch on theme.
6. **Process before code.** Every new or redesigned page follows §5 — state purpose, name the pattern, pick from §6, then build. No ad-hoc markup.

---

## 3. Tokens

All semantic shadcn tokens resolve to Aurora Vault values — legacy utilities (`bg-primary`, `text-foreground`, `border-border`) and explicit utilities (`bg-brand-indigo`, `text-ink`, `border-hairline`) render **identically**. Use either; prefer semantic for structural intent, explicit for specific scale points.

### 3.1 Color

| Semantic | Explicit | Resolved | Use for |
| -------- | -------- | -------- | ------- |
| `bg-background` / `bg-card` / `bg-popover` | `bg-white` | `#FFFFFF` | Page canvas, cards, popovers |
| `bg-muted` | — (no explicit) | `#F8FAFC` | Subtle canvas tint, table header rows (`bg-muted/40`) |
| `text-foreground` | `text-ink` | `#0F172A` | Primary text, serif headlines |
| `text-muted-foreground` | `text-ink-4` | `#64748B` | Secondary / helper text |
| — | `text-ink-2` | `#334155` | Form labels, body-prominent |
| — | `text-ink-3` | `#475569` | Body copy |
| — | `text-ink-5` | `#94A3B8` | Placeholder / muted micro-copy |
| `border-border` / `border-input` | `border-hairline` | `#E2E8F0` | Dividers, card/input borders |
| — | `text-hairline-strong` | `#CBD5E1` | Separator dots, stronger dividers |
| `bg-primary` / `ring-ring` | `bg-brand-indigo` | `#4F46E5` | Primary CTA, focus rings, active nav |
| `text-primary-foreground` | `text-white` | `#FFFFFF` | Text on primary surfaces |
| — | `bg-brand-navy` | `#0B1120` | Auth brand panel only |
| — | `from-brand-indigo-deep` | `#4338CA` | CTA gradient bottom stop |
| — | `from-brand-indigo-light` | `#5B52ED` | CTA hover gradient top |
| — | `from-brand-indigo-soft` | `#818CF8` | Progress bars, glass accents |
| — | `to-brand-sky` | `#38BDF8` | Progress bar terminal, secondary accent |
| — | `text-brand-mint` | `#A5F3B7` | Positive status on dark surfaces |
| `bg-destructive` | — | — | Errors, destructive actions |
| `bg-accent` / `text-accent-foreground` | — | `#EEF2FF` / `#4338CA` | Indigo wash for hovers, info banners |
| `bg-chart-1…5` | — | indigo/sky/mint ramp | Data viz |

**Surface levels** (depth via tonal layers, not shadows):

| Level | Token | Use |
| ----- | ----- | --- |
| 0 | `bg-background` / `bg-white` | Page canvas, modals |
| 1 | `bg-muted` | Sidebar, subtle groupings, table header rows |
| 2 | `bg-card` / `bg-white` | Data "paper" — cards, tables, forms |
| 3 | `bg-accent` | Mid-elevation containers, hover states |

### 3.2 Shadows

| Token | Use |
| ----- | --- |
| `shadow-xs` / `shadow-sm` / `shadow` / `shadow-md` / `shadow-lg` / `shadow-xl` | Standard scale — use graduated levels for hover transitions on interactive cards |
| `shadow-input` | Subtle inner lift on form inputs |
| `shadow-brand-tile` | Lockup / icon tiles (inset highlight + colored drop) |
| `shadow-button` | Primary CTA rest (embossed highlight + colored glow) — applied automatically by default `Button` |
| `shadow-button-hover` / `shadow-button-active` | CTA hover / press states — applied automatically |
| `shadow-glass-card` | Floating glass preview card on dark panels (auth only) |

### 3.3 Typography

Fonts declared in `globals.css` via `--font-sans`, `--font-serif`, `--font-mono`, exposed through Tailwind v4's `@theme inline`:

| Role | Token | Family |
| ---- | ----- | ------ |
| UI / body | `font-sans` (default) | Inter |
| Editorial / display | `font-serif` | Source Serif 4 |
| Numeric / code / micro | `font-mono` | JetBrains Mono |

**Scale** (every substantial page uses 3–4 voices):

| Voice | Pattern | Example |
| ----- | ------- | ------- |
| Eyebrow | `font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground` | "FACULTY PORTAL" |
| Hero headline | `font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]` | "Welcome back." |
| Section title | `font-serif text-xl font-semibold tracking-tight text-foreground` | Card titles |
| Stat value | `font-serif text-[32px] font-semibold leading-none tabular-nums text-foreground` | Numeric metrics |
| Body | `text-[15px] leading-relaxed text-muted-foreground` | Paragraph copy |
| Label | `text-[13px] font-medium text-foreground` | Form labels |
| Micro | `font-mono text-[10px]–[11px] uppercase tracking-wider text-muted-foreground` | Codes, IDs, trust strips |

**Rules:** base 16px body min, line-height 1.5+ for paragraphs. Use `tabular-nums` for anything numeric (grades, dates, counts, IDs). Use `font-mono` for codes and identifiers — never sans.

### 3.4 Spacing & radius

- **Vertical rhythm:** 16 / 24 / 32 / 48. `space-y-5` (20px) is the default stack gap. Between major page regions: 48. Inside cards: 16/24.
- **Radius:** `--radius: 0.375rem` → use `rounded-md` for inputs, `rounded-lg` for small cards/chips, `rounded-xl` for large cards and icon tiles.

---

## 4. Component policy

### 4.1 Always use shadcn primitives

Every UI element has a shadcn equivalent — use it. Never use raw HTML `<button>`, `<input>`, `<select>`, `<textarea>`, `<table>` when a shadcn primitive exists. If the primitive isn't installed, install it before using it (`npx shadcn@latest add <name>`).

**Currently installed** (`components/ui/`):

| Primitive | Use for |
| --------- | ------- |
| `Alert` + `AlertTitle` + `AlertDescription` | Inline banners |
| `Badge` | Status pills, counts |
| `Button` | Every clickable action — **default variant carries the Aurora Vault gradient, do not override** |
| `Card` + `CardHeader` + `CardTitle` + `CardDescription` + `CardAction` + `CardContent` + `CardFooter` | The primary container — use for stat cards, list cards, form cards |
| `Checkbox` | Boolean input |
| `DropdownMenu` + `DropdownMenuCheckboxItem` | Filter dropdowns, column toggles, overflow menus |
| `Field` + `FieldLabel` + `FieldDescription` + `FieldGroup` + `FieldSeparator` | **Every form row** — never raw `<Label>` + `<Input>` pairs |
| `Input` | Text / number / email / password fields |
| `Select` + `SelectTrigger` + `SelectContent` + `SelectItem` + `SelectGroup` + `SelectLabel` | Dropdown pickers |
| `Separator` | Visual dividers between sections |
| `Sheet` + `SheetTrigger` + `SheetContent` + `SheetHeader` + `SheetTitle` + `SheetDescription` + `SheetFooter` + `SheetClose` | Slide-in drawer for forms and side panels |
| `Sidebar` + siblings | Staff sidebar shell |
| `Skeleton` | Loading placeholders (reserve space to avoid CLS) |
| `Table` + `TableHeader` + `TableBody` + `TableRow` + `TableHead` + `TableCell` | Tabular data |
| `Tabs` + `TabsList` + `TabsTrigger` + `TabsContent` | Page-level sub-navigation, content switching |
| `Textarea` | Multi-line input |
| `Tooltip` | Short reveal-on-hover help |

**Plus `@tanstack/react-table`** for filterable/sortable/paginated tables. See §8 for the canonical wrapper pattern.

### 4.2 Legacy wrappers — avoid on new work

| Wrapper | Prefer instead | Reason |
| ------- | -------------- | ------ |
| `Surface` / `SurfaceHeader` / `SurfaceTitle` / `SurfaceDescription` | `Card` + `CardHeader` + `CardTitle` + `CardDescription` | shadcn `Card` now has `data-slot` attributes, `@container/card` queries, and `CardAction` — the wrapper doesn't |
| `PageHeader` | Inline `<header>` with the hero markup from §8 | Removes a project-specific abstraction |
| `PageShell` | Keep (thin `max-w-*` container, still useful) | — |

**Migration policy:** touch-it-when-you-touch-it. Do not mass-rewrite.

---

## 5. Page construction process

Before writing or redesigning any page, follow this six-step process. No exceptions.

1. **State the purpose in one sentence.** Who uses this page, what do they do here, what is the primary action?
2. **Name the dominant UI pattern.** One of: `auth` · `dashboard hub` · `form` · `wizard` · `data table` · `numeric grid editor` · `text grid editor` · `list-detail` · `document view`.
3. **Look up the pattern in §6.** Use the registry matrix to pick the starting component(s).
4. **If nothing fits exactly, compose from §4.1 primitives** (`Card` / `Table` / `Field` / `Select` / `Tabs` / `Sheet` / `DropdownMenu`).
5. **Last resort: custom markup.** Only when no combination of primitives works (e.g. the project-specific grading grid with Blank ≠ Zero semantics). Leave a comment explaining *why* custom.
6. **Conform to §7 craft standard.** Run through the checklist before declaring the page done.

---

## 6. Page → component matrix

The project uses **only `@shadcn`** (surveyed alternatives: `@originui`, `@kibo-ui`, `@shadcnblocks` — none justified the cost). Every page maps to a shadcn primitive, block pattern, or documented custom.

| Route | Pattern | Starting point | Notes |
| ----- | ------- | -------------- | ----- |
| `/login` | auth split | `@shadcn/login-02` shell + Aurora Vault tokens | Canonical auth-tier reference |
| `/parent/enter` | auth handoff | custom (URL fragment SSO) | Project-specific, no registry fits |
| `/` | dashboard hub | `@shadcn/dashboard-01` → `SectionCards` pattern + `Card` list | 4 stat cards up top, quick-link cards below, trust strip |
| `/admin` | dashboard hub | same as `/` | 4 tool cards in 2×2 |
| `/parent` | published report card list | `Card` list per child | Parent portal proper lives at enrol.hfse.edu.sg |
| `/account` | profile + password form | `Card` + `Field` | — |
| `/grading` | data table | `@tanstack/react-table` + `Table` + `DropdownMenu` + `Input` + `Tabs` | Canonical data-table reference — see §8 |
| `/grading/new` | wizard form | 3 `Card`s (Assignment / Score slots / Teacher) + `Field` + `Select` | One concern per card |
| `/grading/[id]` | score entry grid | **custom** `ScoreEntryGrid` | Blank ≠ Zero semantics; no registry fits |
| `/grading/advisory/[id]/comments` | text grid editor | list of `Card`s + `Textarea` | Adviser comments — one card per student |
| `/admin/sections` | list grouped by level | 3 stat cards + level containers with list rows | Summary stats clearly separated from list groups |
| `/admin/sections/[id]` | list-detail | Hero + 3 stat cards + `Tabs` (Roster / Teachers) + `Sheet` for add-student | Primary CTA "Add student" in hero actions |
| `/admin/sections/[id]/attendance` | numeric grid editor | `Tabs` term switcher + 3 stat cards + `Card`-wrapped `Table` with inline `Input` cells | Auto-save on blur per row |
| `/admin/sections/[id]/comments` | text grid editor | `Tabs` term switcher + 3 stat cards + list of `Card`s with `Textarea` | One card per student — multi-line text needs breathing room |
| `/admin/sync-students` | wizard | Step 1 action `Card` + stat cards + 2 tables | Preview → commit flow |
| `/admin/audit-log` | data table | `@tanstack/react-table` with heavy filters | Same pattern as `/grading` |
| `/report-cards` | list-detail | `Table` + publication window `Card` | — |
| `/report-cards/[studentId]` | document view | **custom** `ReportCardDocument` | Print-driven, school-specific |
| `/parent/report-cards/[studentId]` | document view | **custom** `ReportCardDocument` (shared) | Same renderer, parent-scoped fetch |

**Rules:**
1. New pages get a row in this table in the same PR that adds them.
2. Custom components require a one-line justification inline + here.
3. When a shadcn block introduces non-semantic colors on install, refactor immediately — do not ship registry defaults.

---

## 7–9. See `09a-design-patterns.md`

Sections §7 (Craft standard), §8 (Canonical patterns), and §9 (Semantic color discipline) were split into [`09a-design-patterns.md`](./09a-design-patterns.md) to keep this file scannable. Numbering is preserved across both files — external citations like `§7.6` or `§9.3` resolve in `09a`.

---

## 10. Pre-delivery checklist

Before marking a page done:

- [ ] Reviewed purpose → named pattern → picked from §6 (the §5 process)
- [ ] Seven craft standards hit (§7)
- [ ] Primary color discipline passes (§9)
- [ ] No raw `#rrggbb` / `oklch(...)` / `slate-*` / `zinc-*` / `gray-*` — grep the file
- [ ] Shared components cascade (do not re-style `Button`, `Card`, `PageHeader` per-page)
- [ ] `npx next build` compiles clean
- [ ] Manual browser smoke test at 375 / 768 / 1024 / 1440
- [ ] Keyboard-only pass: Tab order matches visual order, focus rings visible
- [ ] Empty states exist for every data-driven region
- [ ] Loading states use `Skeleton`, not spinners, when the wait exceeds 300ms and the shape is known

---

## 11. Adding a new token

If nothing in §3 fits:

1. Add the raw value to `:root` in `globals.css`. For Aurora Vault-style tokens that will be referenced by a Tailwind utility matching the shadcn shape, **use the `--av-*` prefix** to avoid self-reference cycles with `@theme inline`.
2. Add the Tailwind utility name in the `@theme inline` block: `--color-<name>: var(--av-<name>)` or `--shadow-<name>: var(--av-<name>)`.
3. **Verify** the utility compiled correctly: `rm -rf .next && npx next build`, then grep `.next/static/chunks/*.css` for the utility class and confirm it references a real value (not a circular `var()`).
4. Document the token in §3.1 / §3.2 of this file in the same PR.
5. Update `feedback_design_tokens.md` in the memory store if the token introduces a new naming convention.

Never ship a new token without the grep-and-verify step. The earlier `--shadow-button: var(--shadow-button)` incident silently compiled to an empty shadow — the build passed, the page broke.
