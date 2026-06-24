# AY2025 Grades Backfill — Design

**Date:** 2026-06-24
**Status:** Design (decisions approved in brainstorming; pending spec review)
**Target:** AY2025 grades in **production** — so Markbook report cards (T1–T3) and the Academic Summary render complete, faithful, _issued_ grades, with WW/PT/QA component detail where available. This is the last piece of the AY2025 historical backfill (sections, roster, attendance, movements, form advisers, FCA comments, calendar, virtue themes already in prod).

**Scope:** **T1–T3 only** — the grades folder contains Term 1/2/3 grading workbooks. T4 (final/annual) component files were not provided; T4 is deferred (see Out of Scope).

---

## 1. Data reality (discovered in brainstorming — drives the whole design)

- **39 grading workbooks** (13 subjects × 3 terms), each ~24 per-section sheets, carrying raw **WW / PT / QA** components per student plus already-computed `Initial Grade` + `Quarterly Grade` (and a derived `Final Grade Equivalent` letter for non-examinable).
- **Per-sheet variation, never assumable from defaults:**
  - Weights differ **by subject**: English `30/50/20`, MAPEH `20/60/20`.
  - Max scores + slot counts differ **by level**: Primary English = 3×WW(max 10) + 5×PT(max 10) + QA(max 30); Secondary English = 3×WW(max 20) + 3×PT(max 30/30/25) + QA(max 65).
  - (AY2026 has **no** `subject_configs` either — weights aren't configured anywhere, so AY2025's are derived purely from the files.)
- **The grading files are incomplete and many-to-one vs the masterfile:**
  - **`MAPEH (PrI)` = one grade → 4 subjects** (`MUSIC`/`ARTS`/`PE`/`HE`), replicated **identically** (verified: masterfile MUSIC=ARTS=PE=HE per student).
  - **`MT` split by section:** `Mandarin` file covers only the 4 **Global** primary sections; `Filipino` covers everyone else + secondary.
  - **Secondary is streamed:** `History`→`HIST` = S1/S2; `SS & Geo`→`HUM` = S3/S4; `Economics`/`Literature` = upper secondary.
  - **Primary Social Studies (`SS`)** has masterfile grades but **no component file**.
  - **`Adjusted <section>`** = a manual **final-grade override** (raw scores unchanged, full roster — verified: only the Quarterly changed, e.g. 80→92); **`DO NOT USE <section>`** = scrapped draft.
- **The masterfile is the complete, authoritative spine:** it carries a grade for **every** (student × subject × term) — numeric for examinable, letter for non-examinable — already reflecting the Adjusted overrides. It is the same masterfile already used for the FCA-comment backfill.

## 2. Locked decisions

