# Bulk-publish concern-aware fix links — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Replace the bulk-publish dialog's single generic per-section link with an expandable per-section concern checklist, each concern deep-linking to its fix surface carrying the selected term. Spec: `docs/superpowers/specs/2026-06-11-bulk-publish-concern-links-design.md`. UI-only, no API/migration.

**Architecture:** A pure `concernsFor(readiness)` helper + `concernHref(code, ctx)` (unit-tested) derive the concern list from the existing per-section readiness response; an extracted `SectionReadinessRow` renders the compact row + an `aria-expanded` disclosure revealing the concern mini-checklist. Reuses verdict codes already fetched.

---

## File structure

- **Modify** `components/admin/bulk-publish-dialog.tsx` — keep `classify()`; store the raw `hardBlockers`/`softGaps`/`comment_gate` on the per-section readiness so concerns can be derived; replace the row `<label>`+single-link with `<SectionReadinessRow>`.
- **Create** `components/admin/bulk-publish-concerns.ts` — pure `concernsFor()` + `concernHref()` + `Concern` type.
- **Create** `components/admin/section-readiness-row.tsx` — the compact row + expandable concern panel (`'use client'`).
- **Create** `__tests__/markbook/bulk-publish-concerns.test.ts` — unit tests for `concernsFor`.

---

## Task 1: Pure concern derivation + tests

**Files:** Create `components/admin/bulk-publish-concerns.ts` + `__tests__/markbook/bulk-publish-concerns.test.ts`.

- [ ] **Step 1: Read** the current readiness shape in `bulk-publish-dialog.tsx` (`classify()` input type — `hardBlockers`/`softGaps: PublishGap[]` with `{code,label,count?}`, and `comment_gate.gaps[].{missing,virtue_missing,term_number}`). Mirror those types.

- [ ] **Step 2: Write the failing test**

```ts
// __tests__/markbook/bulk-publish-concerns.test.ts
import { describe, it, expect } from 'vitest';
import {
  concernsFor,
  concernHref,
} from '@/components/admin/bulk-publish-concerns';

const base = {
  grading_sheets: { unlocked: [] },
  attendance: { missing: [] },
  comment_gate: { ok: true, gaps: [] },
  hardBlockers: [],
  softGaps: [],
};

describe('concernsFor', () => {
  it('maps soft + hard codes to severities', () => {
    const out = concernsFor({
      ...base,
      hardBlockers: [{ code: 'no_grading_sheets', label: 'No grading sheets' }],
      softGaps: [{ code: 'attendance_incomplete', label: '2 attendance gaps' }],
    });
    expect(out.find((c) => c.code === 'no_grading_sheets')?.severity).toBe(
      'hard'
    );
    expect(out.find((c) => c.code === 'attendance_incomplete')?.severity).toBe(
      'soft'
    );
  });

  it('splits comments_incomplete into comments + virtue per comment_gate', () => {
    const out = concernsFor({
      ...base,
      hardBlockers: [
        { code: 'comments_incomplete', label: 'Adviser comments incomplete' },
      ],
      comment_gate: {
        ok: false,
        gaps: [
          { term_number: 1, missing: [{}], virtue_missing: false },
          { term_number: 2, missing: [], virtue_missing: true },
        ],
      },
    });
    const codes = out.map((c) => c.code);
    expect(codes).toContain('comments'); // has missing students
    expect(codes).toContain('virtue'); // has virtue_missing
    expect(
      out.every((c) => c.severity === 'hard' || c.severity === 'soft')
    ).toBe(true);
  });

  it('ready section → no concerns', () => {
    expect(concernsFor(base)).toEqual([]);
  });
});

describe('concernHref', () => {
  const ctx = { sectionId: 'sec-1', sectionName: 'Obedience', termId: 't1' };
  it('attendance + evaluation carry term_id; grading uses the section facet; no_students null', () => {
    expect(concernHref('attendance_incomplete', ctx)).toBe(
      '/attendance/sec-1?term_id=t1'
    );
    expect(concernHref('comments', ctx)).toBe(
      '/evaluation/sections/sec-1?term_id=t1'
    );
    expect(concernHref('virtue', ctx)).toBe('/evaluation/virtue-themes');
    expect(concernHref('sheets_unlocked', ctx)).toBe(
      '/markbook/grading?grading.section=Obedience'
    );
    expect(concernHref('nonexam_finals_missing', ctx)).toBe(
      '/markbook/report-cards'
    );
    expect(concernHref('letterhead_incomplete', ctx)).toBe(
      '/sis/admin/school-config'
    );
    expect(concernHref('no_students', ctx)).toBeNull();
  });
});
```

- [ ] **Step 3: Run → FAIL** (`npx vitest run __tests__/markbook/bulk-publish-concerns.test.ts`).

