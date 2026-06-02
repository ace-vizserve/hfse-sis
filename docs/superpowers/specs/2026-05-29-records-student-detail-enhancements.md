# Records Student Detail — Enrollment Record Enhancements

**Date:** 2026-05-29  
**Status:** Approved  
**Scope:** `/records/students/[studentNumber]` — three targeted additions to Placements, Academic, and Overview tabs

---

## Problem

The Records student detail page is the canonical permanent record for a student at HFSE, but it is missing information that a registrar or admissions officer expects to see in a complete enrollment record:

- Withdrawn placements show no reason for the withdrawal
- Operational placement metadata (bus, classroom officer role) is only accessible inside the edit sheet
- Academic history shows quarterly grades only — no annual overall, no General Average, no subject award tiers
- Non-examinable subjects have no annual letter grade visible
- FCA evaluation comments (the teacher's written assessment per term) are not surfaced here at all
- Document completeness requires navigating to P-Files

All the data exists in the database; it is either already fetched and not rendered, or fetchable with a small addition to the data layer.

---

## Architecture

No new routes, no new pages, no new tables. Three targeted changes:

1. **`lib/sis/records-history.ts`** — extend `getAcademicHistory` select to include `is_examinable` and `annual_letter_grade`; add new `getEvaluationWriteupsForStudent` loader.
2. **`app/(records)/records/students/[studentNumber]/page.tsx`** — UI changes in three areas. Extract sub-components where added complexity warrants it to keep the file from growing further.

Award thresholds for subject/overall awards are fetched from `school_config` (one extra query) in the RSC page and passed down as props.

---

## Section 1 — Placements tab

### 1a. Withdrawal metadata sub-row

When a placement row has `enrollment_status === 'withdrawn'` AND `withdrawal_reason !== null`, render a sub-row immediately beneath the main placement row. The sub-row spans all columns (using `colspan`) and is indented with `pl-8`. It shows:

- A `LogOut` icon (size-3, `text-muted-foreground`)
- Reason label resolved from `WITHDRAWAL_REASON_LABELS[r.withdrawalReason]` (e.g. "Family relocating")
- If `withdrawal_notes` is non-null: notes text truncated to one line with `line-clamp-1 text-muted-foreground` after a separator dot

```
↳  Family relocating  ·  Relocated to Australia in Jan 2026
```

**No sub-row is rendered** when `withdrawal_reason` is null (pre-feature withdrawals). Do not show "Reason: —".

### 1b. Operational details strip

When a placement row has `enrollment_status !== 'withdrawn'` AND at least one of `bus_no` / `classroom_officer_role` is non-null, render a compact sub-row beneath the placement row showing those values as inline chips:

```
↳  Bus 3  ·  Class Secretary
```

Each chip: `font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground`. Separator `·` between them. Skip entirely when both are null — do not render an empty strip.

### 1c. Late-enrollee term — prefer explicit override

The current logic derives the joining term from `enrollment_date` via `termForDateInPreloaded`. Change it to:

```typescript
const lateTerm =
  r.enrollmentStatus === 'late_enrollee'
    ? r.lateEnrolleTermNumber !== null
      ? {
          termNumber: r.lateEnrolleTermNumber,
          termLabel: `T${r.lateEnrolleTermNumber}`,
          isOverride: true,
        }
      : termForDateInPreloaded(r.enrollmentDate, r.ayCode, termsByAy)
        ? {
            ...termForDateInPreloaded(r.enrollmentDate, r.ayCode, termsByAy)!,
            isOverride: false,
          }
        : null
    : null;
```

When `isOverride === true`, append `(corrected)` in muted mono after the term label:

```
Late  ·  T1 (corrected)
```

**Note:** The field is named `lateEnrolleTermNumber` (one `e` in `Enrolle`) on `PlacementRow` — match that spelling exactly in the component.

### Data requirements for Section 1

All three fields (`withdrawal_reason`, `withdrawal_notes`, `bus_no`, `classroom_officer_role`, `lateEnrolleTermNumber`) are already selected in `getPlacementHistory`. No data layer changes required.

---

## Section 2 — Academic tab

### 2a. Annual overall column

Add an **Annual** column as the rightmost data column in each AY's subject grade table (after T4).

**Examinable subjects** (where `is_examinable === true`):

- Formula: `ROUND(T1×0.2 + T2×0.2 + T3×0.2 + T4×0.4, 2)` — matches `lib/compute/annual.ts::computeSubjectOverall`
- Show `—` when any of T1–T4 is null (incomplete year)
- Alongside the value, render a compact award badge: `Bronze` / `Silver` / `Gold` — styled as `font-mono text-[10px] uppercase` using the colour tokens below. Show `NE` (not eligible) when the annual is below the Bronze minimum or the year is incomplete
- Award thresholds sourced from `school_config` props passed into the component

Award badge colours (matching KD #95 / `lib/compute/awards.ts`):

```
Gold:   brand-gold background, ink text
Silver: bg-muted-foreground/20, foreground text
Bronze: brand-bronze background, ink text
NE:     bg-muted/50, muted-foreground text
```

**Non-examinable subjects** (where `is_examinable === false`):

- Show `annual_letter_grade` from the T4 grade entry: `Passed` / `UG` / `E` / `NA`
- Style as a plain `Badge variant="secondary"` — no award calculation
- Show `—` when `annual_letter_grade` is null (T4 not yet entered by registrar)

### 2b. General Average footer row

At the bottom of each AY's grade table, add a `General Average` footer row:

- Subject column: `General Average` in `font-semibold text-foreground`
- T1–T4 columns: empty
- Annual column: `ROUND(mean of all examinable subject annuals where annual is non-null, 1dp)` — computed in the RSC using `lib/compute/annual.ts::computeGeneralAverage` from the subject annual values. Displayed as `font-semibold tabular-nums`
- No award badge on the GA row
- Omit the row entirely if zero examinable subjects have a complete annual (no denominator)

Separate the footer row from the body with a `border-t border-hairline` on the row itself.

### 2c. FCA evaluation comments card

Below each AY's grade/attendance section (not inside the table), render a collapsible card showing the form-class-adviser's T1/T2/T3 writeups for that student in that AY.

**Card anatomy:**

- `CardHeader`: mono eyebrow `Form Class Adviser · {ayCode}` + serif title `Term comments`
- `CardContent`: three sections, one per term (T1, T2, T3 only — T4 excluded per KD #49)
- Each term section:
  - Eyebrow: `font-mono text-[10px] uppercase tracking-[0.14em]` → `T{n} · HFSE Virtues: {virtue_theme}` (omit the Virtues part when `virtue_theme` is null)
  - Body: writeup text in `text-sm leading-relaxed text-foreground`
  - If no writeup for that term: `text-sm text-muted-foreground italic` → "No comments recorded"

**Omit the card entirely** when all three terms have null writeups for this AY. Do not render an empty card.

### Data layer changes for Section 2

**`lib/sis/records-history.ts` — extend `getAcademicHistory`:**

The current query on `grade_entries` selects `quarterly_grade` (and implicitly joins subjects via `section_students → sections → subject_configs → subjects`). Extend to also select:

- `subjects.is_examinable` — needed to classify examinable vs. non-examinable
- `grade_entries.annual_letter_grade` — filtered to T4 rows only (or select all, filter in JS)

Extend `AcademicSubjectRow` (the per-subject type within `AcademicHistoryRow`) to include:

```typescript
isExaminable: boolean;
annualLetterGrade: string | null; // T4 row only; null for examinable subjects
```

**New loader: `getEvaluationWriteupsForStudent`**

Add to `lib/sis/records-history.ts`:

```typescript
export type EvaluationWriteupEntry = {
  termNumber: number;
  termLabel: string;
  virtueTheme: string | null;
  writeup: string | null;
};

export async function getEvaluationWriteupsForStudent(
  studentId: string,
  ayCode: string
): Promise<EvaluationWriteupEntry[]>;
```

Query:

- Join `evaluation_writeups` → `terms` (on `term_id`) → `academic_years` (on `ay_code`)
- Filter: `student_id = studentId AND academic_years.ay_code = ayCode AND terms.term_number IN (1,2,3)`
- Select: `terms.term_number`, `terms.virtue_theme`, `evaluation_writeups.writeup`
- Use `createServiceClient()` (service client, consistent with other loaders in this file)
- Return sorted by `term_number ASC`; fill missing terms with `{ writeup: null }` entries so the card always has 3 slots

**Page changes:**

In `RecordsStudentCrossYearPage`:

1. Add `school_config` query to fetch award thresholds (`subject_award_bronze_min`, `subject_award_silver_min`, `subject_award_gold_min`, `subject_award_max`) — `createServiceClient().from('school_config').select('subject_award_bronze_min, subject_award_silver_min, subject_award_gold_min, subject_award_max').eq('id', 1).single()`
2. For each AY in `academics`, call `getEvaluationWriteupsForStudent(student.studentId, ay.ayCode)` in parallel — one call per AY in `Promise.all`. Returns a `Map<string, EvaluationWriteupEntry[]>` keyed by `ayCode`.

Pass thresholds and writeup map as props to `AcademicSection`.

---

## Section 3 — Overview tab

### 3a. Document status strip

Render a compact strip between the KPI stats block and the `QuickActionsStrip`. Only shown when `currentAyDetail` is non-null (same guard as `QuickActionsStrip`).

**Derive counts from `currentAyDetail.documents`** (already fetched by `getStudentDetail`). The 13 always-applicable document slots from `DOCUMENT_SLOTS` (post-migration-050) classify as:

- **Valid**: `slot.status === 'Valid'`
- **Needs renewal**: `slot.status === 'Expired' || slot.status === 'Rejected'`
- **Missing / pending**: `slot.status === null || slot.status === 'Uploaded' || slot.status === 'To follow'`

**Renders as three inline pills** in a `flex flex-wrap items-center gap-3` row:

```
✓ 10 valid   ⚠ 2 need renewal   ○ 1 missing
```

- Valid pill: `text-brand-mint` with `CheckCircle2` icon
- Renewal pill: `text-brand-amber` with `AlertTriangle` icon — only shown when count > 0
- Missing pill: `text-muted-foreground` with `Circle` icon — only shown when count > 0
- When all 13 are Valid: collapse to a single `✓ Documents complete` mint pill

The entire strip is wrapped in a `Link` to `/p-files/[enroleeNumber]?ay={ayCode}` so clicking navigates to the full P-Files detail.

**No new query required** — `currentAyDetail.documents` already contains the full documents row.

---

## Out of scope

- Printing / PDF export of the enrollment record
- Editing data directly from this page (KD #51 — Records is read-only; editors stay in Admissions)
- Attendance drill-down (already accessible via the "Open daily detail" link in the Attendance section)
- Change request history per student
- P-Files revision history inline
- Admissions feedback ratings

---

## Hard rules confirmed preserved

- **KD #51 (Records read-only)**: no write actions added. `EnrolmentEditSheet` already exists on the page; this spec does not add new editors.
- **Hard Rule #2 (server-side compute)**: annual overall computed server-side in the RSC page (or at worst in the component with pure functions from `lib/compute/annual.ts`) — not derived client-side from raw scores.
- **Hard Rule #7 (design tokens)**: all colours use existing tokens (`brand-mint`, `brand-amber`, `brand-gold`, `brand-bronze`, `muted-foreground`). No raw hex values.
- **KD #49 (T4 excluded from FCA)**: FCA comments card only renders T1/T2/T3. T4 is never queried or displayed.
- **KD #95 (award thresholds from school_config)**: award tier computed using `school_config` values, not hardcoded thresholds.
