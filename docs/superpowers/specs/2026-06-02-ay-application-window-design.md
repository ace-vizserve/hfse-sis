# AY Application Window — SIS Admin Owns It, Admissions Reads It

**Date:** 2026-06-02
**Module:** SIS Admin (owner) + Admissions (read-only consumer) — early-bird AY pipeline (KD #77)
**Status:** Design — pending implementation plan

## Context

Earlier today we shipped a feature that put the early-bird open/switch/close
**control inside Admissions** (`/admissions/upcoming/applications`), with SIS
Admin reduced to a current-AY-only toggle. On reflection that inverted the
project's own architecture rule: **KD #48 — "SIS Admin is the central config
surface; operational modules consume config, they don't define it."** Admissions
deciding which AY is open broke that boundary.

This design relocates the application-window control **back to SIS Admin** and
makes Admissions a **read-only consumer** of AY state. The single-select engine
built earlier today (`computeEarlyBirdClosures` + the accepting-applications
PATCH route + the rollover behaviour we agreed) is **reused, not discarded** —
only the control surface moves.

## Mental model (confirmed)

Two independent booleans on `academic_years`:

- `is_current` — the one operational year (exactly one true).
- `accepting_applications` — the parent portal takes submissions for this year.

> **An AY accepts applications iff it is the active year OR it is the single
> upcoming year opened for early-bird.**

| `is_current` | `accepting_applications` | Meaning                                                         |
| ------------ | ------------------------ | --------------------------------------------------------------- |
| ✅           | ✅                       | Active year, taking applications (the default after activation) |
| ✅           | ❌                       | Active year, window manually closed                             |
| ❌           | ✅                       | Early-bird — one future year taking applications ahead of time  |
| ❌           | ❌                       | Created-but-dormant, or a retired year                          |

## Decisions (confirmed)

1. **SIS Admin owns all writes** to AY window state: create AYs, switch active,
   and open/close early-bird.
2. **Switching active** sets the new current year `accepting_applications=true`
   and the outgoing year `accepting_applications=false` ("close the old window").
   The `false` half is a correctness requirement: otherwise the retired year
   still satisfies `accepting=true AND is_current=false` and would be mistaken
   for the early-bird "upcoming" year by `getUpcomingAcademicYear()`.
3. **Early-bird is single-select** among non-current AYs (at most one open),
   enforced server-side via the existing `computeEarlyBirdClosures` + PATCH
   route.
4. **Admissions is read-only** on AY window state — it shows which year is open
   and lists that year's applications, but cannot open/switch/close.
5. **Switch-active readiness warning** (soft, non-blocking): if the target AY
   has 0 sections, the confirm dialog warns that operational modules will be
   empty until classes are added. Activation still proceeds.
6. **Toggle UI is a shadcn `Switch`** with a descriptive label, not an
   icon-button.

## Components & changes

### 1. SIS Admin — switch-active rollover behaviour

`PATCH /api/sis/ay-setup` (the switch-active handler; gate unchanged
school_admin+superadmin, confirm-code unchanged). After the existing `is_current`
flip succeeds, also:

- set `accepting_applications = true` on the new current AY;
- set `accepting_applications = false` on the previously-current AY (`prevAy`,
  already captured by the handler).

Both are best-effort UPDATEs logged in the existing `ay.switch_current` audit
context (add `accepting_opened: <newAy>`, `accepting_closed: <prevAy>` keys).
Add `revalidateTag('sis:<ay>')` for both AYs (the handler already revalidates
the target and prev). Document the non-transactional convergence note (mirrors
the sibling accepting-applications route).

### 2. SIS Admin — per-row "Accepting applications" Switch

Rebuild `components/sis/ay-accepting-applications-toggle.tsx` as a shadcn
**`Switch`** (`components/ui/switch.tsx` already exists) with a descriptive
inline label ("Accepting applications") and a one-line helper ("Parents can
submit applications for this year."). Same endpoint
(`PATCH /api/sis/ay-setup/accepting-applications`), same optimistic flip +
`router.refresh()`.

In `components/sis/ay-setup-data-table.tsx`, render this Switch on **all** rows
again (reverses today's current-AY-only restriction):

- **Current AY row:** Switch reflects the flag (on by default after activation);
  may be toggled off to close the active year's window.
- **Non-current AY rows:** the Switch opens early-bird for that year. The PATCH
  route's single-select rule auto-closes any other open upcoming AY, so turning
  one on visually turns the others off after `router.refresh()`.

The status-column "Early-bird open" badge (`accepting_applications && !is_current`)
stays as-is.

### 3. SIS Admin — switch-active readiness warning

In the switch-active confirm dialog (in `ay-setup-data-table.tsx`), when the
target row's `counts.sections === 0`, render an amber `Alert`/note:
_"AY{code} has no classes set up yet — Markbook, Attendance and Records will be
empty until you add sections in AY Setup. You can still activate."_ Non-blocking;
the confirm-code field and Confirm button remain enabled. `counts.sections` is
already on the row (`AcademicYearListItem`).

### 4. Admissions — make `/admissions/upcoming/applications` read-only

- Remove the `EarlyBirdAyControl` open/switch/close actions. Delete
  `components/admissions/early-bird-ay-control.tsx` (its single caller is this
  page).
- Replace it with a small **read-only** indicator: when an early-bird AY is
  open, show _"Early-bird open for {label} · managed in SIS Admin"_ (a Badge +
  muted line, optionally linking school_admin+ to `/sis/ay-setup`). Keep the
  existing stage cards + applications table for the open AY (unchanged).
- Empty state (no early-bird open): read-only copy — _"No early-bird year is
  open. An administrator can open one in SIS Admin → AY Setup."_ (no picker).
- The page stays viewable by admissions/registrar/school_admin/superadmin; it no
  longer needs `canManage` or the candidate list.
- Remove `listSelectableAcademicYears` from `lib/academic-year.ts` if Admissions
  was its only consumer (confirm with a usage search; the SIS table uses
  `listAcademicYears`, not this helper).

### 5. Reused unchanged

- `lib/sis/early-bird.ts::computeEarlyBirdClosures` + its tests.
- `PATCH /api/sis/ay-setup/accepting-applications` (single-select enforcement) —
  now invoked by the SIS Switch instead of the Admissions control.
- `getUpcomingAcademicYear()` — the read helper Admissions uses.

## Error handling

- Switch Switch failures → `toast.error`, revert optimistic state (same as
  today's toggle).
- Switch-active route partial failure (non-transactional) → 500; re-running
  converges (documented).
- Readiness warning is advisory only; never blocks.

## Testing

- **Unit:** `computeEarlyBirdClosures` tests already cover single-select; no new
  pure logic. (The rollover accepting flips live in the route — integration,
  verified manually.)
- **Manual happy path:**
  1. Create AY2027 (inactive, not accepting).
  2. SIS AY table: toggle AY2027's "Accepting applications" Switch on → it's the
     early-bird year; toggling AY2028 on closes AY2027 (single-select).
  3. Admissions `/admissions/upcoming/applications` shows AY2027 read-only +
     pipeline; no open/switch/close buttons; admissions-role user sees the same.
  4. SIS: switch active to AY2027 → AY2027 becomes current with Switch on;
     previously-current year's Switch goes off; Admissions early-bird page now
     shows "no early-bird open".
  5. Switch-active to an AY with 0 sections → amber readiness warning shows;
     activation still allowed.
- **Gate:** prettier / tsc / vitest / next build all clean.

## Out of scope

- Parent-portal behaviour (external app): which year an applicant can pick is the
  portal's logic reading these flags.
- Any schema change (none needed).
