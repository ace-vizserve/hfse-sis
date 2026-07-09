# Year Setup tab — replace the stepper with a checklist dashboard (Approach A)

**Date:** 2026-07-08
**Status:** Shipped
**Scope:** Replace the 8-step Back/Next wizard on the Year Setup tab (`/sis/ay-setup`) with a checklist dashboard; suppress the floating readiness pill on that page; small Manage-years clean-ups.

---

## Context

The "Year Setup" tab at `/sis/ay-setup` (component `components/sis/year-setup/year-setup-stepper.tsx`) rendered an 8-step Back/Next wizard for configuring an academic year. The user found the page confusing overall. The structural problems, verified in code:

- **"Step" meant four different things on one page**: the New-AY wizard ("Step 1 of 2"), the stepper ("Step X of 8"), the floating readiness pill's dialog (8 step rows), and the static "Rollover checklist" (1–4) on the Manage-years tab.
- **Three progress widgets could disagree on screen**: the stepper rail tracked the _selected_ AY (`?ay=` param) while the floating `AyReadinessPill` (mounted by `app/(sis)/layout.tsx`) tracked the _current_ AY.
- **Wizard chrome around non-sequential work**: real setup is done out of order over weeks (set terms, wait for adviser confirmations, come back). Back/Next + "Resume" pretended it was a sequence. Half the steps (advisers, letterhead, and secondary buttons) just deep-linked away, breaking the "one place" feel.
- **The early-bird switch was unexplained**: flipping "Accepting applications" on a non-current AY silently closes any other open one (KD #118) with only a `title` tooltip.

**Approved design (user picked Approach A):** kill the stepper; the tab becomes a **checklist dashboard** — one readiness bar, 8 status rows with live data summaries and in-place actions, no step numbers, no Back/Next. The floating pill is suppressed on this page. The Manage-years tab gets two small clean-ups. All API routes, the readiness engine's semantics, role gates, and the New-AY wizard are unchanged.

Design constraints honored: `docs/context/09-design-system.md` + `09a-design-patterns.md` (read verbatim this session; frontend-design skill invoked), Hard Rule #7 tokens-only, user's aesthetic memory (data-dense, horizontal flex, solid tint status tiles, no gradient content backgrounds, no centered heroes).

## Design

**Purpose (one sentence):** a school_admin opens this tab to see what's still unconfigured for an AY and fix each item in place, in any order.
**Pattern (§5/§6):** group-container card with divided rows (§8 "Level / group container card") — a checklist, not a wizard.

### Layout

```
┌─ Tab: Year Setup ────────────────────────────────────────────────────┐
│ [AY2027 ▾] [Early bird]        Readiness ▓▓▓▓▓░░░ 5 of 7 ready      │  ← one flex row, ONE progress bar
├─ Card (gap-0 py-0) ──────────────────────────────────────────────────┤
│ ┌ CardHeader (border-b): eyebrow SETUP CHECKLIST /                   │
│ │  serif title "Getting AY2027 ready." / muted helper sentence       │
│ ├──────────────────────────────────────────────────────────────────┤ │
│ │ ✓  Term dates            4 of 4 terms dated · T1 Jan 6 – Mar 21   │ │
│ │    [mint tile]                              [Ready] [Edit dates]  │ │
│ ├──────────────────────────────────────────────────────────────────┤ │
│ │ ◔  School calendar       School days cover 3 of 4 terms           │ │  ← first incomplete row:
│ │    [amber tile]  ◀ indigo left accent  [In progress] [Generate…]  │ │    gradient Button = page's
│ ├──────────────────────────────────────────────────────────────────┤ │    only primary CTA
│ │ ○  Form advisers         12 of 31 classes have an adviser         │ │
│ │    [muted tile]                       [Not started] [Open Sections ↗]│
│ │ … (classes, grading sheets, virtue themes, letterhead)            │ │
│ ├─ divider row: mono-uppercase "OPTIONAL" ─────────────────────────┤ │
│ │ ○  Application window    Closed — parents cannot apply yet        │ │
│ │    caption: "Only one upcoming year can be open at a time —       │ │
│ │     opening this one closes any other."       [Switch]            │ │
│ └──────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

### Row anatomy (each of the 8 items)

Horizontal flex, `px-6 py-4`, in a `<ul className="divide-y divide-border">`:

- **Status tile** (left, `size-10 rounded-xl`, **solid tint wash — not gradient**, per user aesthetic memory): done → `bg-brand-mint/30 text-ink` + `CheckCircle2`; partial → `bg-brand-amber/20 text-ink` + `Clock`; not started → `bg-muted text-muted-foreground` + the item's own icon (reuse `STEP_ICONS` map from the stepper, renamed `ITEM_ICONS`).
- **Title + summary** (flex-1): `text-[14px] font-medium text-foreground` title; below it one **live-data summary line** `text-[13px] text-muted-foreground` with `tabular-nums` (this is the core upgrade — see Summary lines below). No step numbers anywhere.
- **Status badge** (§9.3 recipes, reuse the existing `StepStatusBadge` logic verbatim): mint Ready / amber In progress / secondary Not started·Optional.
- **Action** (right): the same actions the `StepPanel` switch had before, relocated into the row:
  - Term dates → `TermDatesEditor` dialog trigger.
  - Calendar → `GenerateCalendarButton` + ghost "Open calendar ↗" link.
  - Classes → `ApplyTemplateButton` + ghost "Open template ↗" link.
  - Advisers → outline "Open Sections ↗" (deep-link row: the summary carries the state so the link-away is honest).
  - Grading sheets → `GenerateSheetsDialog` trigger + ghost "Open Markbook ↗".
  - Virtue themes → `Collapsible` chevron expanding the row to the existing inline `VirtueThemesEditor` (keeps in-place editing; shows "Set term dates first" dashed note when no T1–T3 terms).
  - Letterhead → outline "Open School config ↗".
  - App window → `AyAcceptingApplicationsToggle` inline **plus a visible caption**: current AY → "Live application window for the active year."; non-current → "Only one upcoming year can be open at a time — opening this one closes any other." (fixes the silent single-select).

**Signature element — the "next up" affordance** (replaces Resume + Back/Next): the **first incomplete required row** gets a `border-l-2 border-l-brand-indigo` accent + its primary action rendered as the **default gradient Button**; every other row's actions are `outline`/`ghost`. Exactly one primary CTA per view (§9.2), and it always points at the next thing to do — sequence guidance without wizard chrome. When all required items are done, no row is accented; the header area shows a mint "All set for {AY}" badge.

### Header strip above the card

One flex row (`flex flex-wrap items-center justify-between gap-4`): left = `AyPicker` + AY status badge (reuse `STATUS_BADGE_CLASS`/`ayStatusTone`); right = the readiness bar (reuse the stepper's gradient bar markup) + `font-mono text-[10px]` "N of M ready". This is the **only** progress indicator on the page. Copy says "ready", never "steps".

### Empty state

Kept the stepper's existing "No academic year yet" empty card unchanged.

## Shipped as

- `components/sis/year-setup/year-setup-checklist.tsx` (new; `year-setup-stepper.tsx` deleted) — `bb0a5c5` "feat(sis): replace Year Setup stepper with a checklist dashboard" (adds `lib/sis/year-setup.ts::checklistSummary` + `AY_STATUS_LABEL`/`ayStatusTone`/`resolveSelectedAyCode`, plus the summary + render tests).
- `25ac5aa` "feat(sis): suppress readiness pill + explain early-bird switch on Year Setup" — `AyReadinessPill` returns `null` on `/sis/ay-setup`; `AyAcceptingApplicationsToggle` gained an opt-in `showCaption` prop (wired on the Manage-years table row); the Manage-years "Rollover checklist" reworded off "step" vocabulary into a plain bulleted list.
- Commit range: `bb0a5c5..25ac5aa` on branch `feat/year-setup-checklist`.
- Everything called out as "unchanged" above stayed unchanged: `lib/sis/readiness.ts` semantics, all `/api/sis/ay-setup/**` routes, role gates, and the New-AY wizard.