1. **Full detail** — store raw WW/PT/QA components.
2. **Issued grade authoritative** — the **masterfile** quarterly/letter is the _stored_ grade. Recompute from raw is a **verification signal only**; on divergence (the Adjusted overrides) the masterfile wins and the case is **flagged** for review, never silently shown.
3. **`Adjusted` > plain; skip `DO NOT USE`.**
4. **Non-examinable included** — components + the issued letter.
5. **Architecture: masterfile = spine, grading files = enrichment** (below).
6. **Fileless subjects** (primary `SS`, any uncovered secondary level/subject) — store the masterfile grade with **no WW/PT/QA breakdown** (complete card; "view scores" empty for those; honest — the components genuinely weren't provided).
7. **Mechanism: one-off importer script** — `dry-run → verification report → apply`. Loads `.env.local` itself; writes nothing until the dry-run is approved.

## 3. Architecture — masterfile spine + file enrichment

The masterfile defines _what grades exist_; the files _enrich with components where present_. Flow:

```
masterfile spine  ──►  for each (student × subject × term):
  (authoritative          • look up matching grading-file entry (subject-map + section + student)
   grade, all subjects)    • if found: attach raw WW/PT/QA + derive subject_config (weights/slots/maxes)
                           • compute Initial/Quarterly via lib/compute/quarterly.ts  → VERIFY vs masterfile
                           • store grade_entry: raw components + computed ps/ws/initial
                             + quarterly/letter = MASTERFILE (authoritative)
                           • if no file: store grade_entry with masterfile grade only (no components)
```

## 4. Components (all under `lib/sis/backfill/`, pure + unit-tested where logic-bearing)

- **`grades-masterfile-spine.ts`** — reuse the existing masterfile loader/parser to yield the authoritative `(enrolee, subjectCode, term, grade, isLetter)` for **all** subjects (the spine). Reconciliation name→canonical-enrolee reused from the FCA pass.
- **`grades-file-parser.ts`** — pure: workbook → per real sheet `{ subjectFile, level, sectionName, term, weights{ww,pt,qa}, wwMaxes[], ptMaxes[], qaMax, students:[{ index, name, ww[], pt[], qa, sheetQuarterly }] }`. Resolves `Adjusted` > plain and skips `DO NOT USE` per (subject, section). Auto-detects the header band (handles the primary "TERM 3" caps + the varying column layouts).
- **`grades-subject-map.ts`** — `(subjectFile, level, sectionName) → DB subject code(s)`: `MAPEH→[MUSIC,ARTS,PE,HE]`; `MT` via section (Global→Mandarin, else Filipino); `SS & Geo`→`SS`(primary)/`HUM`(secondary); `PE (Sec)`→`PEH`; `History`→`HIST`; etc. **Flags any file/sheet that doesn't map** (no silent drops).
- **`subject_configs` derivation** — per (subject × level) from the parsed weights/slots/maxes. One config per (subject, level, AY2025).
- **student matching** — reuse the FCA matcher (sheet name → reconciliation → canonical enrolee → roster `section_students`). Held-52 dups skip (not in roster). Cross-check against (section, index) where available.
- **compute** — `lib/compute/quarterly.ts` (canonical, Hard Rule #1 = 93) for the recompute used in verification + for storing `ps/ws/initial`.
- **writer** — `subject_configs` → `grading_sheets` (per section×subject×term, `is_locked=true`, slot maxes from the file) → `grade_entries` (raw components + computed ps/ws/initial + **masterfile** quarterly/letter). Idempotent upserts on natural keys.
- **verification** — per entry compare **recompute vs masterfile** (and vs the sheet's own quarterly). Emit a divergence report: every `recompute ≠ masterfile` (expected = the Adjusted overrides) for Joann to eyeball.

## 5. Modes

- **`dry-run`** — parse + map + match + compute + verify, then write a **report only** (per subject/term entry counts, unmatched students, **unmapped files/sheets**, the full divergence list). **Zero DB writes.**
- **`apply`** — after the dry-run is reviewed, perform the writes (subject_configs → grading_sheets → grade_entries) idempotently, then re-emit the verification summary.

## 6. Verification & error handling

- **Divergence rule:** masterfile wins; the recompute never overwrites an issued grade. Divergences are surfaced, not suppressed.
- **Confidence gate:** for examinable subjects with a component file, recompute should equal the masterfile for the **non-override** majority (target ≥ ~98%); the remainder should be the known Adjusted set — anything else is investigated before apply.
- **Sheets locked** (`is_locked=true`) — historical, immutable (Hard Rule #5 / KD #25 still apply to any future edit).
- **No silent caps:** unmapped subjects/sheets, unmatched students, and divergences are all listed in the dry-run report.

## 7. Testing

- **Unit:** `grades-file-parser` against real fixtures (primary examinable, secondary examinable, non-exam MAPEH, an Adjusted sheet); `grades-subject-map` (every file→code, incl. MAPEH→4, MT split, SS&Geo level split); the canonical `lib/compute/quarterly.ts` self-test (Hard Rule #1 = 93).
- **Integration (dry-run on prod-copy or read-only):** computed-quarterly == masterfile for the non-override majority; divergence set == the Adjusted overrides; every roster student resolved or explicitly listed.

## 8. Out of scope

- **T4 grades** — no T4 component files provided; the masterfile has T4 issued grades but importing them (masterfile-only) + the annual/GA recompute is a separate follow-up.
- Building an **in-app grades-import feature** (this is a one-off historical backfill — YAGNI).
- Provisioning the **missing AY2026 subject_configs** (separate go-live concern, flagged).
- The **52 held DIFF_SN dups** (not in roster; skip, as in the FCA pass — pending Joann's canonical picks).

## 9. Open items (resolve during writing-plans / build — not blocking the design)

- Verify exact column names + the canonical write path for `subject_configs` / `grading_sheets` / `grade_entries` (mirror the entries-PATCH compute path so stored `ps/ws/initial/quarterly` match the app's own writes).
- Confirm whether a fileless-subject `grade_entry` needs a placeholder `grading_sheet` + minimal `subject_config`, or a lighter representation.
- Settle the MT Filipino↔Mandarin per-section assignment from which file actually contains each section (don't assume from section name alone).
- Pick the primary student-match key (sheet name vs (section, index)) by testing match coverage in the dry-run.
- Confirm the secondary streaming (which levels take History vs Humanities vs Economics vs Literature) from the file sheet coverage, not assumption.
