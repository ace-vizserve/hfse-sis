# Records Student Detail — Enrollment Record Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance the Records student permanent-record page to surface withdrawal reasons, operational placement metadata, annual grades + GA + subject award tiers, FCA evaluation comments, and a document status strip — all data that a registrar or admissions officer expects to see in a complete enrollment record.

**Architecture:** Two data-layer changes in `lib/sis/records-history.ts` (extend `getAcademicHistory` types + new `getEvaluationWriteupsForStudent` loader), one extra RSC query for award thresholds from `school_config`, and targeted UI additions to `PlacementSection`, `AcademicSection`, and the Overview tab in the single page file. Annual overalls and GA are computed server-side in the RSC from stored quarterly grades using existing pure functions in `lib/compute/annual.ts`. No new routes, pages, or tables.

**Tech Stack:** Next.js 16 App Router (RSC), Supabase service client, `lib/compute/annual.ts` + `lib/compute/awards.ts`, Tailwind v4, shadcn primitives, TypeScript.

---

## Codebase context (read before implementing)

- **`lib/sis/records-history.ts`** — `getAcademicHistory(studentId)` returns `AcademicHistoryRow[]`. Each row's `terms[n].subjects[n]` currently has `{ subjectCode, subjectName, initialGrade, quarterlyGrade }`. Need to add `isExaminable: boolean` and `annualLetterGrade: string | null`.
- **`lib/compute/annual.ts`** — `computeAnnualGrade(t1, t2, t3, t4)` → `number | null` (2dp). `computeGeneralAverage(finals[])` → `number | null` (1dp). Both are pure functions; safe to call in RSC.
- **`lib/compute/awards.ts`** — `subjectAward(subjectOverall, thresholds, eligibility)` → `SubjectAwardLabel`. `AwardThresholds = { bronzeMin, silverMin, goldMin, max }`.
- **Field name typo** — `PlacementRow.lateEnrolleTermNumber` (one `e` in "Enrolle") — this spelling exists in the codebase; match it exactly.
- **`school_config` singleton** — row `id = 1` always; columns `subject_award_bronze_min`, `subject_award_silver_min`, `subject_award_gold_min`, `subject_award_max` (all `numeric`, default 88.5/91.5/95.5/100).
- **evaluation_writeups table** — columns: `student_id uuid`, `term_id uuid`, `section_id uuid`, `writeup text`, `submitted bool`. Join `terms` for `term_number` and `virtue_theme`; join `academic_years` to filter by `ay_code`.
- **Page file is 2024 lines** — add new components at the bottom of the file; do not inline large blocks mid-file.

---

## Task 1 — Extend data layer: `lib/sis/records-history.ts`

**Files:**

- Modify: `lib/sis/records-history.ts`

- [ ] **Step 1: Read the full file**

Read `lib/sis/records-history.ts` to understand the current `getAcademicHistory` select query and data-mapping code before editing.

- [ ] **Step 2: Extend `AcademicTermRow` type**

Find the `AcademicTermRow` type (around line 37). Change the `subjects` array element type from:

```typescript
export type AcademicTermRow = {
  termNumber: number;
  subjects: Array<{
    subjectCode: string;
    subjectName: string;
    initialGrade: number | null;
    quarterlyGrade: number | null;
  }>;
};
```

To:

```typescript
export type AcademicTermRow = {
  termNumber: number;
  subjects: Array<{
    subjectCode: string;
    subjectName: string;
    isExaminable: boolean;
    initialGrade: number | null;
    quarterlyGrade: number | null;
    annualLetterGrade: string | null; // T4 row only; null for examinable subjects + T1-T3 rows
  }>;
};
```

- [ ] **Step 3: Extend `getAcademicHistory` select and mapping**

In `getAcademicHistory`, find the Supabase `.select(...)` call that fetches `grade_entries`. Add `annual_letter_grade` to the grade entry select. Find the join to `subjects` (via `subject_configs`) and add `is_examinable` to that select.