- [ ] **Step 4: Implement** `bulk-publish-concerns.ts`:
  - `export type Concern = { code: string; label: string; severity: 'hard' | 'soft'; };`
  - `concernsFor(r)`: start from `[...hardBlockers.map(→hard), ...softGaps.map(→soft)]`. For a `comments_incomplete` entry, DROP it and instead push from `comment_gate.gaps`: a `{code:'comments', label:'Adviser comments', severity:'hard'}` if any gap has `missing.length>0`, and a `{code:'virtue', label:'Virtue theme', severity:'hard'}` if any gap has `virtue_missing`. Dedupe. Return `[]` when none.
  - `concernHref(code, {sectionId, sectionName, termId})`: the map from the spec (term carried for attendance/comments via `?term_id=`; grading `?grading.section=${encodeURIComponent(sectionName)}`; virtue/report-cards/school-config static; `no_students`→`null`). `grades_missing`/`no_grading_sheets`→grading.

- [ ] **Step 5: Run → PASS.** Commit.

```bash
git add components/admin/bulk-publish-concerns.ts __tests__/markbook/bulk-publish-concerns.test.ts
git commit -m "feat(bulk-publish): pure concern derivation + fix-link mapping"
```

---

## Task 2: SectionReadinessRow + wire into the dialog

**Files:** Create `components/admin/section-readiness-row.tsx`; modify `components/admin/bulk-publish-dialog.tsx`.

- [ ] **Step 1: Extend stored readiness** — in `bulk-publish-dialog.tsx`, have the per-section readiness retain the fields `concernsFor` needs (`hardBlockers`, `softGaps`, `comment_gate`, `grading_sheets`, `attendance`). Simplest: store the raw API response alongside the classified `{state,reasons}` (e.g. `readiness[id] = { ...classified, raw }`), or compute `concerns: Concern[]` at fetch time and store it. Keep `classify()` + `ReadinessPill` unchanged.

- [ ] **Step 2: Build `SectionReadinessRow`** (`'use client'`): props `{ section: {id,name,level_label}, readiness, concerns, termId, selected, disabled, onToggle }`.
  - Compact row: `<div>` with `Checkbox` (own `onCheckedChange={onToggle}`, `disabled`), level+name, `<ReadinessPill>` (import or lift the existing pill), and — when `concerns.length > 0` — a chevron `Button variant="ghost" size="icon"` toggling local `expanded` (`aria-expanded`, `aria-label="Show what needs fixing"`, `ChevronDown` with `rotate-180` when open, `transition-transform`).
  - Expanded panel (`expanded && concerns.length`): indented `ul`; each concern → a row: status icon (`AlertTriangle`/`AlertCircle`; `text-destructive` for `severity==='hard'`, `text-warning`/amber for `'soft'`) + `label` + (when `concernHref` non-null) an outline `Button asChild size="sm"`: `<a href={href} target="_blank" rel="noopener noreferrer" onClick={stopPropagation}>Open <ArrowUpRight/></a>`. `no_students` (null href) → just the labeled row, no button. Tokens only; mirror `ChecklistRow` styling.
  - Keep the blocked styling (`opacity-60` / not-allowed on the checkbox area) consistent with today.

- [ ] **Step 3: Replace** the `sortedSections.map(...)` `<label>` block in the dialog with `<SectionReadinessRow ... />`, passing `concerns={concernsFor(rawReadiness)}` (or the precomputed list) and `termId`. Remove the old single `<a … /markbook/grading …>` link.

- [ ] **Step 4: Verify** — `npx tsc --noEmit 2>&1 | grep -v validator.ts | grep "error TS"` (none) + `npx next build` ("Compiled successfully").

- [ ] **Step 5: Manual (test AY)** — open Bulk publish, pick a term; a warn/blocked section shows a chevron → expand → concern rows with correct "Open ↗" targets (attendance/eval carry `?term_id`); change term → links update; ready sections have no chevron; blocked checkbox disabled but expandable.

- [ ] **Step 6: Commit**

```bash
git add components/admin/section-readiness-row.tsx components/admin/bulk-publish-dialog.tsx
git commit -m "feat(bulk-publish): expandable per-section concern checklist with fix links"
```

---

## Task 3: KD + verify

- [ ] Append a KD to `.claude/rules/key-decisions/markbook.md` (next number) — "Bulk-publish dialog concern-aware fix links. Each section row expands (`SectionReadinessRow`, `aria-expanded` disclosure) to a mini checklist of its publish-readiness concerns (`concernsFor` over the verdict codes; `comments_incomplete` split into comments + virtue per `comment_gate`); each concern deep-links via `concernHref` to its fix surface carrying the selected term (attendance/eval `?term_id`; grading `grading.section` facet; virtue→virtue-themes; finals→report-cards; letterhead→school-config; `no_students` label-only). Mirrors the single-section publish-window-panel (KD #75), condensed. UI-only." + index row. Commit.

## Self-review (against spec)

- Expandable row (B) + concern mini-checklist (Task 2). ✓
- Concern→link map incl. term + comment/virtue split (Task 1). ✓
- Pure helper unit-tested; no new fetches; tokens only; a11y disclosure. ✓
- classify()/verdict/route untouched. ✓

## Verification (whole)

- `npx tsc --noEmit` + `npx vitest run __tests__/markbook/bulk-publish-concerns.test.ts` + `npx next build` green.
- Branch `feat/bulk-publish-concern-links`; reviewer pass (mapping + a11y + tokens); merge + push. No migration.
