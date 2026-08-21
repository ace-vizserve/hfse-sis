<!-- Topic file for `.claude/rules/key-decisions.md`. Numbering is global; do not renumber. -->

## Markbook — SOW (fully superseded / historical audit trail only)

> ⚠ **REOPENED AS AN ASK, 2026-08-21 — not a decision, nothing built, no KD.**
> Christina asked unprompted for a teachers' dashboard covering "lesson
> planning, scheme of work and teaching and delivery matters", explicitly so a
> **substitute can see the lesson topics when a teacher is absent**. Read this
> file before responding to it: **SOW was built twice and removed both times**
> (KD #108 coordinator-authored, KD #110 teacher-owned, migrations 058–066), and
> the removal commit gives the reason — _"zero real users — HFSE teachers
> maintain their SOW in external documents; coordinators check those directly."_
> **What is new is that her version has a READER** — neither prior build did;
> both were about authoring and spot-checking. ⚠ **The adoption trap is
> unchanged:** the work falls on the subject teacher, the benefit falls on the
> substitute, and only on days somebody is sick — a stale lesson plan is worse
> than none. **Proposed alternative (ours, not her ask): a link per
> class/subject/term to where the SOW already lives**, no authoring surface.
> Full context in `docs/training/sessions/SIS-Academics-Training-Session-1-Action-Items.md`,
> _Answers received · 2026-08-21_. **Do not re-derive a SOW model from her
> message.**

### KD #108

SOW Definition/Version/Instance model (migrations 058–060) — **admin-authoring half superseded by KD #110**; infrastructure half still live. **Admin-authoring infrastructure fully removed** (migrations 062–066): `sow_subject_scopes` dropped (062); `sections.curriculum_track` + `template_sections.curriculum_track` dropped (063); `sow_class_instances.published_version_id` dropped (064); `sow_published_versions` + `get_latest_sow_published_version` RPC dropped (065); `sow_class_instances`, remaining SOW provenance columns on `evaluation_checklist_items` + `grading_sheets` dropped (066). Nothing remains of the admin-authoring model in the schema. **Original KD reasoning preserved for history**: KD #108 Sprint 40+41 implemented a 3-table admin-authoring model (Chandana edits master template → publishes immutable version → class instances bind to version). This was replaced when field investigation showed subject teachers — not coordinators — actually own the SOW (see KD #110).

### KD #110

> **SUPERSEDED (2026-06-09) — the teacher-owned SOW feature was fully removed (files deleted, routes gone).** Verified: `lib/markbook/sow.ts` does not exist; `app/(markbook)/markbook/sow/` does not exist; `app/api/sow/` does not exist; `components/markbook/sow-editor-client.tsx` and `components/sis/sow-review-table.tsx` do not exist. `POST /api/evaluation/checklist-items` returns 410 (route exists but only returns `{ error: 'Gone' }`, status 410); the per-item `PATCH|DELETE /api/evaluation/checklist-items/[id]` route file is deleted (404). The `copy-from` route is deleted (404). The SOW model below is historical — preserved for audit trail.

Teacher-owned SOW model (migration 061). Supersedes the admin-authoring half of KD #108. **Context**: field investigation of HFSE's actual workflow found that subject teachers — not coordinators — finalize the SOW (already a standard off-system format); coordinators do light random spot-checks. **Migration 061** reshapes `sow_class_instances`: drops `master_template_id`, `version_id`, `has_partial_rebaseline`; adds `ww_labels jsonb NOT NULL DEFAULT '[]'`, `pt_labels jsonb NOT NULL DEFAULT '[]'`, `topics jsonb NOT NULL DEFAULT '[]'`, `copied_from_section_id uuid`, `copied_at timestamptz`, `created_by uuid`. Re-adds unique key `(section_id, subject_id, term_id)`. `evaluation_checklist_items` re-scoped back to per-section: TRUNCATE (safe — all writes were 410'd since migration 058 per KD #108), drops `level_id + curriculum_track + sow_class_instance_id`, adds `section_id NOT NULL`, `sow_instance_id uuid` (provenance pointer). **SOW lifecycle**: (1) teacher authors at `/markbook/sow` — WW labels + page refs, PT labels + page refs, evaluation topics; OR imports from a peer section in the same `(level × subject)` which stamps `copied_from_section_id + copied_at`. (2) Grading sheet bulk-create calls `syncSowLabelsToSheet` after sheet creation (soft — logs if SOW missing, does not gate). (3) On the evaluation page when checklist is empty, teacher calls `POST /api/sow/[id]/sync-to-eval` to seed topics. Mid-term drift is fine — once seeded, teachers edit labels/topics on the operational surface. (4) Coordinator spot-checks at `/sis/admin/sow` (read-only — term + subject pickers, one row per section showing labels + topic count + provenance). **AY Readiness Pill** reduced from 5 to 4 steps (SOW step removed — no longer a hard gate). **New audit actions**: `sow.instance.save`, `sow.instance.import_from`, `sow.labels.synced`, `sow.topics.synced`. All four appear on SIS + Markbook audit logs; the last two also on Evaluation. **New lib**: `lib/markbook/sow.ts` (`listTeacherSowItems`, `syncSowLabelsToSheet`, `syncSowTopicsToChecklist`). **New API routes**: `GET|PUT /api/sow`, `POST /api/sow/import`, `POST /api/sow/[id]/sync-to-grading-sheet`, `POST /api/sow/[id]/sync-to-eval`. **Teacher surfaces**: `/markbook/sow` (index — list by level, status badge: empty/drafted/synced) + `/markbook/sow/[sectionId]/[subjectId]/[termId]` (editor). **Hard Rule #5 preserved**: "Sync labels to grading sheet" button disabled + 423 returned when sheet is locked. `sow_master_templates` + `sow_published_versions` fully removed by migrations 062–066 (see KD #108). Evaluation checklist CRUD un-410'd: `POST /api/evaluation/checklist-items` + `PATCH|DELETE /api/evaluation/checklist-items/[id]` — teacher-scoped, `section_id` from item. `copy-from` stays 410'd (copy-from now goes through SOW import, not directly between checklist rows).
