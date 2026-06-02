# Early-Bird AY Selection — Move Into Admissions

**Date:** 2026-06-02
**Module:** Admissions / SIS (early-bird AY pipeline, KD #77)
**Status:** Design — pending implementation plan

## Context

The early-bird pipeline (KD #77) lets HFSE accept applications for an upcoming
academic year before that year becomes operationally current. The flag
`academic_years.accepting_applications` (migration 038) decouples "open for
parent-portal submissions" from `is_current`.

Today the **read** surfaces live in Admissions:

- `<UpcomingAyCard>` on the `/admissions` dashboard — application counts when an
  upcoming AY is open, hidden otherwise.
- `/admissions/upcoming/applications` — the early-bird pipeline list, with an
  empty state when none is open.

But the **act of opening** an upcoming AY lives entirely in SIS Admin: the
AY-setup wizard's "Open this AY for early-bird now" checkbox and the per-row
`<AyAcceptingApplicationsToggle>` on `/sis/ay-setup`. Both Admissions read
surfaces, when nothing is open, tell the user to _leave_ and go to SIS Admin to
flip a toggle. That cross-module detour is the flow we're fixing.

Two further problems:

1. **No single-select guarantee.** Nothing stops two upcoming AYs from being
   open at once. The read helper `getUpcomingAcademicYear()` merely _copes_ by
   picking the lexicographically-largest `ay_code`.
2. **Wrong home for the decision.** Selecting the early-bird year is an
   admissions decision, not an AY-setup chore.

## Guiding principle

Admissions owns _which upcoming year is open for early-bird_. SIS Admin owns
_creating academic years_. The only time the early-bird flow sends a user to SIS
Admin is when the future year doesn't exist yet and must be created.

## Decisions (confirmed)

1. **Single-AY scope:** at most **one upcoming (non-current) AY** open for
   early-bird at a time. The active/current AY's own acceptance is a separate
   concern, untouched by the early-bird selector.
2. **Control location:** rework the existing `/admissions/upcoming/applications`
   page. The dashboard `<UpcomingAyCard>` stays a read-only signal.
3. **Role gate:** opening / switching / closing early-bird stays
   **school_admin + superadmin** (current API gate). The `admissions` and
   `registrar` roles can view the page but not flip. In practice the admissions
   managers (Chandana, Tin) are `school_admin` per KD #39.
4. **Active AY flag:** keep a **current-AY-only** toggle in SIS Admin. Remove the
   early-bird checkbox (wizard) and the per-row toggle for non-current AYs.

## Model

No schema change. `academic_years.accepting_applications boolean` stays.
"Upcoming/early-bird AY" remains `accepting_applications=true AND
is_current=false`. The novelty is _where_ the flag is set and a _single-select_
invariant enforced on the write path.

## Components & changes

### 1. Write API — enforce single-select

`PATCH /api/sis/ay-setup/accepting-applications` (gate unchanged:
`school_admin`, `superadmin`). Payload unchanged: `{ ay_code, accepting }`.

New behaviour:

- **Open a non-current AY** (`accepting=true`, target `is_current=false`):
  before setting the target true, set `accepting_applications=false` on every
  _other_ AY where `is_current=false AND accepting_applications=true`. Then set
  the target true. Guarantees ≤1 upcoming AY open.
- **Close** (`accepting=false`) or flip the **current** AY (`is_current=true`):
  plain single-row flip, no exclusion (the current AY is never in the
  single-select pool).
- The "which other AYs must close" decision is extracted into a pure helper
  (`computeEarlyBirdClosures(target, allAys)`) so it is unit-testable
  independent of the DB.
- Audit: keep action `ay.accepting_applications.toggle`. When the single-select
  rule auto-closes a prior upcoming AY, record it in `context`
  (`autoClosedPrevious: <ay_code>`); emit a separate audit row for the closed AY
  so its trail is complete.
- Cache: `revalidateTag('sis:<ay_code>')` for both the opened AY and any
  auto-closed AY.

Two sequential updates (close-others, then open-target) are acceptable given
this is a rare admin action with no real concurrency. No RPC / migration.

### 2. Admissions — rework `/admissions/upcoming/applications`

New client control `<EarlyBirdAyControl>` mounted at the top of the page. It
receives the candidate list (non-current AYs: `{ ay_code, label,
accepting_applications }`), the currently-open upcoming AY (if any), and an
`canManage` flag (`role ∈ {school_admin, superadmin}`).

Three states:

- **An upcoming AY is open** → keep today's hero + stage cards + applications
  table. Add a "Switch year" single-select (other non-current AYs) and a "Close
  early-bird" action.
- **None open, future AY(s) exist** → the empty state becomes an in-place
  picker: _"Open early-bird applications for: [pick a future year ▼] → Open."_
  Replaces today's "go to SIS Admin and toggle" copy.
- **None open, no future AY exists** → the only SIS-Admin pointer:
  _"No future academic year yet — create one in SIS Admin → AY Setup,"_
  deep-linking `/sis/ay-setup`.

When `canManage` is false, all three states render read-only (no buttons; a
short "Ask an administrator to open early-bird" note in the picker states).

Data: the page (RSC) fetches the non-current AY list via the existing
`/sis/ay-setup` query helper (`lib/sis/ay-setup/queries.ts`, which already
selects `ay_code, label, is_current, accepting_applications`) and passes it down.
`getUpcomingAcademicYear()` continues to resolve the open AY.

Mutations: `<EarlyBirdAyControl>` calls the PATCH endpoint via raw `fetch` +
`toast` (KD #24), then `router.refresh()`. On open/switch it sends
`{ ay_code: <picked>, accepting: true }`; on close `{ ay_code: <open>,
accepting: false }`. Switch is just an open of a different year — the API's
single-select rule closes the previous one.

### 3. Dashboard `<UpcomingAyCard>`

Unchanged. Remains the read-only top-of-fold signal; its footer link still
points at `/admissions/upcoming/applications`.

### 4. SIS Admin — trim to creation + active-AY only

- **AY-setup wizard** (`components/sis/ay-setup-wizard.tsx`): remove the
  `accepting_applications` checkbox. Drop the field from `AySetupSchema`
  (`lib/schemas/ay-setup.ts`) and the `accepting_applications` write from
  `POST /api/sis/ay-setup/route.ts`. Creating a year no longer touches
  early-bird.
- **AY-list row** (`components/sis/ay-setup-data-table.tsx`): render
  `<AyAcceptingApplicationsToggle>` **only when `row.is_current === true`**. For
  non-current rows, keep the read-only **"Early-bird open"** badge (so SIS still
  _shows_ which upcoming AY is open) but drop the toggle.
- `<AyAcceptingApplicationsToggle>`: now only ever drives the current AY. The
  existing close-current-AY guard copy becomes its sole path; simplify the
  component's branching accordingly. `ToggleAcceptingApplicationsSchema` stays.

## Error handling

- PATCH 404 when `ay_code` not found (existing); 400 on invalid payload
  (existing).
- Opening an AY that is already current → the API treats it as the current-AY
  flip path (no exclusion). The Admissions selector only lists non-current AYs,
  so this is not reachable from the new UI but is handled defensively.
- Empty candidate list is a first-class UI state (points to SIS Admin), not an
  error.

## Testing

- **Unit:** `computeEarlyBirdClosures` — opening a non-current AY returns the set
  of other open non-current AYs; opening the current AY or closing returns empty;
  no candidates returns empty.
- **Manual happy path:** open AY2027 → switch to AY2028 (verify 2027
  auto-closed, single open) → close (verify none open, empty-state picker
  returns) → confirm dashboard card + sidebar entry track each transition.
- **Build:** clean `next build`; CI-mirror gate (prettier/tsc/vitest/build).

## Out of scope

- The external parent-portal logic that reads `accepting_applications` (separate
  app).
- Any change to the active AY's acceptance semantics beyond keeping its SIS
  toggle.
- Cross-AY search on the early-bird pipeline (intentionally forward-only, per the
  existing page).
