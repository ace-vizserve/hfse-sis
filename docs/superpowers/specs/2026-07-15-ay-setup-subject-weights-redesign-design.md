# AY-Setup Workflow + Subject Weights Redesign — Design

## Context

This spec closes a loop that started as "reorder the AY-Setup checklist to match the registrar's proposed 7-step workflow" and, while tracing the real dependency graph, surfaced a genuine bug: subject weights are currently derived from **level type** (`primary → 40/40/20`, `secondary → 30/50/20`) instead of **subject identity** — which contradicts verified real data (English is 30/50/20 at every level it's taught, P1 through S4; MAPEH-family subjects are 20/60/20 everywhere). Two reference documents (grading-system v1/v2, since superseded — Markbook's grading/entry/locking/publish mechanics are explicitly **out of scope** and stay exactly as built) were used to extract two grounded, code-verified conclusions:

1. Subject weight is a property of the **subject**, not the level it happens to be taught at.
2. Sections stay the sole grading-generation unit — no multi-section combining, no cross-cutting custom cohorts (confirmed not needed at HFSE; dropped from scope).

Everything else in this spec is scoped strictly to **setup/generation** — how sections, subjects, and their weights get configured, and how that configuration turns into grading sheets. Grade entry, locking, the change-request workflow, and publish gating are untouched.

## Part 1 — AY-Setup dependency graph

The 10-item `lib/sis/readiness.ts` checklist has one gap and one false dependency, found by tracing what each step's readiness check actually queries against what the underlying action actually needs:

```
AY created
 │
 ├─→ Term dates ──→ School calendar
 │
 └─→ Grade levels   (catalog matches admissions demand — only needs the AY, not Terms/Calendar)
       │
       ├─→ Sections            (every relevant level has ≥1 section) ──→ Form advisers
       │                                                                  (every section has an adviser)
       └─→ Subject weights ──────────────────────────────────────────┬─→ Section subjects
             (per subject — see Part 2)                                    (needs BOTH sections
                                                                              AND weights)
                                                                              │
                                                                              └─→ Grading sheets

Virtue themes (needs term dates) · Report-card letterhead · Application window (optional)
  — unchanged, unordered "anytime" cluster
```

**Findings applied:**

- **Grade Levels doesn't need Terms or Calendar** — only the AY existing. It was sitting in a false chain after Calendar; it's really a sibling branch off the AY.
- **Sections and Subject Weights are true parallel siblings** — no data dependency between them, both just need Grade Levels resolved. Either can be done first.
- **"Sections" becomes its own tracked readiness step**, split out from the old "Form advisers" row — today there is no signal at all for "does an offered level even have a section yet" (it was silently folded into the adviser-coverage denominator, reading identically to "sections exist with no adviser"). `Form advisers` narrows to just adviser coverage on sections that already exist.
- **Section Subjects is a genuine fan-in** — the first node in the whole graph needing two prior branches (Sections _and_ Subject Weights) both resolved, not just one.
- **Grading sheets are generated per section**, not per level — because Section Subjects is per-section, two sections at the same level can end up with entirely different subject sets (and therefore different sheets) without ever touching the shared subject-weight config.

Resulting `ReadinessStepId` order (11 items, up from 10): `ay-setup → calendar → grade-levels → sections [NEW] → subject-weights [renamed from "classes", decoupled from section existence] → advisers → section-subjects → grading-sheets → virtue-themes → letterhead → app-window`.

## Part 2 — Subject weights: collapse to subject-scoped

### Current state (verified against code, not assumed)

- `subject_configs` is keyed `(academic_year_id, subject_id, level_id)` — a real three-dimensional key. The same subject at two levels is two independent rows; nothing keeps them in sync.
- `lib/sis/level-profiles.ts::weightProfileFor(levelType)` returns a weight purely from level type, with zero awareness of subject identity. It's used both as the SIS Admin editor's pre-fill **and** by `lib/sis/seeder/structural.ts` to bulk-generate every `subject_configs` row for every subject at every level. Concretely: today, Math, English, and MAPEH all get the _same_ weight at a given level type, which is wrong for every subject outside the accidental two-bucket overlap.
- Grading-sheet generation (`create_grading_sheets_for_scopes`, migration 060) resolves a section's subject config by joining `subject_configs` on `(sections.level_id = subject_configs.level_id AND sections.academic_year_id = subject_configs.academic_year_id)` — i.e., **level is the literal join key** for weight resolution today.
- `sync_grading_sheets_from_config` (migration 052) exists specifically to re-propagate a slot-count change from `subject_configs` onto already-created unlocked sheets — a reconciliation step that only exists because the config can silently diverge per level today.

### Target model

Split the two jobs `subject_configs` currently does into two entities:

