# Grading Sheet — Subject Teacher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the real subject teacher on `/markbook/grading/[id]`, resolved from `teacher_assignments` instead of the stale `grading_sheets.teacher_name` column.

**Architecture:** One pure helper in `lib/markbook/` maps `(section, subject) → teacher display names`, unit-tested without a database. The grading sheet's RSC fetches that section+subject's assignments inside its existing `Promise.all`, resolves names via the cached `getStaffDisplayNameById()`, and prints them in the hero paragraph — falling back to the legacy column, then to an explicit "No subject teacher assigned".

**Tech Stack:** Next.js 16 App Router (async RSC), Supabase (`@supabase/ssr` cookie-scoped client), Vitest + jsdom, TypeScript.

Spec: `docs/superpowers/specs/2026-07-28-grading-sheet-subject-teacher-design.md`

## Global Constraints

- **Do not touch `/markbook/grading/page.tsx` (the list).** Spec §4 — deliberately out of scope. Two tasks only.
- **No migration.** `grading_sheets.teacher_name` stays in the schema; only its use on the detail page changes.
- Resolve names with `getStaffDisplayNameById()` from `lib/auth/staff-list.ts`. **Never** `getTeacherList()` (filters out non-`teacher` roles and disabled accounts) and **never** the two-hop `getTeacherEmailMap()` + `getStaffDisplayEntries()`.
- Use the existing cookie-scoped `supabase` client already in scope on the page. **No `createServiceClient()`** — RLS `teacher_assignments_auth_read` is `using (true)`.
- A `(section, subject)` pair may hold **multiple** subject teachers. Show all, comma-joined.
- Empty-state copy is exactly: `No subject teacher assigned`, rendered muted italic.
- Plain-English UI copy — no dev jargon in anything a user reads.
- Design system is binding (Hard Rule #7): no hardcoded hex / `oklch()` / `slate-*` / `zinc-*` / `gray-*`. This change adds only `italic`, an existing utility.
- Tests must `import { describe, it, expect } from 'vitest'` explicitly — `tsc` type-checks test files and globals are not ambient.

---

### Task 1: Pure resolver `buildSubjectTeacherNameMap`

Creates the tested helper. Self-contained: nothing renders yet, and the suite passes on its own.

**Files:**

- Create: `lib/markbook/subject-teacher.ts`
- Test: `__tests__/markbook/subject-teacher-map.test.ts`

**Interfaces:**

- Consumes: nothing (leaf module, no imports beyond types it declares itself).
- Produces:

  ```ts
  export type SubjectTeacherAssignmentRow = {
    section_id: string;
    subject_id: string | null;
    teacher_user_id: string;
  };
  export function subjectTeacherKey(
    sectionId: string,
    subjectId: string
  ): string;
  export function buildSubjectTeacherNameMap(
    assignments: SubjectTeacherAssignmentRow[],
    staffNameEntries: Array<[string, string]>
  ): Map<string, string[]>;
  ```

  Task 2 calls both.

- [ ] **Step 1: Write the failing test**

Create `__tests__/markbook/subject-teacher-map.test.ts`:

```ts
/**
 * buildSubjectTeacherNameMap() — pure batch resolver for the grading sheet's
 * "who teaches this subject" line. Subject teachers must resolve from LIVE
 * teacher_assignments rows, never the denormalized `grading_sheets.teacher_name`
 * column (written once at sheet creation, never updated — so it drifts, and on
 * AY2026 it is simply empty).
 *
 * Extracted as a pure function (no Supabase mocking needed) — same spirit as
 * buildFormAdviserNameMap in lib/markbook/masterfile.ts.
 */

import { describe, expect, it } from 'vitest';
import {
  buildSubjectTeacherNameMap,
  subjectTeacherKey,
} from '@/lib/markbook/subject-teacher';

describe('subjectTeacherKey', () => {
  it('composes a section and subject into one lookup key', () => {
    expect(subjectTeacherKey('sec-1', 'sub-1')).toBe('sec-1|sub-1');
  });
});

describe('buildSubjectTeacherNameMap', () => {
  it('resolves a single assignment to its teacher display name', () => {
    const map = buildSubjectTeacherNameMap(
      [
        {
          section_id: 'sec-1',
          subject_id: 'sub-1',
          teacher_user_id: 'user-1',
        },
      ],
      [['user-1', 'Maria T.']]
    );
    expect(map.get(subjectTeacherKey('sec-1', 'sub-1'))).toEqual(['Maria T.']);
  });

  it('returns every teacher when a section+subject is co-taught, in input order', () => {
    const map = buildSubjectTeacherNameMap(
      [
        {
          section_id: 'sec-1',
          subject_id: 'sub-1',
          teacher_user_id: 'user-1',
        },
        {
          section_id: 'sec-1',
          subject_id: 'sub-1',
          teacher_user_id: 'user-2',
        },
      ],
      [
        ['user-1', 'Maria T.'],
        ['user-2', 'Daniel L.'],
      ]
    );
    expect(map.get(subjectTeacherKey('sec-1', 'sub-1'))).toEqual([
      'Maria T.',
      'Daniel L.',
    ]);
  });

  it('keeps separate subjects in the same section apart', () => {
    const map = buildSubjectTeacherNameMap(
      [
        {
          section_id: 'sec-1',
          subject_id: 'sub-1',
          teacher_user_id: 'user-1',
        },
        {
          section_id: 'sec-1',
          subject_id: 'sub-2',
          teacher_user_id: 'user-2',
        },
      ],
      [
        ['user-1', 'Maria T.'],
        ['user-2', 'Daniel L.'],
      ]
    );
    expect(map.get(subjectTeacherKey('sec-1', 'sub-1'))).toEqual(['Maria T.']);
    expect(map.get(subjectTeacherKey('sec-1', 'sub-2'))).toEqual(['Daniel L.']);
  });

  it('a section+subject with no assignment is absent from the map (caller renders the empty state)', () => {
    const map = buildSubjectTeacherNameMap(
      [
        {
          section_id: 'sec-1',
          subject_id: 'sub-1',
          teacher_user_id: 'user-1',
        },
      ],
      [['user-1', 'Maria T.']]
    );
    expect(map.has(subjectTeacherKey('sec-9', 'sub-9'))).toBe(false);
    expect(map.get(subjectTeacherKey('sec-9', 'sub-9')) ?? null).toBeNull();
  });

  it('falls back to the raw teacher_user_id when no staff name matches, never a blank', () => {
    // A superadmin seeing an id knows exactly which account to fix; a blank
    // is indistinguishable from "nobody assigned".
    const map = buildSubjectTeacherNameMap(
      [
        {
          section_id: 'sec-1',
          subject_id: 'sub-1',
          teacher_user_id: 'ghost-user',
        },
      ],
      []
    );
    expect(map.get(subjectTeacherKey('sec-1', 'sub-1'))).toEqual([
      'ghost-user',
    ]);
  });

  it('skips a row with a null subject_id instead of keying on "null"', () => {
    // The CHECK constraint on teacher_assignments already prevents this for
    // subject_teacher rows; the helper takes plain data and does not trust it.
    const map = buildSubjectTeacherNameMap(
      [
        { section_id: 'sec-1', subject_id: null, teacher_user_id: 'user-1' },
        {
          section_id: 'sec-1',
          subject_id: 'sub-1',
          teacher_user_id: 'user-2',
        },
      ],
      [
        ['user-1', 'Maria T.'],
        ['user-2', 'Daniel L.'],
      ]
    );
    expect(map.size).toBe(1);
    expect(map.get(subjectTeacherKey('sec-1', 'sub-1'))).toEqual(['Daniel L.']);
    expect(map.has('sec-1|null')).toBe(false);
  });

  it('returns an empty map for no assignments', () => {
    expect(buildSubjectTeacherNameMap([], [['user-1', 'Maria T.']]).size).toBe(
      0
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/markbook/subject-teacher-map.test.ts`

Expected: FAIL — the module `@/lib/markbook/subject-teacher` does not exist, so Vite reports a resolve error and no tests execute.

- [ ] **Step 3: Write the implementation**

Create `lib/markbook/subject-teacher.ts`:

```ts
// Pure — batch-resolves the LIVE subject-teacher display names for a
// (section, subject) pair, given `teacher_assignments` rows (role =
// 'subject_teacher') and the staff id→name lookup from
// lib/auth/staff-list.ts::getStaffDisplayNameById().
//
// Reads teacher_assignments, never the denormalized `grading_sheets.teacher_name`
// column — that field is written once at sheet creation and never updated when
// assignments change, so it drifts (and across AY2026 it is simply empty).
// Same authoritative-vs-mirror choice as buildFormAdviserNameMap in
// lib/markbook/masterfile.ts.
//
// Extracted so the resolution is unit-testable without mocking the surrounding
// Supabase call graph — the only consumer is an async RSC.
//
// Returns ALL teachers for a pair, not just the first: the unique index
// `teacher_assignments_subject_teacher_unique` is on
// (teacher_user_id, section_id, subject_id), so co-teaching is permitted and
// silently dropping the second name would be a hard-to-notice wrong.

export type SubjectTeacherAssignmentRow = {
  section_id: string;
  subject_id: string | null;
  teacher_user_id: string;
};

export function subjectTeacherKey(
  sectionId: string,
  subjectId: string
): string {
  return `${sectionId}|${subjectId}`;
}

export function buildSubjectTeacherNameMap(
  assignments: SubjectTeacherAssignmentRow[],
  staffNameEntries: Array<[string, string]>
): Map<string, string[]> {
  const nameById = new Map(staffNameEntries);
  const out = new Map<string, string[]>();
  for (const a of assignments) {
    // Defensive: the role/subject CHECK constraint already guarantees a
    // subject_id on subject_teacher rows, but this function takes plain data.
    if (!a.subject_id) continue;
    const key = subjectTeacherKey(a.section_id, a.subject_id);
    // Fall back to the raw id rather than a blank — an id tells a superadmin
    // which account to fix, a blank tells them nothing.
    const name = nameById.get(a.teacher_user_id) ?? a.teacher_user_id;
    const existing = out.get(key);
    if (existing) existing.push(name);
    else out.set(key, [name]);
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/markbook/subject-teacher-map.test.ts`

Expected: PASS — 8 tests across 2 describe blocks.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`

Expected: exit 0, no output.

- [ ] **Step 6: Commit**

```bash
git add lib/markbook/subject-teacher.ts __tests__/markbook/subject-teacher-map.test.ts
git commit -m "feat: add buildSubjectTeacherNameMap pure resolver"
```

---

### Task 2: Show the subject teacher on the grading sheet

Wires the helper into the page and changes the visible line. Independently reviewable: Task 1 ships a tested helper with no caller; this task is the entire user-facing change.

**Files:**

- Modify: `app/(markbook)/markbook/grading/[id]/page.tsx` — imports, the `Promise.all` at 174-199, and the hero paragraph at 364-368.

**Interfaces:**

- Consumes: `buildSubjectTeacherNameMap`, `subjectTeacherKey`, `SubjectTeacherAssignmentRow` from `@/lib/markbook/subject-teacher` (Task 1); `getStaffDisplayNameById` from `@/lib/auth/staff-list`.
- Produces: nothing consumed by later tasks — this is the last task.

- [ ] **Step 1: Add the imports**

In `app/(markbook)/markbook/grading/[id]/page.tsx`, alongside the existing `@/lib/...` imports at the top of the file:

```ts
import { getStaffDisplayNameById } from '@/lib/auth/staff-list';
import {
  buildSubjectTeacherNameMap,
  subjectTeacherKey,
  type SubjectTeacherAssignmentRow,
} from '@/lib/markbook/subject-teacher';
```

- [ ] **Step 2: Add the assignment fetch promise**

Immediately after the `priorGradesPromise` declaration (which ends at line 172, just before `const [` at line 174), add:

```ts
// Who teaches this (section × subject) — the live answer, from
// teacher_assignments. The page's own loadAssignmentsForUser call above is
// keyed on the CURRENT user and only gates their edit rights; it cannot
// answer "who teaches this". Declared here so it runs inside the Promise.all
// below rather than adding a serial round-trip.
//
// RLS on teacher_assignments allows authenticated reads, so the ordinary
// cookie-scoped client is enough — no service-role escalation.
const subjectTeacherPromise: Promise<SubjectTeacherAssignmentRow[]> =
  sectionForSeed?.id && subjectEarly?.id
    ? supabase
        .from('teacher_assignments')
        .select('section_id, subject_id, teacher_user_id')
        .eq('role', 'subject_teacher')
        .eq('section_id', sectionForSeed.id)
        .eq('subject_id', subjectEarly.id)
        .then(({ data }) => (data ?? []) as SubjectTeacherAssignmentRow[])
    : Promise.resolve([]);
```

- [ ] **Step 3: Add both promises to the existing `Promise.all`**

The block at lines 174-199 destructures four results from four array entries, in this order: a `grade_change_requests` query, a `grade_entries` query, `assignmentsPromise`, `priorGradesPromise`. **Do not modify any of them.** Make exactly two edits:

**3a.** Add two names to the end of the destructuring, after `priorGrades,`:

```ts
    subjectTeacherAssignments,
    staffNameEntries,
```

**3b.** Add two entries to the end of the array, after `priorGradesPromise,` and before the closing `]);`:

```ts
    subjectTeacherPromise,
    getStaffDisplayNameById(),