In the data-mapping code that builds each subject row, add:

```typescript
isExaminable: entry.subject_configs.subjects.is_examinable ?? true,
annualLetterGrade: entry.annual_letter_grade ?? null,
```

The exact variable names depend on what you see in the file. Follow the existing mapping pattern exactly.

- [ ] **Step 4: Add `EvaluationWriteupEntry` type**

After the `AttendanceHistoryRow` type, add:

```typescript
export type EvaluationWriteupEntry = {
  termNumber: number;
  termLabel: string;
  virtueTheme: string | null;
  writeup: string | null;
};
```

- [ ] **Step 5: Add `getEvaluationWriteupsForStudent` loader**

Append this function at the end of `lib/sis/records-history.ts`:

```typescript
/**
 * Returns FCA evaluation writeups for a student in a given AY.
 * Always returns exactly 3 entries (T1, T2, T3) — writeup is null when not yet recorded.
 * T4 is excluded per KD #49.
 */
export async function getEvaluationWriteupsForStudent(
  studentId: string,
  ayCode: string
): Promise<EvaluationWriteupEntry[]> {
  const service = createServiceClient();

  const { data } = await service
    .from('evaluation_writeups')
    .select(
      `writeup, terms!inner ( term_number, virtue_theme, academic_years!inner ( ay_code ) )`
    )
    .eq('student_id', studentId)
    .eq('terms.academic_years.ay_code', ayCode);

  const byTerm = new Map<
    number,
    { writeup: string | null; virtueTheme: string | null }
  >();
  for (const row of (data ?? []) as Array<{
    writeup: string | null;
    terms: { term_number: number; virtue_theme: string | null };
  }>) {
    const n = row.terms.term_number;
    if (n >= 1 && n <= 3) {
      byTerm.set(n, {
        writeup: row.writeup,
        virtueTheme: row.terms.virtue_theme,
      });
    }
  }

  return [1, 2, 3].map((n) => ({
    termNumber: n,
    termLabel: `T${n}`,
    virtueTheme: byTerm.get(n)?.virtueTheme ?? null,
    writeup: byTerm.get(n)?.writeup ?? null,
  }));
}
```

- [ ] **Step 6: Verify TypeScript**

```powershell
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```powershell
git add lib/sis/records-history.ts
git commit -m "feat(records): extend AcademicTermRow + add getEvaluationWriteupsForStudent"
```

---

## Task 2 — Placements tab: withdrawal sub-row, operational strip, late-term fix

**Files:**

- Modify: `app/(records)/records/students/[studentNumber]/page.tsx`

- [ ] **Step 1: Read the `PlacementSection` component**

Read `app/(records)/records/students/[studentNumber]/page.tsx` lines 549–722. Locate:

- The `<tbody>` where each placement row `r` is rendered
- The existing `lateTerm` derivation (uses `termForDateInPreloaded`)
- The `<td>` cells for Status, Enrolled, Withdrawn

- [ ] **Step 2: Fix late-enrollee term to prefer explicit override**

Find the existing `lateTerm` derivation:

```typescript
const lateTerm =
  r.enrollmentStatus === 'late_enrollee' && r.enrollmentDate
    ? termForDateInPreloaded(r.enrollmentDate, r.ayCode, termsByAy)
    : null;
```

Replace with:

```typescript
const lateTermResult: {
  termNumber: number;
  termLabel: string;
  isOverride: boolean;
} | null =
  r.enrollmentStatus === 'late_enrollee'
    ? r.lateEnrolleTermNumber !== null
      ? {
          termNumber: r.lateEnrolleTermNumber,
          termLabel: `T${r.lateEnrolleTermNumber}`,
          isOverride: true,
        }
      : (() => {
          const derived = r.enrollmentDate
            ? termForDateInPreloaded(r.enrollmentDate, r.ayCode, termsByAy)
            : null;
          return derived ? { ...derived, isOverride: false } : null;
        })()
    : null;
