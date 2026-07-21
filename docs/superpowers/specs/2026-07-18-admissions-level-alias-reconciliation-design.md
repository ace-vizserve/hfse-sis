# Admissions Level-Alias Reconciliation — Design

**Date:** 2026-07-18 · **Audience:** dev follow-up (implementation plan), registrar (the surface this ships)

## Problem

`class-assignment.ts::pickSectionForApplicant` — the function that auto-assigns a newly-Enrolled applicant to a section — resolves the applicant's level by looking up `application.levelApplied` (a free-text string carried on the admissions tables, KD #53) against `public.levels.label`. The only normalization today is `canonicalizeLevelLabel` (`lib/sis/levels.ts`), a fixed 10-entry digit-form → word-form map ("Primary 1" → "Primary One"). Anything else fails the lookup outright: `{ error: 'Level ${levelApplied} has no section' }`. Downstream, that applicant's `classLevel`/`classSection` never get written, which is exactly the gap `syncOneStudent` already detects and routes into the `/records/unsynced` queue (KD #90) — so today these students silently become one-off manual "Assign to a section" fixes, over and over, with no institutional memory of what the raw string actually meant.

The real-world source of this gap: HFSE's parent-portal enrollment/admissions layer carries its own `GRADE_PROGRESSIONS` naming, which includes a parallel "HFSE Global Education Programme" (GEP) track alongside the plain Primary/Secondary names, plus several Youngstarters/preschool tiers. This naming **is portal-owned and changes periodically** (confirmed by the person maintaining it) — it is not a fixed set the SIS can hardcode once and forget.

This gap was never actually built when the admissions enrollment flow was designed — this spec closes it.

**Partially-built prior art found during investigation, with no accompanying design doc:** `lib/sis/level-review.ts` (detection: scans both admissions tables for `levelApplied` values that don't match any known level, unit-tested, cached) and `lib/schemas/level.ts::LevelRemapSchema` (`{ fromLabel, toLevelId }`) both already exist, but neither is wired to any route or page — zero consumers found repo-wide. This design completes that work rather than starting over, and reuses both as-is.

## Goals

- Auto-enrollment resolves every level-name variant HFSE's admissions data actually contains, for the current fixed 10-level catalog (P1-P6, S1-S4 — migration 086).
- A naming change (next intake cycle's portal update) costs a registrar one click, never a code change or developer involvement.
- Students already stuck on an unresolved label get unblocked the moment the label is resolved — not just future applicants.

## Non-goals

- Re-adding Youngstarters/preschool levels to the SIS catalog. Migration 086 removed them because real data confirmed HFSE never operationally used them. The known preschool/K2-equivalent label variants (see Seeding below) will keep surfacing in the reconciliation queue as genuinely unresolvable — this is correct, honest behavior, not a bug. YS support is explicitly deferred to a future project; this design's mechanism will extend to it unchanged once YS levels exist again.
- Fuzzy/similarity matching. Every resolution is an exact, trimmed string match — either an alias exists or it doesn't. No heuristic guessing.

## Architecture

### 1. Schema — `level_aliases`

```
level_aliases
  id          uuid primary key default gen_random_uuid()
  raw_label   text not null          -- trimmed, unique
  level_id    uuid not null references public.levels(id) on delete cascade
  created_by  uuid null references auth.users(id)
  created_at  timestamptz not null default now()

  unique (raw_label)
```

Case-sensitive, exact-match on the trimmed string. A new casing/spacing variant of an already-known label is treated as its own distinct unmatched label with its own alias row — simple, and consistent with how the known source data is already uniformly cased.

### 2. Resolution logic — `lib/sis/levels.ts`

`canonicalizeLevelLabel` stays as-is (pure, synchronous, imported by client components — cannot become DB-backed without breaking those call sites). A new function sits alongside it:

- `resolveLevelIdFromCatalog(rawLabel, knownLevels: LevelRow[], aliases: {raw_label, level_id}[]): string | null` — pure, unit-testable without a DB. Order: (1) exact match on `knownLevels[].label`, (2) `canonicalizeLevelLabel(rawLabel)` re-checked against `knownLevels[].label`, (3) exact match on `aliases[].raw_label` → its `level_id`. Returns `null` if nothing matches.
- `resolveLevelId(service, rawLabel): Promise<string | null>` — thin async wrapper: fetches `levels` (already has `getLevelRows`) + `level_aliases`, calls the pure function above.

`class-assignment.ts::pickSectionForApplicant` swaps its current `canonicalizeLevelLabel` + direct `.eq('label', ...)` lookup for `resolveLevelId`. If it still returns `null`, behavior is unchanged from today: `{ error: 'Level ${levelApplied} has no section' }`, and the student falls into the existing `/records/unsynced` gap-detection path (KD #90) exactly as it does now.

### 3. Reconciliation queue — `/records/level-mismatches`

Modeled directly on the existing `/records/unsynced` page (KD #90) — same shape of problem (a row has a gap; staff assigns the right value; done), same registrar audience, same `ROUTE_ACCESS` tier (registrar / school_admin / superadmin). Sidebar entry sits alongside "Unsynced students" under Records → Operations, with a count badge sourced from the already-existing `countUnmatchedLevelLabels()`.

The page is a Server Component that calls the already-existing `loadUnmatchedLevelLabels()` directly (no new GET route needed — this mirrors how `/records/unsynced` itself is built). Each row shows the raw label, which AY(s) it appears in, how many applications/status rows carry it, and up to 5 sample enrolee numbers (all fields `UnmatchedLevelLabel` already returns). A level-picker (the 10 canonical levels) + "Save mapping" button per row.

### 4. Save — `POST /api/sis/level-aliases`

Body validated by the already-existing `LevelRemapSchema` (`{ fromLabel, toLevelId }`). Role gate matches the page. On success:

1. Upsert into `level_aliases` on `(raw_label)` conflict — re-saving a mapping for the same label corrects it rather than erroring. Audit-logged (new `AuditAction`, mirroring the existing `level.*` humanizer entries kept dormant per KD #153's superseded note — reuse that family rather than inventing a new one).
2. No auto-assignment step. **Superseded by `2026-07-20-manual-section-assignment-design.md`:** section assignment is registrar-manual everywhere, with no auto-pick anywhere in the system (that spec deletes `pickSectionForApplicant`'s auto-write entirely). So saving an alias only needs to make the affected students' level resolvable — any application whose `levelApplied` now resolves via the fresh alias, but which hasn't been assigned a section yet, simply becomes a normal row in `/records/unsynced` (exactly the population that queue already detects — "level known, section not yet assigned"). The registrar picks their sections through the canonical section-assignment picker, same as any other unsynced student. No retry loop, no partial-failure summary, no separate code path.

### 5. Seeding — known GEP variants

A migration pre-populates `level_aliases` from the mapping already confirmed against the parent portal's `GRADE_PROGRESSIONS`:

| raw_label (byte-exact, including dash style)                         | → level         |
| -------------------------------------------------------------------- | --------------- |
| HFSE Global Education Programme – Year 2 (equivalent to Primary One) | Primary One     |
| HFSE Global Education Programme - Primary 2                          | Primary Two     |
| HFSE Global Education Programme - Primary 3                          | Primary Three   |
| HFSE Global Education Programme - Primary 4                          | Primary Four    |
| HFSE Global Education Programme - Primary 5                          | Primary Five    |
| HFSE Global Education Programme - Primary 6                          | Primary Six     |
| HFSE Global Education Programme – Year 8                             | Secondary One   |
| HFSE Global Education Programme – Year 9                             | Secondary Two   |
| HFSE Global Education Programme – Year 10                            | Secondary Three |

Deliberately **not** seeded (no SIS-catalog equivalent — will correctly surface in the queue as unresolved, per Non-goals): the Youngstarters tier variants ("Youngstarters | Little Stars", "YoungStarter Little Star", "Youngstarters | Junior Stars", "YoungStarter Junior Star", "Youngstarters | Senior Stars", "Youngstarters") and "HFSE Global Education Programme – Year 1 (equivalent to K2)".

Plain canonical word-forms ("Primary One" … "Secondary Four") need no alias — they already match `levels.label` directly.

## Error handling

- Unresolved label → same failure as today, no behavior change; visible via both the new queue and the existing unsynced-students queue.
- Duplicate/re-save of an alias → upsert, not an error.
- Partial retry failure (some affected students still can't be assigned after the alias exists, for a reason unrelated to level naming) → explicit partial-success summary, nothing silently dropped.

## Testing

- `resolveLevelIdFromCatalog` — pure function, fully unit-tested (all three resolution tiers + the null/no-match case), no DB required.
- `diffUnmatchedLevelLabels` — already unit-tested (unchanged by this work).
- The DB-touching pieces (migration, route, retry loop) — manual verification, consistent with every other DB-backed feature in this repo (no live-DB test harness exists here).

## Open questions for the implementation plan (not blocking this design)

- Exact `AuditAction` string / humanizer label to reuse or add for `level_aliases` writes.
