# "To follow" document flag — design spec

**Date:** 2026-04-28
**Branch:** `feat/swap-sonner-sileo`
**Author:** brainstorming session, Amier
**Related KDs:** KD #56 (drill framework), KD #57 (layout archetypes), KD #60 (document status workflow)

## Problem

A document slot at `'To follow'` (parent acknowledged the slot but the file isn't sent yet — KD #60) is silent across every cohort surface today. The two existing document buckets in the lifecycle aggregate widget are *Awaiting document validation* (Uploaded) and *Awaiting document revalidation* (Rejected + Expired); a "promised but not delivered" slot doesn't fit either.

In the per-applicant timeline (`lib/sis/process.ts:236-264`), `'To follow'` is currently grouped with `'Valid'` as `settled`. So when admissions opens one student's profile, a slot with an open commitment looks done — even though the parent owes us the actual file.

Net effect: the team has no surface telling them *"these N students promised to send X later, chase them."*

## Goal

Make `'To follow'` a first-class action queue:

1. Surface it as a distinct bucket on the cohort lifecycle aggregate (one new flag among the existing 8).
2. Move it out of `settled` in the per-applicant timeline so single-student detail and cohort aggregate agree.
3. Promote document-action queues to top-of-fold on the three dashboards where this work happens (`/p-files`, `/admissions`, `/records`) for fast navigation.

Auto-detection of expiry (`*Status = 'Valid'` + `*Expiry < CURRENT_DATE` → `'Expired'`) is **out of scope** — separate spec.

## Non-goals

- No DB schema change. `'To follow'` is already a valid status string the parent portal writes.
- No new drill UI primitive. Reuses the universal `<LifecycleDrillSheet>` toolkit (KD #56).
- No KD #60 rewrite — that doc already describes `'To follow'` semantics; this spec just makes the value visible.
- No expiry auto-detection (separate spec).

## Design

### 1. Cohort lifecycle aggregate — new 3rd document bucket

In `lib/sis/process.ts::loadLifecycleAggregateBuckets` (around line 654-810), add a 3rd document-action bucket alongside the existing two:

| Bucket key                                  | Label                            | Severity | Counts students with ≥1 slot at… |
| ------------------------------------------- | -------------------------------- | -------- | -------------------------------- |
| `awaiting-document-revalidation` (existing) | Awaiting document revalidation   | `bad`    | `Rejected` or `Expired`          |
| `awaiting-document-validation` (existing)   | Awaiting document validation     | `warn`   | `Uploaded`                       |
| **`awaiting-promised-documents` (new)**     | **Awaiting promised documents**  | `warn`   | `'To follow'`                    |

Inserted immediately after `awaiting-document-validation` in the `buckets` array so the three queues read together.

The per-row scan (`process.ts:683-694`) gains a third flag inside the same loop:

```ts
let rowHasRevalidation = false;
let rowHasValidation = false;
let rowHasPromised = false;          // new
for (const slot of DOCUMENT_SLOTS) {
  const v = (docs[slot.statusCol] ?? '').toString().trim();
  if (v === 'Rejected' || v === 'Expired') rowHasRevalidation = true;
  else if (v === 'Uploaded') rowHasValidation = true;
  else if (v === 'To follow') rowHasPromised = true;     // new
  if (rowHasRevalidation && rowHasValidation && rowHasPromised) break;
}
if (rowHasRevalidation) awaitingDocRevalidation += 1;
if (rowHasValidation)   awaitingDocValidation   += 1;
if (rowHasPromised)     awaitingPromisedDocs    += 1;     // new
```

**Overlap is allowed** (consistent with existing pattern): a student with both an `Uploaded` slot and a `'To follow'` slot counts in both validation and promised. Per KD #56's *"orthogonal action queues"* — each is a distinct registrar action.

### 2. Per-applicant timeline rebucket

In `lib/sis/process.ts:236-264`, `'To follow'` stops being counted as `settled`. New `promised` counter, detail string updates so single-student detail agrees with the cohort flag.

Before:
```ts
let needsAction = 0; // null + Pending + Rejected + Expired
let inFlight = 0;    // Uploaded
let settled = 0;     // Valid + To follow   ← currently grouped
let blank = 0;
```

After:
```ts
let needsAction = 0; // null + Pending + Rejected + Expired
let inFlight = 0;    // Uploaded
let promised = 0;    // To follow           ← new
let settled = 0;     // Valid               ← Valid only now
let blank = 0;
```

The `formatDetail` helper in the same file drops null entries, so when `promised === 0` the segment is suppressed. Example detail strings:

- *"Status: Processing · 6/16 settled · 2 awaiting validation · 3 promised · 4 needs action"* (some promised)
- *"Status: Processing · 14/16 settled · 2 awaiting validation"* (no promised — segment omitted)

### 3. Drill plumbing

In `lib/sis/drill.ts`, one new target. Three additions, all alongside the existing `awaiting-document-validation` patterns:

| Hook                                | Addition                                                                                                              |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `LifecycleDrillTarget` union (line 674) | `\| 'awaiting-promised-documents'`                                                                                |
| `LIFECYCLE_DRILL_TARGETS` array (line 684) | Add `'awaiting-promised-documents'` after `'awaiting-document-validation'`.                                  |
| Build switch (≈ line 905)           | New `case` mirroring `awaiting-document-validation`, scanning each row's slots for `'To follow'` into a `promisedSlots: string[]` field on the row. |
| Row shape                           | Extends the base lifecycle drill row with `promisedSlots: string[]` (same pattern as the existing `uploadedSlots`).   |
| `defaultColumnsForTarget` (line 1086) | `['enroleeFullName', 'levelApplied', 'promisedSlots', 'applicationStatus', 'daysSinceUpdate']`                      |
| `lifecycleDrillHeaderForTarget` (line 1140) | `{ eyebrow: 'Drill · Lifecycle', title: 'Awaiting promised documents' }`                                      |

The drill-sheet renderer (`components/sis/drills/lifecycle-drill-sheet.tsx`) already handles `string[]` slot columns generically — the column registry resolves `promisedSlots` like the existing `uploadedSlots` / `rejectedSlots` / `expiredSlots` slot columns. No UI work expected; verify when writing the implementation plan.

### 4. Top-of-fold dashboard chase queue (3 surfaces)

#### 4a. What appears

A bundled 3-chip strip showing the document action queue:

- **Awaiting validation** (warn) — count of students with ≥1 `Uploaded` slot
- **Awaiting revalidation** (bad) — count of students with ≥1 `Rejected` / `Expired` slot
- **Awaiting promised** (warn) — count of students with ≥1 `'To follow'` slot

Each chip click opens the corresponding existing lifecycle drill (`awaiting-document-validation` / `awaiting-document-revalidation` / `awaiting-promised-documents`). Same `<LifecycleDrillSheet>` UI as today — only the title, eyebrow, and slot-list column differ. No new drill target beyond the one in §3.

#### 4b. Shared infra (single source of truth)

To prevent the 3 dashboards drifting:

- **One loader** — `lib/sis/document-chase-queue.ts::getDocumentChaseQueueCounts(ayCode)` returning `{ promised: number; validation: number; revalidation: number }`. Reuses the per-row scan helper extracted from `process.ts:664-694`. Wraps `unstable_cache` with 60s TTL and tag `sis:${ayCode}` (KD #46 cache-wrapper pattern).
- **One component** — `components/sis/document-chase-queue-strip.tsx` — three cards on a row, each: gradient icon tile (§7.4 craft) + count + label + `ChartLegendChip` severity tag, full card click-area opens the drill sheet. Follows §10 of `09a-design-patterns.md` for the chip styling.

The lifecycle aggregate widget (§1) is **untouched** — same counts, deeper context with the other 6 non-doc buckets alongside. The chase strip is a top-of-fold shortcut to the same drills, not a replacement.

#### 4c. Per-dashboard mount

| Surface         | Archetype today (KD #57) | Mount position                                                              | Notes                                                                                       |
| --------------- | ------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `/p-files`      | operational              | Inside the existing `PriorityPanel` as a second section, below "Expiring docs" | The panel becomes "Documents needing attention" with two sub-blocks. KD #31 preserved — surface is read-only chase navigation; writes still happen in `/admissions/applications/[enroleeNumber]`. |
| `/admissions`   | analytical               | New top-of-fold strip above the existing KPI grid                           | Operational accent on an analytical dashboard — see §4d.                                    |
| `/records`      | analytical               | Same pattern as `/admissions`                                               | Records mirrors admissions content; consistency wins over strict KD #57 adherence here.     |

#### 4d. Decision that bends KD #57

KD #57 classifies `/admissions` and `/records` as **analytical**. Adding an operational-flavor strip top-of-fold doesn't change the primary archetype (the KPI grid + InsightsPanel still anchor the layout), but it is a deliberate exception. Justification: the admissions team owns this chase work daily, and routing them through "scroll to lifecycle widget → click bucket → drill" loses the navigation-first framing that motivated the request. The exception is local to the document chase queue — other operational accents need their own justification.

### 5. Caching and invalidation

- New loader inherits `sis:${ayCode}` tag (KD #46), 60s TTL.
- All existing writes that already `revalidateTag('sis:${ayCode}')` (the `/api/sis/students/[enroleeNumber]/documents` PATCH route, the residence-history editor, etc.) automatically invalidate the new chase-queue counts. No new revalidation wiring.
- `process.ts::loadLifecycleAggregateBuckets` is part of the same cache scope; the aggregate widget and the chase strip stay coherent.

### 6. Verification

Manual happy-path on the seeded AY9999 (the seeder writes 1-2 `'To follow'` slots per "Processing"-stage row at `lib/sis/seeder/populated.ts:1517`):

1. `/records` and `/admissions` lifecycle widget shows 3 doc buckets — *Awaiting promised documents* present with a non-zero count.
2. Click into the bucket → drill sheet opens, rows list affected students with `promisedSlots` chips column.
3. Click into one student's profile → timeline "Documents" stage detail shows `promised` count separately from `settled`.
4. CSV export from the new drill works; UTF-8 BOM intact (KD #56).
5. Dashboard chase strip renders top-of-fold on all three surfaces (`/p-files`, `/admissions`, `/records`), counts match the lifecycle widget below, all three chips drill correctly.
6. `npx next build` clean.
7. After a `'To follow'` slot is flipped to `'Valid'` in `/admissions/applications/[enroleeNumber]`, both the lifecycle widget bucket count and the chase strip "promised" count decrement after `revalidateTag('sis:${ayCode}')`.

## Files touched (estimate)

- `lib/sis/process.ts` — extract per-row slot-scan helper; add `awaitingPromisedDocs` counter; add `promised` to per-applicant timeline; insert new bucket in the `buckets` array.
- `lib/sis/drill.ts` — extend `LifecycleDrillTarget` union, build switch, row shape, `defaultColumnsForTarget`, `lifecycleDrillHeaderForTarget`.
- `lib/sis/document-chase-queue.ts` — new file; `getDocumentChaseQueueCounts(ayCode)` loader.
- `components/sis/document-chase-queue-strip.tsx` — new file; 3-chip strip component.
- `components/sis/drills/lifecycle-drill-sheet.tsx` — verify `promisedSlots` column renders; minor column-registry tweak if needed.
- `app/(p-files)/p-files/page.tsx` — extend the existing `PriorityPanel` payload to include the chase strip as a second sub-section.
- `app/(admissions)/admissions/page.tsx` — mount the chase strip above the existing KPI grid.
- `app/(records)/records/page.tsx` — same mount pattern as admissions.
- `lib/p-files/dashboard.ts::getPFilesPriority` — extend `PriorityPayload` to carry the chase-strip data alongside the expiring-docs panel.

No DB migration. No new API route. No new dependency.

## Open questions

None at design time. The expiry auto-detection question raised during brainstorming is deferred to a separate spec.