```

Order matters — `Promise.all` pairs by position, so the two new names must sit in the same order as the two new entries. After the edit the opening line reads `const [ { data: openRequestsRaw }, { data: entriesRaw }, rawAssignments, priorGrades, subjectTeacherAssignments, staffNameEntries ] = await Promise.all([`.

`getStaffDisplayNameById()` is `unstable_cache`d for 5 minutes behind a single Auth Admin call shared app-wide, so it adds no measurable cost.

- [ ] **Step 4: Derive the display string**

After that `Promise.all` block and its existing `type OpenRequestRow = {...}` declaration, add:

```ts
// Assignment first; the legacy `grading_sheets.teacher_name` column only as a
// last resort. That column is written at sheet creation and never updated, so
// it drifts — but on historical sheets it may be the only record we have, and
// it is what /markbook/grading already falls back to. Blanking it here would
// make the two surfaces disagree about who teaches a class.
const subjectTeacherNames =
  sectionForSeed?.id && subjectEarly?.id
    ? (buildSubjectTeacherNameMap(
        subjectTeacherAssignments,
        staffNameEntries
      ).get(subjectTeacherKey(sectionForSeed.id, subjectEarly.id)) ?? [])
    : [];
const subjectTeacherLabel =
  subjectTeacherNames.length > 0
    ? subjectTeacherNames.join(', ')
    : (sheet.teacher_name ?? null);
```

- [ ] **Step 5: Update the hero paragraph**

Replace the paragraph at lines 364-368:

```tsx
<p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
  {level?.label} {section?.name}
  {sheet.teacher_name && <> · {sheet.teacher_name}</>}
  {!isExaminable && <> · Letter-grade subject</>}
</p>
```

with:

```tsx
<p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
  {level?.label} {section?.name}
  {subjectTeacherLabel ? (
    <> · {subjectTeacherLabel}</>
  ) : (
    <>
      {' '}
      · <span className="italic">No subject teacher assigned</span>
    </>
  )}
  {!isExaminable && <> · Letter-grade subject</>}
</p>
```

The paragraph is already `text-muted-foreground`, so `italic` alone carries the empty state — matching how `MetaBlock` renders _Unassigned_ on the attendance register card (`components/attendance/sheet-context.tsx:211-218`).

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`

Expected: exit 0. If it reports that `sheet.teacher_name` is now unused, leave the field in the `.select()` — Step 4 still reads it as the fallback.

- [ ] **Step 7: Run the full suite**

Run: `npx vitest run`

Expected: all files pass. No existing test asserts on this hero paragraph, so nothing should need updating. If something fails, stop and report rather than editing the test to match.

- [ ] **Step 8: Build**

Run: `npx next build`

Expected: `✓ Compiled successfully`.

- [ ] **Step 9: Manual check in the browser**

Open any sheet at `/markbook/grading/[id]`.

- On AY2026 (no teacher accounts yet): the line reads `Primary Five Tenacity · No subject teacher assigned`, the last part in italics.
- The subject H1, term eyebrow, lock badge, stat cards, and score grid are unchanged.
- Non-examinable subject: `· Letter-grade subject` still appears after the teacher segment.
- If a populated AY is reachable, confirm an assigned sheet shows the real name and that it matches the Teacher column on `/markbook/grading` for the same row.

- [ ] **Step 10: Commit**

```bash
git add "app/(markbook)/markbook/grading/[id]/page.tsx"
git commit -m "feat: show the live subject teacher on the grading sheet"
```

---

## Verification (whole plan)

1. `npx tsc --noEmit` — exit 0.
2. `npx vitest run` — all files pass, including the 8 new helper tests.
3. `npx next build` — clean compile (project workflow rule #3).
4. Browser pass per Task 2 Step 9.

## Follow-ups (deliberately not in this plan)

- Creating the AY2026 teacher accounts + subject assignments — a data task. Until it happens every sheet reads "No subject teacher assigned", which is correct.
- `/markbook/grading` (the list) keeps its own inline resolver and its known habit of dropping assignments held by non-`teacher`-role or disabled accounts. Spec §4 explains why that was left alone; revisit with evidence.
- Linking "No subject teacher assigned" to teacher setup — pointless until accounts exist.