```

Then update the JSX that renders `lateTerm` to use `lateTermResult`:

```tsx
{
  lateTermResult && (
    <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-brand-amber">
      · {lateTermResult.termLabel}
      {lateTermResult.isOverride && (
        <span className="ml-1 text-muted-foreground">(corrected)</span>
      )}
    </span>
  );
}
{
  r.enrollmentStatus === 'late_enrollee' &&
    !lateTermResult &&
    r.enrollmentDate && (
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        · between terms
      </span>
    );
}
```

- [ ] **Step 3: Add withdrawal sub-row and operational strip**

After the closing `</tr>` of each placement row (inside the `{rows.map((r) => { ... })}` block), add two conditional sub-rows:

```tsx
{
  /* Withdrawal reason sub-row */
}
{
  r.enrollmentStatus === 'withdrawn' && r.withdrawalReason && (
    <tr className="border-b border-hairline last:border-0">
      <td colSpan={8} className="py-1.5 pl-8 pr-3">
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <LogOut className="size-3 shrink-0" />
          <span className="font-medium text-foreground">
            {WITHDRAWAL_REASON_LABELS[r.withdrawalReason as WithdrawalReason] ??
              r.withdrawalReason}
          </span>
          {r.withdrawalNotes && (
            <>
              <span className="text-border">·</span>
              <span className="line-clamp-1">{r.withdrawalNotes}</span>
            </>
          )}
        </span>
      </td>
    </tr>
  );
}

{
  /* Operational details sub-row */
}
{
  r.enrollmentStatus !== 'withdrawn' && (r.busNo || r.classroomOfficerRole) && (
    <tr className="border-b border-hairline last:border-0">
      <td colSpan={8} className="py-1.5 pl-8 pr-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          {[r.busNo ? `Bus ${r.busNo}` : null, r.classroomOfficerRole ?? null]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </td>
    </tr>
  );
}
```

- [ ] **Step 4: Add missing imports**

At the top of the page file, ensure these are imported:

```typescript
import { LogOut } from 'lucide-react';
import {
  WITHDRAWAL_REASON_LABELS,
  type WithdrawalReason,
} from '@/lib/schemas/enrolment';
```

- [ ] **Step 5: Verify TypeScript**

```powershell
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```powershell
git add "app/(records)/records/students/[studentNumber]/page.tsx"
git commit -m "feat(records): withdrawal sub-row + operational strip + late-term override in Placements"
```

---

## Task 3 — Academic tab: annual column, GA row, FCA comments card

**Files:**

- Modify: `app/(records)/records/students/[studentNumber]/page.tsx`

This task adds three things to the Academic tab: (1) an Annual column with award badges, (2) a GA footer row, (3) a FCA comments card per AY. All computation happens in the RSC before rendering — components receive pre-computed values.

- [ ] **Step 1: Read the `AcademicSection` component**

Read `app/(records)/records/students/[studentNumber]/page.tsx` lines 807–899. Understand how it renders subjects and terms.

- [ ] **Step 2: Extend `AcademicSection` props**

Find the `AcademicSection` function signature:

```typescript
function AcademicSection({
  rows,
  enroleeByAy,
}: {
  rows: AcademicHistoryRow[];
  enroleeByAy: Map<string, string>;
});
```

Extend it to:

```typescript
import type { AwardThresholds } from '@/lib/compute/awards';
import type { EvaluationWriteupEntry } from '@/lib/sis/records-history';

function AcademicSection({
  rows,
  enroleeByAy,
  awardThresholds,
  writeupsByAy,
}: {
  rows: AcademicHistoryRow[];
  enroleeByAy: Map<string, string>;
  awardThresholds: AwardThresholds;
  writeupsByAy: Map<string, EvaluationWriteupEntry[]>;
});
```

- [ ] **Step 3: Add Annual column header**

Inside `AcademicSection`, find the `<thead>` row that renders term columns:

