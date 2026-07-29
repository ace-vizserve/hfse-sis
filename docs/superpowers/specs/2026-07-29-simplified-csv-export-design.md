# Simplified CSV export — design

**Date:** 2026-07-29
**Status:** approved, ready for planning

## Problem

The CSV export is too comprehensive. Every table that passes `csv` to the shared `<DataTable>` shell gets the same 1109-line export sheet with five sections — _Rows to export · Columns (searchable checklist) · Selected columns (drag-reorder) · Filters · Sort export by_ — regardless of whether that table has anything to configure.

Measured across the codebase: **16 tables export CSV, and all 16 render the identical sheet**, because the shell mounts `<DataTableExportSheet>` whenever `csv` is present (`components/ui/data-table/index.tsx:530`, `:748`). The content that justifies the sheet exists on almost none of them:

| Extra export payload             | Tables                                                               |
| -------------------------------- | -------------------------------------------------------------------- |
| Raw DB column loader + extras    | 1 — `components/sis/student-data-table.tsx`                          |
| Extras only                      | 1 — `app/(markbook)/markbook/grading/requests/my-requests-table.tsx` |
| Nothing beyond on-screen columns | **14**                                                               |

So on 14 tables the sheet presents five sections to accomplish something with exactly one possible answer: "export these columns."

### A rule that was considered and rejected

An earlier framing was: tables backed by a **single** DB table export all columns; tables backed by **multiple** tables export what's on screen. A classification pass over all 16 killed it — **15 are JOIN or COMPOSITE; exactly one is SINGLE** (the attendance audit log, `app/(attendance)/attendance/audit-log/page.tsx:91`, and even that enriches `actor_display` from the Auth staff list rather than a DB column). That one uses an explicit column list, so "all columns" would need a new fetch, and would add `actor_id`/`entity_id` — internal UUIDs of no use to a school admin.

Worse, the rule inverts: `student-data-table` is COMPOSITE (`_enrolment_applications` × `_enrolment_status` merged in JS at `lib/sis/queries.ts:115-205`), so the rule would restrict it to on-screen columns — yet it is the **only** table that already has working "load every database column" machinery.

The operative question is therefore not _how many DB tables back this view_ but **does this table have a defined "full" set beyond what is on screen** — which in this codebase is true for exactly one component.

## Design

### 1. The 15 other tables — instant download

Clicking **Export CSV** downloads immediately. No sheet.

File content is **unchanged from today's untouched export**: the export-eligible visible columns in screen order, plus any extras flagged `defaultChecked`, for the rows in the current filtered/sorted view. This is exactly the seed the sheet computes today (`export-sheet.tsx:284-300`), so only the ceremony is removed, not the output.

The **Columns visibility menu becomes the column picker** — to include a hidden column, unhide it and export. This is only viable because KD #161 (2026-07-29) made that menu readable; before it, entries read `levelLabel` and `fcaName`.

Consequences accepted:

- The 3 tables that hide columns by default (`outdated-applications-table`, `all-publications-overview`, `feedback-table`) require an unhide before those columns can be exported.
- The 2 tables with row selection (`cohort-table`, `document-completeness-table`) lose the explicit "selected vs filtered" radio. Behaviour is inferred: **if rows are ticked, export those; otherwise export the filtered view.**
- `my-requests-table` is safe under instant download — all 6 of its extras are `defaultChecked: true`, and they exist precisely to replace its 5 `excludeFromExport` on-screen columns, so the curated set still lands.

### 2. `StudentDataTable` — one small choice

A compact sheet: a row count ("N rows will be exported", so the user can see the current filter is respected), a single radio group, and a Download button.

| Option                           | Columns exported                                             |
| -------------------------------- | ------------------------------------------------------------ |
| **What's on screen** _(default)_ | the visible export-eligible columns                          |
| **Full application record**      | every column of `ay####_enrolment_applications`              |
| **Full record + pipeline**       | the above **plus** every column of `ay####_enrolment_status` |

Option 3 exists because the funnel data lives on the status side — `applicationStatus`, the 9 stage statuses and their `*UpdatedDate`s, `enroleeType`, `enrolmentDate`, the assessment grades (KD #59, KD #62). Exporting `_enrolment_applications` alone silently drops every pipeline column the user can see on screen.

**No new backend.** Options 2 and 3 reuse `POST /api/sis/students/raw-columns` exactly as-is: `select('*')` per source, chunked at 300 keys to stay under PostgREST's `.in()` URL ceiling, role-gated to `['admissions','academic_coordinator','school_admin','superadmin']`, rate-limited, `Cache-Control: private, no-store`, and scoped to only the row keys in the current export — never a whole AY.

**Applies to both `/admissions/applications` and `/records/students`.** Both pass `ayCode` and share the component, so the `rawColumns` config is already present on both; special-casing admissions would be more code, not less.

**Delete the 8 `extraColumns`** on `student-data-table.tsx` (`enroleeType`, `enrolmentDate`, `assessmentStatus`, `assessmentGradeMath`, `assessmentGradeEnglish`, `contractStatus`, `feeStatus`, `registrationStatus`). All 8 are `_enrolment_status` columns fully superseded by option 3; they are `defaultChecked`-less today so option 1 never included them. Leaving them would offer the same data twice under two names.

### 3. Removed

From `components/ui/data-table/export-sheet.tsx` (currently 1109 lines):

- the searchable column checklist
- the drag-reorder "Selected columns" pane
- the mirrored **Filters** block (search + facets duplicated inside the sheet)
- the **Sort export by** picker
- the **Rows to export** radio

Retained: the `keyOf` + `sources` raw-column plumbing (options 2 and 3 run on it), `CsvConfig.extraColumns` as a shell capability (`my-requests-table` still uses it), and `meta.excludeFromExport`.

### 4. Types and shell

- `CsvConfig` keeps `filename`, `extraColumns`, `rawColumns`.
- The shell's Export CSV button branches: if `csv.rawColumns` is present, open the small sheet; otherwise download immediately.
- Headers resolve through `resolveColumnDefLabel` (KD #161) for on-screen columns and `humanizeFieldName` for raw DB columns — both already exist.

## Testing

- Rewrite `__tests__/ui/data-table-export-sheet.test.tsx` to the new surface.
- Instant download: clicking Export CSV on a table without `rawColumns` produces the expected header row and opens no dialog.
- Selection inference: with rows ticked, only those rows export; with none ticked, the filtered view exports.
- Each of the 3 `StudentDataTable` options produces its expected header set; options 2 and 3 call the raw-columns fetch with the in-scope keys only.
- Existing coverage to preserve: `excludeFromExport` columns stay out of the file; `defaultChecked` extras stay in.

## Out of scope

- Any change to `POST /api/sis/students/raw-columns` or its role gate.
- Server-side/streaming export for large row counts — current exports are client-side over rows already in memory.
- `components/dashboard/drill-down-sheet.tsx`, which has its own separate CSV path.
- Adding a raw `select('*')` path to tables that lack one today.