1. **Subject weight config — subject-scoped, no level dimension.** One row per `(subject_id, academic_year_id)`: `ww_weight`, `pt_weight`, `qa_weight`, `ww_max_slots`, `pt_max_slots`, `qa_max`, `grade_type`. Same DB constraint as today (`ww_weight + pt_weight + qa_weight = 1.00`). **No auto-fill anywhere** — `weightProfileFor(levelType)` is removed from both the SIS Admin editor's pre-fill and the seeder. Whoever configures a subject's weight — a real admin, or the seeder generating test data — types (or, for the seeder, explicitly encodes per the verified real bucket for that subject) the actual split. The three buckets in the reference table (40/40/20 for Math/Science, 20/60/20 for the arts/PE family, 30/50/20 for everything else) are **known-correct starting values for the seeder to encode explicitly**, not a validation rule the UI enforces — a legitimately new weight split for a future subject is not an error.

2. **Subject-level applicability — new, lightweight join, no weight columns.** `(subject_id, level_id, academic_year_id)` — declares "this subject is part of this level's curriculum this year." This is what `template_subject_configs` / Structure Defaults edits, and what `apply_template_to_ay` carries forward each year — preserving the existing carry-forward feature (KD #66) that would otherwise be lost by dropping `level_id` from the weight table entirely. `section_subjects` (already built, migration 079) validates a section's subject picks against **this** table instead of `subject_configs`.

**Grading-sheet generation simplifies on both fronts:** weight resolves by `subject_id` alone (no more section→level→config join — `sync_grading_sheets_from_config`'s reason for existing shrinks accordingly, since there's only one weight row per subject to ever change). Eligibility (which sections get which sheets) is unchanged — still resolves through `section_subjects`, which was already correct.

### Subject → report-card mapping ("Reports to")

New many-to-many join: `subject_report_map(subject_id, report_subject_id)`. Most subjects self-map 1:1 (their own report-card column). Verified multi-subject cases from the reference table: Filipino → Mother Tongue, Mandarin → Mother Tongue.

**MAPEH is explicitly deferred, not built as a fan-out.** The reference docs describe MAPEH as one combined grading sheet whose single grade fans into four report-card slots (Music/Arts/PE/Health) — but the live subject catalog already has Music, Arts, PE, and Health as **four separate, independently-graded subjects** (migration 049), each presumably graded independently today. Whether HFSE's real process is genuinely "one combined sheet" (meaning the current build has been wrong since migration 049) or the four-separate-subjects model is actually correct needs verification with Ms. JoAnn before either is touched — that's a data-correctness question, not a UI question, and building the wrong one is expensive to unwind. **This build ships the mapping infrastructure** (the join table + UI to configure it) **seeded with 1:1 self-mappings for every existing subject** (a no-op, zero behavior change) so the mechanism exists and is usable the moment MAPEH's real structure is confirmed — but does not attempt to consolidate Music/Arts/PE/Health now.

### UI — `/sis/admin/subjects` becomes a tree, not a matrix

Replaces `SubjectConfigMatrix` (today's subject × level grid) with a tree rooted at **Levels** — same spine visual and interaction language as the Grade Levels progression tree (`components/sis/levels-manager-client.tsx`, this session), so it's a pattern the registrar has already seen, not a new one to learn.

- Each level node expands to show its attached subjects as chips (reading the new subject-level applicability table).
- **Drag a subject chip onto a level** to attach it there; drag between levels to move/add. A subject attached to zero levels sits in an "unassigned" tray — same visual language as the Grade Levels page's Smart Sync panel.
- Weight, grade type, and "Reports to" are edited **on the subject itself** (a panel/dialog opened from its chip) — once, applying everywhere that subject is attached, not per tree node.
- **"Smart" validation features (weight-bucket mismatch flags, orphaned-subject flags, rename-aware carry-forward, year-over-year diff view) are explicitly deferred out of this build.** They were scoped during design but cut to ship the core redesign first; none of them block the tree/DND/weight-collapse work and can be added later without touching the data model again.

## Verification

- Migration: new `subject_report_map` + subject-level applicability tables, `subject_configs` narrowed to drop `level_id` (or a new subject-scoped table replacing it — implementer's call on migrate-in-place vs. new table, given existing FK references from `grading_sheets.subject_config_id`). Backfill must be lossless: every existing `(subject, level)` weight collapses to one row per subject — if a subject's weight already differs across levels today (a real possibility given the level-type-default bug), the migration needs an explicit reconciliation pass, not a silent "pick one," since that's a real data question, not a mechanical transform.
- `npx tsc --noEmit`, relevant + full `npx vitest run`, Hard Rule #7 grep sweep, `npx next build` — same loop as every other change this session.
- Manual: confirm `create_grading_sheets_for_scopes`'s simplified join still produces byte-identical sheets for the current AY9999 test data as before the migration (same inserted count, same slot counts) — this is the one path where a silent regression would be expensive to catch later.
- Frontend-design pass before writing the tree UI's JSX (standing session rule — this is a genuinely new interaction context even though it reuses the Grade Levels tree's visual language, since DND-onto-a-tree-node for attachment is a different gesture than DND-for-reordering).