```tsx
{
  ay.terms.map((t) => (
    <th key={t.termNumber} className="py-2 pr-3 text-right">
      T{t.termNumber}
    </th>
  ));
}
```

Add an Annual column after it:

```tsx
<th className="py-2 text-right">Annual</th>
```

- [ ] **Step 4: Compute subject annuals and GA per AY inside the component**

Inside `AcademicSection`, before the `return`, add imports and computation:

```typescript
import {
  computeAnnualGrade,
  computeGeneralAverage,
} from '@/lib/compute/annual';
import { subjectAward } from '@/lib/compute/awards';
```

Inside the per-AY render block, compute subject annuals before the table body:

```typescript
// Build a map of subjectCode → quarterly grades across all terms
const subjectQuarterlies = new Map<string, (number | null)[]>();
const subjectMeta = new Map<
  string,
  { isExaminable: boolean; annualLetterGrade: string | null }
>();

for (const term of ay.terms) {
  for (const s of term.subjects) {
    if (!subjectQuarterlies.has(s.subjectCode)) {
      subjectQuarterlies.set(s.subjectCode, [null, null, null, null]);
      subjectMeta.set(s.subjectCode, {
        isExaminable: s.isExaminable,
        annualLetterGrade: s.annualLetterGrade,
      });
    }
    const arr = subjectQuarterlies.get(s.subjectCode)!;
    arr[term.termNumber - 1] = s.quarterlyGrade;
  }
}

// Compute annual per examinable subject
const subjectAnnuals = new Map<string, number | null>();
for (const [code, [t1, t2, t3, t4]] of subjectQuarterlies) {
  const meta = subjectMeta.get(code)!;
  if (meta.isExaminable) {
    subjectAnnuals.set(code, computeAnnualGrade(t1, t2, t3, t4));
  }
}

// Compute GA from examinable annuals
const examinableAnnuals = [...subjectAnnuals.values()].filter(
  (v): v is number => v !== null
);
const ga = computeGeneralAverage(examinableAnnuals);
```

- [ ] **Step 5: Add Annual cell to each subject row**

Inside the subject table's `<tbody>`, find each subject row. After the per-term `<td>` cells, add:

```tsx
<td className="py-2 text-right">
  {(() => {
    const meta = subjectMeta.get(code)!;
    if (meta.isExaminable) {
      const annual = subjectAnnuals.get(code) ?? null;
      if (annual === null)
        return (
          <span className="font-mono tabular-nums text-muted-foreground">
            —
          </span>
        );
      const award = subjectAward(annual, awardThresholds, {
        enrolled: true,
        hasCompleteData: true,
      });
      const awardBadge: Record<string, string> = {
        Gold: 'bg-brand-gold/20 text-brand-gold-deep',
        Silver: 'bg-muted text-muted-foreground',
        Bronze: 'bg-brand-bronze/20 text-brand-bronze-deep',
      };
      return (
        <span className="inline-flex items-center gap-1.5">
          <span className="font-mono tabular-nums">{annual.toFixed(2)}</span>
          {award && award !== 'Not eligible for Subject Award' && (
            <span
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] ${awardBadge[award] ?? 'bg-muted text-muted-foreground'}`}
            >
              {award}
            </span>
          )}
        </span>
      );
    } else {
      // Non-examinable: show annual_letter_grade
      const letter = meta.annualLetterGrade;
      if (!letter)
        return (
          <span className="font-mono tabular-nums text-muted-foreground">
            —
          </span>
        );
      return (
        <span className="inline-flex">
          <Badge variant="secondary" className="font-mono text-[10px]">
            {letter}
          </Badge>
        </span>
      );
    }
  })()}
