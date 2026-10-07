# Grading sheet archive — design + plan

> **For agentic workers:** executed task-by-task with superpowers:subagent-driven-development.

**Decided by Mr Ace (2026-10-07/08):** three actions on a grading sheet — **Switch** (built, migration 185), **Archive** (any sheet, even with grades; every record kept; archived sheets can be viewed and restored), and **Force delete** (only possible on an ARCHIVED sheet; deletes the sheet and every record on it — "delete means delete"). Archive replaces today's "Remove sheet" (empty-only delete, KD #131 update 2026-09-29).

**Decisions made by the controller (Mr Ace: "stop asking once direction is given"):**

- Roles: archive, restore and force delete — academic_coordinator, school_admin, superadmin (the same roles as today's Remove sheet). Role-gated + audit-logged (Mr Ace's "audit over restrictions").
- Locked sheets can be archived; the confirm warns that its grades leave report cards and the Masterfile.
- One ACTIVE sheet per (term, section, subject): the unique constraint becomes a partial unique index on non-archived sheets. Restore is refused (plain English) while an active sheet exists for that class/subject/term.
- An archived sheet is invisible everywhere grades are read — report cards, Masterfile, publish readiness, dashboards, drills, at-risk, records history, awards, the best term average (KD #230), the cascade — except: the archive list, the archived sheet's own page (read-only), and audit views.
- Force delete removes, in one transaction: the sheet's `grade_change_requests` (FK cascade), `grade_audit_log` rows (FK restrict), `grade_entries`, then the sheet. Before deleting, the whole sheet (sheet row, entries, change requests, grade_audit_log rows) is snapshotted into one `audit_log` row (`sheet.force_delete`). `audit_log` rows themselves are never deleted.
- Hard Rule #6 must be reworded to allow this — `.claude/rules/hard-rules.md` needs Mr Ace's explicit OK, so the controller proposes the wording and does NOT edit it: "Grade entries and audit logs are append-only — except Force delete of an archived grading sheet, which removes that sheet's entries and grade history after snapshotting them into `audit_log`."

## Global Constraints

- Hard Rule #1: don't touch `lib/compute/quarterly.ts`, `compute_quarterly`, `grade_component_ps`, `grade_entries_derive`.
- Hard Rule #7: tokens only; existing shadcn primitives; plain-English copy for school admins.
- Migration number 186, new file. Local stack only (`npm run local:migrate`, container `supabase_db_hfse-markbook`); never production.
- Vitest `--pool=threads`; explicit vitest imports. Commit with one `git add <paths> && git commit` command, own files only.
- DataTable columns with render-function headers carry `meta.label` (KD #161).

## Task 1 — Database (migration 186) + SQL test

- `grading_sheets.archived_at timestamptz`, `archived_by uuid references auth.users(id)` (nullable).
- Replace `unique (term_id, section_id, subject_id)` (find the constraint's real name in `supabase/prod-schema.sql`) with a partial unique index `where archived_at is null`. Check every `on conflict (term_id, section_id, subject_id)` in SQL functions (e.g. `create_grading_sheets_for_*`, 083/107) and the app — an ON CONFLICT on a partial index needs the matching `where archived_at is null` predicate; fix each one so bulk create still skips existing ACTIVE sheets and is not blocked by archived ones.
- KD #230 functions ignore archived sheets: `student_best_term_average` (sources), the cascade (targets), `best_term_averages_for_sheet` unaffected. Redefine them in 186 from their LATEST definitions (183/184 as edited), adding only `and gs.archived_at is null`.
- `public.force_delete_grading_sheet(p_sheet_id uuid) returns jsonb` — security definer, search_path public, service_role only. Refuses (SQLSTATE `HFARC`, plain message) unless the sheet exists and is archived. Locks the sheet; builds the snapshot jsonb (sheet row, entries, change requests, grade_audit_log rows); deletes grade_audit_log → grade_change_requests → grade_entries → sheet; returns the snapshot + counts. The `grade_entries_audit` AFTER UPDATE trigger does not fire on DELETE; check no trigger blocks these deletes.
- SQL test `supabase/tests/grading_sheet_archive_test.sql` (BEGIN … ROLLBACK, `RAISE NOTICE 'ARC OK: …'`): archived sheet frees the slot (a new active sheet can be inserted); two active sheets for the same slot still refused; bulk create skips the active sheet and ignores archived ones; force delete refused on an active sheet; force delete on an archived sheet with entries, a change request and grade_audit_log rows removes them all and returns the snapshot; best term average ignores an archived T2 sheet.

## Task 2 — Every reader skips archived sheets

Exhaustive, not sampled: every `.from('grading_sheets')`, every embed/join of `grading_sheets` (`grading_sheets!inner`, `grading_sheet:grading_sheets(`, …), every read of `grade_entries` that is joined/filtered through sheets, and every SQL function/view that reads `grading_sheets` (grep `supabase/migrations` for the latest definition of each). ~70 reads in ~48 files in app/ + lib/. For each: add the active filter (`.is('archived_at', null)` or `archived_at is null`), or list it as an exemption with a one-line reason (archive list, sheet page, audit views, force delete, the archive/restore routes). Write the full list (filtered / exempt) into the report.

- Guard test `__tests__/grading/archived-sheet-reads.test.ts`: scans app/ and lib/ for `from('grading_sheets')` and fails when a file neither applies `archived_at` filtering nor appears in an explicit exemption list in the test — so a future reader can't forget.
- SQL views/functions that read sheets: redefine in migration 186 (Task 1's file, appended) with the filter — coordinate by appending a clearly marked section; re-apply locally.

## Task 3 — Routes

- `POST /api/grading-sheets/[id]/archive` — archive (sets archived_at/by); refuses an already-archived sheet. `logAction` `sheet.archive` with sheet labels + locked flag + counts of entries with scores.
- **Bulk** (Mr Ace, 2026-10-08: "they can bulk delete or bulk restore"): `POST /api/grading-sheets/archived/restore` and `POST /api/grading-sheets/archived/delete`, body `{ sheet_ids: string[] }` (1–200). Each sheet is processed on its own (one failing doesn't stop the rest); the response lists per-sheet results `{ id, ok, error? }`; one `logAction` row per sheet. Delete refuses any id that isn't archived. The single-sheet routes below may simply call the same code with one id.
- `POST /api/grading-sheets/[id]/restore` — refuses when not archived or an active sheet holds the slot ("This class already has an active {subject} sheet for {term}. Archive that one first."). `logAction` `sheet.restore`.
- `DELETE /api/grading-sheets/[id]` becomes **force delete**: only for archived sheets (else 409 "Archive the sheet first."), calls the RPC, `logAction` `sheet.force_delete` with the snapshot. The old empty-only delete path and `loadSheetRemovability` go (delete `lib/grading/sheet-removal.ts` and its tests if nothing else uses them; otherwise say what does).
- Add the three actions to `lib/audit/log-action.ts`, `lib/audit/humanize.ts` (plain English) and the Markbook audit-log action list; replace `sheet.delete` usages as appropriate (keep `sheet.delete` humanized for old rows).
- Same cache busting as the old DELETE. Same roles.
- Write routes that change scores/sheets (entries PATCH, totals, labels, excused, lock/unlock, switch type) refuse an archived sheet with 409 "This sheet is archived. Restore it to make changes."

## Task 4 — UI

- Sheet page: "Remove sheet" button → **Archive sheet** (outline, any sheet incl. with grades, AlertDialog: grades leave report cards/Masterfile, everything is kept, can be restored; extra warning line if locked). Replace `remove-sheet-button.tsx`.
- An archived sheet's page: read-only grid (`readOnly`), a banner "Archived on {date} by {name}" with **Restore** (outline) and **Delete permanently** (destructive, AlertDialog naming what is erased: N students' grades, change requests, grade history; typed confirmation of the subject name is NOT required — a clear destructive confirm is enough).
- **No Delete anywhere on an active sheet** (Mr Ace, 2026-10-08) — the active sheet's actions offer Archive only. Delete appears ONLY on archived sheets.
- Grading list (`app/(markbook)/markbook/grading/page.tsx`): an **Archived** view — follow the page's existing filter/tab pattern (one group at a time, never an "all" mix). In the Archived view rows are selectable (checkbox column, select-all) with a selection bar: **Restore selected** (outline) and **Delete selected** (destructive, AlertDialog stating how many sheets and that their grades, change requests and grade history are erased for good). Per-row ⋯ menu (`RowActionsMenu`) on archived rows: Open, Restore, Delete. After a bulk action, toast a summary ("3 restored, 1 couldn't be restored: …").
- Anywhere else that links to sheets and could now hit an archived one just shows the archived page.
- Read `docs/context/09-design-system.md` §7 before finishing.

## Task 5 — Docs

KD #231 in `docs/key-decisions/markbook-grading.md` (the three actions, rulings above, Hard Rule #6 wording pending Mr Ace), `docs/context/04-database-schema.md`, `docs/context/15-markbook-module.md` if it describes removal, CLAUDE.md session-context entry per `docs/rules/workflow.md`. Supersede the KD #131 2026-09-29 "Remove sheet" note. Don't edit `.claude/rules/`; put the proposed Hard Rule #6 text and the key-decisions index line in the report.

## Task 6 — Subjects get the same archive (Mr Ace, 2026-10-08: "on the sis/admin/subjects page only actions are edit and archive")

- `subjects.archived_at timestamptz`, `archived_by uuid` (migration 186, appended section).
- Subject catalog ⋯ menu (`components/sis/unused-subject-actions.tsx`, `SubjectCatalogMenu`): **Edit** and **Archive** only — no Delete. Archive works on any subject; the confirm says it leaves the catalog and every subject picker (new grading sheet, class subjects, AY setup), while classes and grades that already use it are untouched.
- Archived subjects drop out of the catalog and every subject picker/list that offers a subject for NEW use (exhaustive grep of `from('subjects')` in app/ + lib/; exempt: anything showing existing grades/report cards, which must keep showing past subjects). Same guard-test idea as Task 2 if practical.
- The catalog gets an **Archived** view (same one-group-at-a-time pattern) with selectable rows and **Restore selected** / **Delete selected**; per-row ⋯: Restore, Delete.
- Bulk routes `POST /api/sis/admin/subjects/archived/restore` and `.../archived/delete`, body `{ subject_ids }`, per-item results, one `logAction` per subject. Delete reuses the existing subject delete (`/api/sis/admin/subjects/catalog/[id]` DELETE and `lib/sis/subjects/usage.ts`): a subject any class or grade still references is refused for that item with the reason (controller ruling — deleting it would erase every class's grades in that subject across years); others are deleted with today's snapshot-into-audit behaviour.
- Audit actions `subject.archive` / `subject.restore` in log-action + humanize.
