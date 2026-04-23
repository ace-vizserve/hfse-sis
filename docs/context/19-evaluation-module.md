# Student Evaluation Module

> **Status:** ✅ **MVP shipped 2026-04-22** — write-up pipeline live end-to-end. Checklists, per-subject comments, and PTC feedback deferred to a follow-up sprint (tables `evaluation_subject_comments` ship in migration 018 as placeholders; UI lands later).

## Contract

The Evaluation module owns the form class adviser's **holistic write-up per student per term** — the text that appears as "Form Class Adviser's Comments" on printed T1–T3 report cards. That's the only thing from this module that flows to the report card. Everything else (subject checklists, per-subject teacher comments, parent-teacher-conference feedback) is for PTC use only and never touches the card.

Grades come from Markbook, attendance from the Attendance module, the **virtue theme** that frames each term comes from SIS Admin (`terms.virtue_theme` edited via `/sis/ay-setup`'s term-dates dialog). Evaluation pulls the virtue theme and surfaces it as a prompt to advisers + as the parenthetical on the report card label.

T4 is explicitly out of scope — the final report card has no comments section. `/evaluation/sections/[sectionId]` filters T4 out of the term picker.

## Agreed decisions (do not re-derive)

- **`evaluation_writeups` is the sole source** of the "Form Class Adviser's Comments" field on T1–T3 report cards. `lib/report-card/build-report-card.ts` reads from it. Migration 018 one-shot-copied historical `report_card_comments` rows into `evaluation_writeups`; migration 024 dropped the legacy table (`DROP TABLE IF EXISTS public.report_card_comments CASCADE;`, applied 2026-04-23).
- **Virtue theme lives on `terms.virtue_theme`**, edited in SIS Admin. Evaluation reads it; does not write it. NULL virtue → teacher textareas disabled; registrar+ can still write (soft gate per KD #28).
- **`submitted` is a soft marker.** Advisers and registrar+ can still edit after submit. A hard lock is deliberately not implemented; revisit with Joann before formalising.
- **Teacher access is gated per-section via `teacher_assignments.role='form_adviser'`.** Registrar / school_admin / admin / superadmin see all sections (they may need to fill in if an adviser is late).
- **Autosave per keystroke** (800ms debounce), race-safe via monotonic in-flight ticks. Submit flushes any pending autosave then stamps `submitted=true` + `submitted_at`.

## Routes

- `/evaluation` — hub landing (orientation + entry links).
- `/evaluation/sections?term_id=…` — section picker. Teachers see only their form_adviser sections; registrar+ sees the full AY. Per-section progress bar (`submitted / total`).
- `/evaluation/sections/[sectionId]?term_id=…` — writeup roster for one section × term. Virtue-theme banner at top; one `textarea` + Submit per student.
- `/sis/ay-setup` — registrar sets `terms.virtue_theme` here (cross-module config, not in this module).
- `/api/evaluation/writeups` PATCH — autosave + submit in one endpoint. Body: `{ termId, sectionId, studentId, writeup?, submit? }`. Audit: `evaluation.writeup.save` on text change, `evaluation.writeup.submit` on false→true flip.

## Data model

**Ships in migration 018:**
- `terms.virtue_theme text` — per-term free-text label.
- `evaluation_terms(term_id unique, is_open, opened_at, opened_by)` — per-term open/close state. Surfaced via RPC / future UI; MVP doesn't gate on `is_open` (only `virtue_theme`).
- `evaluation_writeups(term_id, student_id, section_id, writeup, submitted, submitted_at, created_by)` unique `(term_id, student_id)` — the writeup paragraph.
- `evaluation_subject_comments(term_id, student_id, section_id, subject_id, comment)` unique `(term_id, student_id, subject_id)` — placeholder for the follow-up sprint's per-subject teacher comments. Ships now to keep migration 018 one-shot; no UI writes to it yet.

RLS on all three new tables: reads via `current_user_role() is not null`; all writes deny-all on `authenticated` (service-role-only via API routes), same pattern as migrations 004/014/015.

**Subject/level normalisation** — deviates from the spec's `subject TEXT / level TEXT` in favour of `subject_id UUID REFERENCES subjects(id)` (KD #4) for referential integrity. Applies to `evaluation_subject_comments` now; `evaluation_checklist_items` will follow when that table ships.

**Data migration (018, one-shot):** copies every `report_card_comments` row with non-empty comment into `evaluation_writeups` with `submitted=true, submitted_at=created_at`. `ON CONFLICT DO NOTHING` so re-running is idempotent.

## Access

| Role | What they can do |
|---|---|
| `teacher` (with `form_adviser` assignment) | Read + write writeups for their assigned sections only. Write-ups disabled when `virtue_theme` is NULL. |
| `teacher` (subject_teacher only) | No access to the module in MVP. (Follow-up sprint: access to the per-subject checklist + comment UI for their assigned subject × section.) |
| `registrar` | Read + write all sections. Sets virtue theme in SIS Admin. |
| `school_admin` / `admin` / `superadmin` | Read + write all sections. |
| `p-file` | No access (module switcher locked to P-Files). |
| parent | No access. |

The per-section gate for teachers is enforced both in the page RSC (`listFormAdviserSectionIds`) and again in the API route.

## Workflows

1. **Term setup** — registrar opens `/sis/ay-setup` → "Dates" on current AY → enters virtue theme per term (e.g. "Faith, Hope, Love" for T1) → saves. Audited `ay.term_virtue.update`.
2. **Adviser writing** — form adviser opens `/evaluation/sections` → picks their section → lands on the roster with virtue-theme banner + one textarea per student → types → autosaves. Clicks Submit when finalised.
3. **Registrar oversight** — registrar opens `/evaluation/sections` → sees every section's `N / M submitted` progress → opens a lagging section → can edit any writeup directly if the adviser is late.
4. **Report-card generation** — `lib/report-card/build-report-card.ts` pulls the writeup + the viewing term's `virtue_theme` and passes both through to `components/report-card/report-card-document.tsx`, which renders "Form Class Adviser's Comments (HFSE Virtues: {theme})" as the section heading.
5. **Pre-publish check** — `GET /api/sections/[id]/publish-readiness?term_id=…` returns an `evaluations` block (`total_active` / `submitted` / `drafted` / `missing[]`). Soft warning per KD #28: registrar can publish regardless.

## Out of scope (follow-up sprint)

- `evaluation_checklist_items` + `evaluation_checklist_responses` tables and the subject-teacher tick UI.
- SIS Admin checklist-items editor (per-subject × level × term topic config).
- Per-subject teacher comments (`evaluation_subject_comments` table ships, UI does not).
- `evaluation_ptc_feedback` table + registrar/school_admin PTC capture UI.
- Hard lock on Submit (whether adviser can re-edit after submit — spec open question, confirm with Joann).
- `/api/evaluation/terms/[termId]/config` PUT endpoint — for the `evaluation_terms.is_open` open/close toggle. MVP gates on `virtue_theme` presence only; the table ships empty.
- ~~Applying migration 024 to actually drop `report_card_comments`.~~ Applied 2026-04-23.
- Batch-import of prior-term writeups from the legacy Excel workbooks.

## See also

- `CLAUDE.md` KD #49 — Evaluation owns the FCA write-up.
- `CLAUDE.md` KD #28 — soft-gate pattern (no hard lock on submit).
- `CLAUDE.md` KD #4 — subject/level referential integrity via UUID FK.
- `lib/report-card/build-report-card.ts` — consumer of `evaluation_writeups`.
- `lib/evaluation/queries.ts` — read helpers.
- `app/api/evaluation/writeups/route.ts` — PATCH endpoint.
- `supabase/migrations/018_student_evaluation_mvp.sql` — schema + data migration.