</td>
```

- [ ] **Step 6: Add GA footer row**

After the `</tbody>` closing tag and before `</table>`, add a `<tfoot>`:

```tsx
{
  ga !== null && (
    <tfoot>
      <tr className="border-t border-hairline">
        <td className="py-2 pr-3 font-semibold text-foreground">
          General Average
        </td>
        {ay.terms.map((t) => (
          <td key={t.termNumber} className="py-2 pr-3" />
        ))}
        <td className="py-2 text-right font-semibold tabular-nums text-foreground">
          {ga.toFixed(1)}
        </td>
      </tr>
    </tfoot>
  );
}
```

- [ ] **Step 7: Add `FcaCommentsCard` component**

Add this component near the bottom of the page file (after the last existing component):

```tsx
function FcaCommentsCard({
  ayCode,
  writeups,
}: {
  ayCode: string;
  writeups: EvaluationWriteupEntry[];
}) {
  const hasAny = writeups.some((w) => w.writeup);
  if (!hasAny) return null;

  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Form Class Adviser · {ayCode}
        </CardDescription>
        <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
          Term comments
        </CardTitle>
        <CardAction>
          <ActionTile icon={ClipboardList} />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-6">
        {writeups.map((w) => (
          <div key={w.termNumber} className="space-y-1.5">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {w.termLabel}
              {w.virtueTheme && (
                <span className="font-normal">
                  {' '}
                  · HFSE Virtues: {w.virtueTheme}
                </span>
              )}
            </p>
            {w.writeup ? (
              <p className="text-sm leading-relaxed text-foreground">
                {w.writeup}
              </p>
            ) : (
              <p className="text-sm italic text-muted-foreground">
                No comments recorded
              </p>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 8: Render `FcaCommentsCard` below each AY's grade section**

Inside `AcademicSection`, after each AY's `<div key={ay.ayCode}>` block (after the attendance/grade table), add:

```tsx
<FcaCommentsCard
  ayCode={ay.ayCode}
  writeups={writeupsByAy.get(ay.ayCode) ?? []}
/>
```

- [ ] **Step 9: Verify TypeScript**

```powershell
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 10: Commit**

```powershell
git add "app/(records)/records/students/[studentNumber]/page.tsx"
git commit -m "feat(records): annual grades + GA + award tiers + FCA comments in Academic tab"
```

---

## Task 4 — Overview tab: document status strip

**Files:**

- Modify: `app/(records)/records/students/[studentNumber]/page.tsx`

- [ ] **Step 1: Add `DocumentStatusStrip` component**

Add this component near the bottom of the page file:

```tsx
import { CheckCircle2, AlertTriangle, Circle } from 'lucide-react';
import { DOCUMENT_SLOTS } from '@/lib/sis/queries';

function DocumentStatusStrip({
  documents,
  enroleeNumber,
  ayCode,
}: {
  documents: Record<string, string | null> | null;
  enroleeNumber: string;
  ayCode: string;
}) {
  if (!documents) return null;

  let valid = 0;
  let needsRenewal = 0;
  let missing = 0;

  for (const slot of DOCUMENT_SLOTS) {
    const statusKey = `${slot.key}Status` as keyof typeof documents;
    const status =
      (documents as Record<string, string | null>)[statusKey] ?? null;
    if (status === 'Valid') valid++;
    else if (status === 'Expired' || status === 'Rejected') needsRenewal++;
    else missing++; // null, 'Uploaded', 'To follow'
  }

  const total = DOCUMENT_SLOTS.length;
  const allValid = valid === total;

  return (
    <Link
      href={`/p-files/${enroleeNumber}?ay=${ayCode}`}
      className="flex flex-wrap items-center gap-3 rounded-xl border border-hairline bg-card px-4 py-3 text-sm transition-colors hover:border-brand-indigo/40 hover:bg-muted/30"
    >
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Documents
      </span>
      {allValid ? (
        <span className="flex items-center gap-1.5 text-brand-mint">
          <CheckCircle2 className="size-3.5" />
          <span className="font-medium">All {total} documents on file</span>
        </span>
      ) : (
        <>
          <span className="flex items-center gap-1.5 text-brand-mint">
            <CheckCircle2 className="size-3.5" />
            <span>{valid} valid</span>
          </span>
          {needsRenewal > 0 && (
            <span className="flex items-center gap-1.5 text-brand-amber">
              <AlertTriangle className="size-3.5" />
              <span>{needsRenewal} need renewal</span>
            </span>
          )}
          {missing > 0 && (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Circle className="size-3.5" />
              <span>{missing} missing</span>
            </span>
          )}
        </>
      )}
    </Link>
  );
}
```

- [ ] **Step 2: Find the documents object in `currentAyDetail`**

Read the `getStudentDetail` return type in `lib/sis/queries.ts` to understand the shape of `currentAyDetail.documents`. The documents row is typed as a record with `<slotKey>Status` string columns. Verify that `DOCUMENT_SLOTS` is exported from `lib/sis/queries.ts` and that `documents` is accessible on `currentAyDetail`.

If `currentAyDetail.documents` uses a different key pattern than `${slot.key}Status`, adjust the `statusKey` derivation inside `DocumentStatusStrip` to match.

- [ ] **Step 3: Render `DocumentStatusStrip` in Overview tab**

In the RSC page's JSX, find the Overview `<TabsContent value="overview">` block. It currently renders:

```tsx
<TabsContent value="overview" className="space-y-6">
  {currentAyDetail ? (
    <>
      <StudentProfileCard ... />
      <PostEnrolmentChecklist ... />
    </>
  ) : (...)}
  {currentAyDetail?.application.stpApplicationType && (
    <StpApplicationCard ... />
  )}
</TabsContent>
```

Add the strip between the KPI stats section and the `<QuickActionsStrip>` (outside the Tabs component, in the main page body). Find where `<QuickActionsStrip>` is rendered:

```tsx
{currentAyDetail && (
  <QuickActionsStrip ... />
)}
```

Change to:

```tsx
{
  currentAyDetail && (
    <div className="space-y-3">
      <DocumentStatusStrip
        documents={
          currentAyDetail.documents as Record<string, string | null> | null
        }
        enroleeNumber={currentAyDetail.application.enroleeNumber}
        ayCode={currentAyDetail.ayCode}
      />
      <QuickActionsStrip
        enroleeNumber={currentAyDetail.application.enroleeNumber}
        ayCode={currentAyDetail.ayCode}
        studentId={student.studentId}
        studentNumber={studentNumber}
      />
    </div>
  );
}
```

- [ ] **Step 4: Add missing imports**

Ensure at the top of the page file:

```typescript
import { CheckCircle2, AlertTriangle, Circle } from 'lucide-react';
import { DOCUMENT_SLOTS } from '@/lib/sis/queries';
```

- [ ] **Step 5: Verify TypeScript**

```powershell
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```powershell
git add "app/(records)/records/students/[studentNumber]/page.tsx"
git commit -m "feat(records): document status strip in Overview tab"
```

---

## Task 5 — Wire page-level fetches + final verification

**Files:**

- Modify: `app/(records)/records/students/[studentNumber]/page.tsx`

- [ ] **Step 1: Add imports at the top of the page file**

Add to the imports block:

```typescript
import {
  getEvaluationWriteupsForStudent,
  type EvaluationWriteupEntry,
} from '@/lib/sis/records-history';
import {
  computeAnnualGrade,
  computeGeneralAverage,
} from '@/lib/compute/annual';
import {
  subjectAward,
  type AwardThresholds,
  DEFAULT_AWARD_THRESHOLDS,
} from '@/lib/compute/awards';
import { createServiceClient } from '@/lib/supabase/service';
```

- [ ] **Step 2: Add `school_config` award thresholds query**

Find the `// Parallel batch A` block (around line 227). Add the `school_config` query in the same `Promise.all`:

```typescript
const [sectionTransfers, termsByAy, allowanceResult, siblings, awardThresholdsResult] =
  await Promise.all([
    getSectionTransfersForStudent(...),
    preloadTermsForAYs(placementAyCodes),
    createServiceClient()
      .from('students')
      .select('urgent_compassionate_allowance')
      .eq('id', student.studentId)
      .maybeSingle(),
    // ... existing siblings IIFE ...
    // freshenAyDocuments ...
    createServiceClient()
      .from('school_config')
      .select('subject_award_bronze_min, subject_award_silver_min, subject_award_gold_min, subject_award_max')
      .eq('id', 1)
      .maybeSingle(),
  ]);

const awardThresholds: AwardThresholds = (() => {
  const cfg = awardThresholdsResult.data as {
    subject_award_bronze_min: number | null;
    subject_award_silver_min: number | null;
    subject_award_gold_min: number | null;
    subject_award_max: number | null;
  } | null;
  return {
    bronzeMin: cfg?.subject_award_bronze_min ?? DEFAULT_AWARD_THRESHOLDS.bronzeMin,
    silverMin: cfg?.subject_award_silver_min ?? DEFAULT_AWARD_THRESHOLDS.silverMin,
    goldMin: cfg?.subject_award_gold_min ?? DEFAULT_AWARD_THRESHOLDS.goldMin,
    max: cfg?.subject_award_max ?? DEFAULT_AWARD_THRESHOLDS.max,
  };
})();
```

- [ ] **Step 3: Add evaluation writeups parallel fetch**

After the existing parallel batch B (`lifecycleSnapshot`, `currentAyDetail`), add a third parallel fetch for evaluation writeups per AY:

```typescript
// Parallel batch C — evaluation writeups per AY (T1-T3 FCA comments).
const writeupsResults = await Promise.all(
  academics.map((ay) =>
    getEvaluationWriteupsForStudent(student.studentId, ay.ayCode)
  )
);
const writeupsByAy = new Map<string, EvaluationWriteupEntry[]>(
  academics.map((ay, i) => [ay.ayCode, writeupsResults[i]])
);
```

- [ ] **Step 4: Pass new props to `AcademicSection`**

Find where `<AcademicSection>` is called in the `<TabsContent value="academic">` block:

```tsx
<AcademicSection rows={academics} enroleeByAy={enroleeByAy} />
```

Change to:

```tsx
<AcademicSection
  rows={academics}
  enroleeByAy={enroleeByAy}
  awardThresholds={awardThresholds}
  writeupsByAy={writeupsByAy}
/>
```

- [ ] **Step 5: Run all tests**

```powershell
npx vitest run
```

Expected: all 77+ tests pass (no new tests required for RSC/UI changes).

- [ ] **Step 6: TypeScript check**

```powershell
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 7: Full build**

```powershell
npx next build
```

Expected: clean compile, 114 pages (no new routes added).

- [ ] **Step 8: Manual verification**

1. Navigate to `/records/students/[studentNumber]` for a student with a withdrawal on record.
2. **Placements tab**: Withdrawn row shows a sub-row with the withdrawal reason label and notes (if any). Active/late-enrollee rows with bus/role show the operational strip.
3. **Placements tab**: Late-enrollee placement where `lateEnrolleTermNumber` is set shows `T{n} (corrected)` instead of the derived term.
4. **Academic tab**: Grade table has an "Annual" column. Examinable subjects show annual overall (2dp) + award badge. Non-examinable subjects show annual letter grade (Passed/UG/E/—).
5. **Academic tab**: "General Average" footer row appears with the 1dp GA value.
6. **Academic tab**: FCA comments card appears below the grades for any AY where at least one T1–T3 writeup exists.
7. **Overview / above QuickActionsStrip**: Document status strip shows valid/renewal/missing counts, links to P-Files.

- [ ] **Step 9: Commit**

```powershell
git add "app/(records)/records/students/[studentNumber]/page.tsx"
git commit -m "feat(records): wire award thresholds + evaluation writeups + pass props to Academic tab"
```
