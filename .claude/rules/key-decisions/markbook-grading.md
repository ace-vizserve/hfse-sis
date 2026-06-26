<!-- Topic file for `.claude/rules/key-decisions.md`. Numbering is global; do not renumber. -->

## Markbook — core grading mechanics, sheet config, slot metadata, bulk lock

### KD #3

Teacher assignments in `teacher_assignments(user, section, subject, role)` — `form_adviser` or `subject_teacher`. Gates grading-sheets list + section comments.

### KD #4

Weights per `(subject × level × AY)` in `subject_configs`; Primary 40/40/20, Secondary 30/50/20; never hardcoded.

### KD #5

Max 5 WW + 5 PT slots per sheet; max 50 students per section.

### KD #6

Annual grade = `T1×0.20 + T2×0.20 + T3×0.20 + T4×0.40`, 2dp. `lib/compute/annual.ts`.

### KD #99

`sync_grading_sheets_from_config(p_config_id uuid)` RPC (migration 052b). Grading sheet `ww_totals/pt_totals/qa_total` columns are denormalized copies of subject_configs at sheet-creation time. When SIS Admin updates `ww_max_slots`, `pt_max_slots`, or `qa_max` on a `subject_config`, this RPC brings all **unlocked** sheets linked to that config into sync — locked sheets are never touched (Hard Rule #5). Resize behaviour: ww/pt arrays extended → new slots default to max score 10; truncated → trailing scores/totals dropped; `qa_total` replaced unconditionally with the new `qa_max`. Called by `PATCH /api/sis/admin/subjects/[configId]` immediately after the DB UPDATE, before the audit log write. Returns `jsonb` with `rows_synced` count for the audit trail.

### KD #105

WW/PT slot metadata extension — date administered + optional page# (migration 057). `grading_sheets.slot_labels` JSON shape migrated from bare strings to `{ label, date, page }` objects per WW/PT slot; QA stays a single nullable string. Migration 057 one-shot coerces existing string entries to `{ label: "...", date: null, page: null }`. `ActivityLabelsForm` / `LabelRow` gain 3-column layout (Description · Page # · Date administered) + "Use today" quick-button. `SlotChip` renders date + page conditionally, omitting missing fields; muted styling when label set but date not. `saveLabel` PATCH accepts `Partial<SlotMeta>` and merges server-side (field-level blur doesn't clobber other fields). `SlotMetaPatchSchema` in `lib/schemas/grading-sheet.ts`. Publish-readiness `GET /api/sections/[id]/publish-readiness` adds a `slot_dates` soft-warning block (KD #28): cross-references `grade_entries.ww_scores/pt_scores` arrays against `slot_labels` date fields; surfaced as amber `ChecklistRow` with `CalendarDays` icon in `components/admin/publish-window-panel.tsx`. **Update (2026-06-03):** that `slot_dates` publish-readiness soft-warning was **removed** from `GET /api/sections/[id]/publish-readiness` + `<PublishWindowPanel>` — administered dates are a score-record concern, not report-card-related (KD #75 audit).

**Update (2026-06-09) — slot label/date do NOT gate score-cell entry.** An earlier version of this KD stated "both `label` AND `date` must be set to unlock score cells." This gate does not exist in the code. Verified: `components/grading/score-entry-grid.tsx` line 538 — `const inputsDisabled = r.withdrawn || r.is_na || readOnly` — the only conditions that disable a `<ScoreInput>` cell are: row is withdrawn, row has `is_na` set, or the sheet is `readOnly` (locked). Slot `label`/`date`/`page` are **optional metadata** rendered in the column-header chip and on the score record; they are recommended for completeness but **do not gate score entry**. The per-cell unlock logic is unchanged from the original WW/PT/QA implementation. The prior Update (2026-06-03) line "The label-AND-date cell-unlock gate described above is unchanged" was also incorrect and is superseded by this note.

**Update (2026-06-09, pt 2) — soft "unlabeled scored slot" flag + "Ongoing" date value.** HFSE confirmed **subject teachers own both the activity labels AND the scores** (same person → no cross-role bottleneck). Decision: still **NOT a hard gate** on scoring (labels aren't report-card-rendered; hard-blocking the core action for a record-quality nicety is disproportionate; no observed evidence labels go missing) — instead a **soft signal**: a WW/PT slot with ≥1 score but **no description** is flagged in the `ScoringGuide` (`components/grading/score-entry-grid.tsx`) — the `ActivityRow` shows an amber `AlertTriangle` "Needs a label" (was muted "No label set"), and the collapsed summary appends "· N need a label". "Has a score" is computed over the **full roster** (`rows`, not `visibleRows`) so the flag doesn't flicker under filtering. Scoring is never blocked. **"Ongoing" date-administered value:** HFSE's workbook uses both real dates AND the literal "Ongoing" for the date administered, so `SlotMetaSchema.date` now accepts `'Ongoing'` OR `YYYY-MM-DD` (`lib/schemas/grading-sheet.ts`); the labels PATCH route's inline `sanitizeDate` (`app/api/grading-sheets/[id]/labels/route.ts` — note: the route sanitizes inline, it does NOT parse via `SlotMetaPatchSchema`) passes `'Ongoing'` through; the editor (`activity-labels-dialog.tsx`) gained a reusable `DateAdministeredField` (DatePicker + an "Ongoing" toggle ↔ amber pill + clear); the read-only chips already render "Ongoing" (the `formatChipDate` regex no-matches → returns the raw string). UAT note: the academics alignment doc A-06 (which says labels are optional) stays correct — labels remain optional, just now softly flagged when a scored slot lacks one.

### KD #131

Bulk manual grading-sheet lock (Sprint 57, 2026-06-06; assumptions register M5). HFSE confirmed grading sheets have due dates → keep **both** auto-lock-by-date (cron `lock-overdue`) **and** manual locking; the gap was bulk. New **`POST /api/grading-sheets/bulk-lock`** (`{ ids: string[] }`, cap 200) mirrors the single-sheet lock route exactly — same `requireRole(['registrar','school_admin','superadmin'])`, locks only the **unlocked** ids (already-locked skipped, not errored), one `sheet.lock` audit row per newly-locked sheet, `invalidateDrillTags('markbook', ay)` once; returns `{ locked, skipped }`. UI: a select column + **"Lock selected"** bulk-action-footer button on the grading list (`grading-data-table.tsx`, registrar+ only, unlocked rows only, `AlertDialog` confirm noting post-lock edits need the change-request flow). The unified `<DataTable>` shell (KD #84) gained optional `SelectionConfig.enableRowSelection(row)` (per-row gate) + `selectionResetSignal` (clears the footer after the action) — additive, existing consumers unaffected. Hard Rule #5 preserved (locking needs no approval — it ENABLES the post-lock change-request flow). No migration.
