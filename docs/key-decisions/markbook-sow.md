<!-- Topic file for `.claude/rules/key-decisions.md`. Numbering is global; do not renumber. -->

## Markbook — SOW (KD #234 is the live module; KD #108 / #110 below are history)

> ✅ **REBUILT WITH A READER, 2026-10-26/27 — KD #234 (below), on local `main`,
> not pushed; migration 198 on the local stack only.** The module is described in
> `docs/context/25-sow-module.md`. **KD #108 and #110 are the two earlier builds
> and stay as the audit trail; nothing in them is live.** The note that follows is
> how the ask arrived and why this build differs.
>
> ⚠ **REOPENED AS AN ASK, 2026-08-21 (now answered by KD #234).**
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

### KD #234

**The SOW module is rebuilt, this time with readers — 2026-10-26/27, migration 198, local stack only, not pushed.** Spec `docs/superpowers/specs/2026-10-26-sow-design.md`, plan `docs/superpowers/plans/2026-10-26-sow-module.md`, module guide `docs/context/25-sow-module.md`. Mr Ace, 2026-10-26: "go with your defaults" (spec section 10), then "each phase needs a playwright tests okay, then once passed continue to next phases until finished".

KD #108 and #110 died because nobody read the SOW; the work fell on the teacher and the benefit on nobody. This build has three readers: the **relief teacher** (this week's lesson and last week's check, on the "You're covering" panel, KD #191), the **approvers** (the four-step vetting happens in the SIS), and the **supervisor** (the subject head sees a weekly check per class and signs it). The Excel template is read in once and handed back on request, never kept in sync.

**The shape.**

- **Eight tables, all in migration 198:** `schemes_of_work`, `scheme_of_work_classes`, `scheme_of_work_weeks`, `scheme_of_work_submissions`, `scheme_of_work_checks`, `scheme_of_work_relief_notes`, `scheme_of_work_signoffs`, `subject_heads`. One SOW per academic year x term x subject x level (unique on term, subject, level). Writes go through service-role routes that check the caller's assignment; the tables are closed to the browser.
- **Approval is the existing engine (KD #196)** as a new staged flow, `markbook.scheme_of_work`: Subject head, OIC (per half, `applies_to_level_type`), Assistant Principal, AEB. Steps are configuration; nobody is seeded.
- **A third resolver, `subject_head`.** `approval_stages.resolver` now allows `named | form_adviser | subject_head`. A subject-head step holds no approver rows; when a SOW is sent the step is **materialised as a frozen named pool** from `subject_heads` for that subject and level type, exactly like a named step. A change to the setting re-points waiting steps through `approval_repoint_request_stage`, matched on `config_stage_id`, excluding only the filer.
- **One submission per send.** `approval_requests` is unique on (flow, subject_type, subject_id), so each send makes a `scheme_of_work_submissions` row and that row is the request's subject. A return ends that request; **Send for review again restarts at step 1** with a new submission. Rounds are kept as history.
- **The approved snapshot** (`approved_snapshot`) is the plan in force. The relief page, the weekly checks, copy-from-last-year and grading-sheet warnings read it, not the working copy. A reopened SOW is back in draft but its last approved plan stays in force until the revision is approved.
- **Weekly checks are append-only, newest wins** (like `attendance_daily`): `as_planned | adjusted | delayed | extra`, a note required unless `as_planned`. **A sign-off closes a week for that class**: checks recorded after the newest `signed` row are ignored on every read, and a new check on a signed week is refused with 423.
- **One relief note per teacher, class, subject and day** (unique index in 198, written as an upsert). A note saved on a weekend or a break attaches to the latest started week.
- **Oversight is one level at a time**, filtered on the server, never "All" (Mr Ace's long-scroll rule); the SOWs tab defaults to the first non-empty status.
- **Audit actions** use the `sow.` prefix (mapped to Markbook): create, import, edit, submit, vet, approve, return, reopen, check, relief_note, sign, ask, subject_head.set.

**Rulings made while building (every one is the module's behaviour).**

- A SOW write is admitted for `teacher`, `academic_coordinator`, `school_admin` and `superadmin` at the route, and the **substantive-assignment check decides** (Mr Ace 2026-08-28: any role can be a teacher). An office user who also teaches can write their own subject's SOW; the office role alone cannot.
- `subject_configs` has no level column. "A subject is offered" means a `subject_configs` row for the AY **and** a `subject_level_offerings` row for the level.
- "Last year" is the next-lower `ay_code`.
- My schemes of work shows a SOW's **saved** classes. A teacher's own classes not on it are listed in a note.
- **Sending is refused (422) while surplus weeks copied from last year remain.** The teacher merges or deletes them first.
- A Return needs a note of at most 300 characters (the engine's `decision_note` cap). Validation errors (400) come before 404 / 403 / 423 / 409.
- A step with nobody on it **stalls loudly** ("Waiting, nobody is set for Subject head yet"), never skips. A form-adviser step on this flow is refused (a SOW has no section).
- Field caps: hours per week 300, textbook pages 500 (the import and the edit form share them), weekly-check note and supervisor remarks 1000 typed characters, import accepts at most 60 weeks.
- The template's single "activities / assessment" column imports into **activities**; assessment stays for the teacher.
- Adding `markbook.scheme_of_work` to `STAGED_APPROVAL_FLOWS` makes the readiness surfaces report it unconfigured until steps are set. That is true, and only local until go-live.
- The SOW page uses the app's vertical `ApprovalStepRail` in a side card (the same rail every approval flow shows), not the mockup's horizontal strip.
- The home to-do reads "Schemes of work to review" plus a count. The Classroom home strip shows only for the `teacher` role.
- An overseer (a subject head, an approver, an office role) can **read** a SOW inside their oversight scope; only the subject head signs. The nav item shows to office roles; subject heads and approvers reach oversight through links.
- Grading-sheet creation **warns, never blocks**, when a class has no approved SOW (spec section 7).
- `xlsx` stays on 0.18.5. The advisories are fixed only on SheetJS's own CDN tarball, and swapping the package source changes the supply chain for every Excel feature in the app. The import is bounded (`sheetRows`, formulas / HTML / styles off, bounded loops, week cap, Content-Length precheck). **Mr Ace's call.**

**Fixed after the whole-branch review (2026-10-27, migration 198 amended in place, local only).**

- `subject_heads.subject_id` **cascades** (a head of a deleted subject means nothing); `schemes_of_work` and `scheme_of_work_relief_notes` stay restrict, and Subject Setup's delete refuses (409) a subject either uses, before deleting anything.
- Deleting a section is refused (409) while it is on a SOW or has checks, relief notes or sign-offs, before its grading sheets are touched.
- **A week cannot change once its SOW left draft, even in a race:** a trigger on `scheme_of_work_weeks` (update/delete) reads the parent `for share` and raises SQLSTATE 55000 when it is in review or approved; `lib/sow/edit.ts` answers it with the 423. A trigger, because supabase-js has no transactions and a re-read leaves the same gap.
- "Approved" is `approved_snapshot is not null` everywhere, copy-from-last-year included (a reopened SOW still copies).
- The Excel import limit is **4 MB** (Vercel's request body limit is 4.5 MB).
- A subject head whose account was deleted or switched off counts for nothing: left out of the readiness count, the filed pool and the re-pointed pool. An empty staff list is treated as a failed read, never as "nobody".
- **No track (2026-10-28, Mr Ace, migration 200).** 198 first keyed a SOW by subject x level x track (`sections.class_type`, Standard / Global). The school never split it that way — its SOW is one workbook per subject per term, one tab per level — so migration 200 dropped `schemes_of_work.track` and made the key (term, subject, level). The class picker offers every section of the level whatever its class type. 200 stops with the clashing keys rather than deleting a scheme if two would collide (none existed; 198 was on the local stack only).

**Out, deliberately:** a separate lesson-plan document, any student or parent view, linking SOW assessments to grading-sheet slots, storing the Excel file, a version-history screen, and any outside planner (the Flourish meeting never happened).

**Gates.** `e2e/sow/phase-1..5.local.spec.ts` and the full walk `e2e/sow/sow.local.spec.ts`, all run by `npm run e2e:sow` against the local stack.

⏳ **Before go-live:** apply migrations 198 and 200 to production **before** deploying; set the subject heads and the SOW approval steps in production SIS Admin; the `xlsx` advisories are Mr Ace's call; tell teachers which term starts it. Still needs its row in `.claude/rules/key-decisions.md` (topic table and quick lookup), which needs Mr Ace's approval.
