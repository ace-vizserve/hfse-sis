# Require Activity Label + Date Before a WW/PT/QA Slot's First Score — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before a WW/PT/QA slot can receive its very first score (roster-wide — the first time ANY student gets a score in that slot), the teacher must supply that slot's required activity metadata (WW/PT: Description + Date administered; QA: Description only) via an intercepting dialog. Existing scored slots are permanently grandfathered — the gate only ever fires on a slot's genuine first score, never on edits to an already-scored slot.

**Architecture:** A shared pure predicate module (`lib/grading/first-score-gate.ts`) defines the exact "does this slot's metadata satisfy the rule" and "has this slot ever been scored" checks, imported by both the client grid and the server route so the rule can't drift between the two enforcement points. The client (`score-entry-grid.tsx`) intercepts a score commit with a dialog when the gate applies; on confirm, it sends ONE combined PATCH (score + label) to the existing entries route rather than two separate requests. The server route (`entries/[entryId]/route.ts`) independently re-checks the same gate before writing — a client-only check is bypassable, so server enforcement is mandatory, not optional. The gate applies only to the unlocked, direct-entry path; the locked-sheet change-request/correction flow (Hard Rule #5) is completely untouched.

**Tech Stack:** Next.js 16, TypeScript, Supabase (service-role client in the route), Vitest + Testing Library, `@tanstack/react-query` (existing `entryMutation`).

**This reverses a decision KD #105 made twice** (documented reasoning: labels aren't report-card-rendered, hard-blocking was judged disproportionate, no observed evidence of the problem at the time). The product owner has weighed that and wants to proceed now given a concrete SOW-adherence-oversight motivation. Real-data check before this plan was approved: 872 sheets scanned, 1,662 existing scored-but-unlabeled `(sheet, slot)` pairs — 191 affected sheets in the historical AY2025, only 29 in the live AY2026 — confirming the grandfather-everything policy is the right call (a backlog this size should never be retroactively punished).

## Global Constraints

- **Required fields:** WW/PT slots need Description AND Date administered. QA needs Description only. Page # never gates, on any slot.
- **Gate fires only on a slot's roster-wide first score** — a slot that already has ≥1 real score (from any student, at any point) is permanently exempt, regardless of its label state. Editing an already-scored cell never gates.
- **`'Ongoing'` counts as a satisfied date** — matches existing date-administered semantics (`components/grading/date-administered-field.tsx`), do not treat it as unset.
- **The gate applies ONLY to the unlocked, direct-entry path.** The locked-sheet change-request (Path A, `apply_change_request_atomic`) and correction (Path B) flows in `app/api/grading-sheets/[id]/entries/[entryId]/route.ts` must be completely unaffected — verify this explicitly with a test, not just by code inspection.
- **No schema/migration changes** — reuses the existing `grading_sheets.slot_labels` jsonb column and `grade_entries.{ww_scores,pt_scores,qa_score}` as-is.
- **One combined write, not two sequential PATCHes** — the score and the label are sent together in one request to the entries route. Do not have the client fire a separate PATCH to the labels route as part of this feature.
- Design tokens only (Hard Rule #7) in the new dialog — reuse the existing `Input`/`DateAdministeredField` components verbatim, don't hand-roll new styled inputs.
- Every task ends with `npx tsc --noEmit` clean and its tests passing.

---

### Task 1: Shared pure gate predicate + shared label-sanitize module

**Files:**

- Create: `lib/grading/first-score-gate.ts`
- Create: `lib/grading/slot-label-sanitize.ts`
- Modify: `app/api/grading-sheets/[id]/labels/route.ts` (refactor only — extract existing inline sanitize functions into the new shared module, zero behavior change)
- Test: `__tests__/grading/first-score-gate.test.ts`
- Test: `__tests__/grading/slot-label-sanitize.test.ts`

**Interfaces:**

- Produces: `slotMetaSatisfied(kind, meta)`, `slotRosterScored(kind, index, roster)` from `first-score-gate.ts` — consumed by Task 2 (server) and Task 4 (client).
- Produces: `sanitizeLabel`, `sanitizePage`, `sanitizeDate`, `sanitizeMeta`, `mergeSlotLabel` from `slot-label-sanitize.ts` — consumed by Task 2 (server route) and this task's own refactor of the labels route.

- [ ] **Step 1: Write the failing tests for the gate predicate**

Create `__tests__/grading/first-score-gate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  slotMetaSatisfied,
  slotRosterScored,
} from '@/lib/grading/first-score-gate';

describe('slotMetaSatisfied', () => {
  it('WW/PT: requires both label and date', () => {
    expect(
      slotMetaSatisfied('ww', {
        label: 'Worksheet 2',
        date: '2026-07-01',
        page: null,
      })
    ).toBe(true);
    expect(
      slotMetaSatisfied('ww', { label: 'Worksheet 2', date: null, page: null })
    ).toBe(false);
    expect(
      slotMetaSatisfied('ww', { label: null, date: '2026-07-01', page: null })
    ).toBe(false);
    expect(slotMetaSatisfied('pt', null)).toBe(false);
    expect(slotMetaSatisfied('pt', undefined)).toBe(false);
  });

  it('WW/PT: page is irrelevant to satisfaction', () => {
    expect(
      slotMetaSatisfied('ww', { label: 'Quiz', date: '2026-07-01', page: null })
    ).toBe(true);
  });

  it('WW/PT: "Ongoing" counts as a satisfied date', () => {
    expect(
      slotMetaSatisfied('pt', { label: 'Project', date: 'Ongoing', page: null })
    ).toBe(true);
  });

  it('WW/PT: whitespace-only label or date is not satisfied', () => {
    expect(
      slotMetaSatisfied('ww', { label: '   ', date: '2026-07-01', page: null })
    ).toBe(false);
    expect(
      slotMetaSatisfied('ww', { label: 'Quiz', date: '  ', page: null })
    ).toBe(false);
  });

  it('QA: requires only a label (string form)', () => {
    expect(slotMetaSatisfied('qa', 'Quarterly Exam')).toBe(true);
    expect(slotMetaSatisfied('qa', '')).toBe(false);
    expect(slotMetaSatisfied('qa', null)).toBe(false);
    expect(slotMetaSatisfied('qa', undefined)).toBe(false);
  });

  it('QA: also accepts the { label } object shape', () => {
    expect(slotMetaSatisfied('qa', { label: 'Quarterly Exam' })).toBe(true);
  });
});

describe('slotRosterScored', () => {
  const roster = [
    { ww_scores: [10, null], pt_scores: [null, null], qa_score: null },
    { ww_scores: [null, null], pt_scores: [8, null], qa_score: 90 },
  ];

  it('WW: true if ANY roster row has a non-null score at that index', () => {
    expect(slotRosterScored('ww', 0, roster)).toBe(true);
    expect(slotRosterScored('ww', 1, roster)).toBe(false);
  });

  it('PT: true if ANY roster row has a non-null score at that index', () => {
    expect(slotRosterScored('pt', 0, roster)).toBe(true);
    expect(slotRosterScored('pt', 1, roster)).toBe(false);
  });

  it('QA: true if ANY roster row has a non-null qa_score', () => {
    expect(slotRosterScored('qa', null, roster)).toBe(true);
    expect(
      slotRosterScored('qa', null, [
        { ww_scores: [], pt_scores: [], qa_score: null },
      ])
    ).toBe(false);
  });

  it('empty roster is never scored', () => {
    expect(slotRosterScored('ww', 0, [])).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/grading/first-score-gate.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write `lib/grading/first-score-gate.ts`**

```ts
import type { SlotMeta } from '@/lib/schemas/grading-sheet';

export type SlotKind = 'ww' | 'pt' | 'qa';

/**
 * Required metadata satisfied? WW/PT need label+date; QA needs only a label
 * (passed either as the plain string `slot_labels.qa` or as `{ label }`).
 * Page # never gates. 'Ongoing' counts as a satisfied date — matches the
 * existing date-administered semantics (date-administered-field.tsx).
 */
export function slotMetaSatisfied(
  kind: SlotKind,
  meta: SlotMeta | string | { label?: string | null } | null | undefined
): boolean {
  if (kind === 'qa') {
    const label =
      typeof meta === 'string'
        ? meta
        : (meta as { label?: string | null } | null)?.label;
    return !!(label ?? '').trim();
  }
  const m = (meta ?? null) as SlotMeta | null;
  return !!(m?.label ?? '').trim() && !!(m?.date ?? '').trim();
}

/** Does this slot already hold a committed score anywhere in the given roster? */
export function slotRosterScored(
  kind: SlotKind,
  index: number | null,
  roster: {
    ww_scores: (number | null)[];
    pt_scores: (number | null)[];
    qa_score: number | null;
  }[]
): boolean {
  if (kind === 'qa') return roster.some((r) => r.qa_score != null);
  return roster.some(
    (r) => (kind === 'ww' ? r.ww_scores : r.pt_scores)[index!] != null
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/grading/first-score-gate.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Write the failing tests for the shared sanitize module**

Read `app/api/grading-sheets/[id]/labels/route.ts` lines 1-115 first — this step extracts `sanitizeLabel`/`sanitizePage`/`sanitizeDate`/`sanitizeMeta` (currently inline, lines 92-115) verbatim into the new module, plus adds a new `mergeSlotLabel` function Task 2 needs.

Create `__tests__/grading/slot-label-sanitize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  sanitizeLabel,
  sanitizePage,
  sanitizeDate,
  sanitizeMeta,
  mergeSlotLabel,
} from '@/lib/grading/slot-label-sanitize';

describe('sanitizeLabel', () => {
  it('trims, caps at 120 chars, empty -> null', () => {
    expect(sanitizeLabel('  Worksheet 2  ')).toBe('Worksheet 2');
    expect(sanitizeLabel('')).toBe(null);
    expect(sanitizeLabel('   ')).toBe(null);
    expect(sanitizeLabel(null)).toBe(null);
    expect(sanitizeLabel('a'.repeat(200)).length).toBe(120);
  });
});

describe('sanitizeDate', () => {
  it('accepts ISO date and the literal "Ongoing"', () => {
    expect(sanitizeDate('2026-07-01')).toBe('2026-07-01');
    expect(sanitizeDate('Ongoing')).toBe('Ongoing');
  });
  it('rejects anything else as null', () => {
    expect(sanitizeDate('not-a-date')).toBe(null);
    expect(sanitizeDate('')).toBe(null);
    expect(sanitizeDate(null)).toBe(null);
  });
});

describe('sanitizeMeta', () => {
  it('sanitizes all three fields independently', () => {
    expect(
      sanitizeMeta({ label: '  Quiz  ', date: 'Ongoing', page: '  p.5  ' })
    ).toEqual({ label: 'Quiz', date: 'Ongoing', page: 'p.5' });
    expect(sanitizeMeta(null)).toBe(null);
  });
});

describe('mergeSlotLabel', () => {
  it('WW/PT: patches only the targeted index, preserving the rest of the array', () => {
    const current = {
      ww: [{ label: 'W1', date: '2026-07-01', page: null }, null],
      pt: [],
      qa: null,
    };
    const merged = mergeSlotLabel(current, {
      kind: 'ww',
      index: 1,
      meta: { label: 'W2', date: '2026-07-02', page: null },
    });
    expect(merged.ww?.[0]).toEqual({
      label: 'W1',
      date: '2026-07-01',
      page: null,
    });
    expect(merged.ww?.[1]).toEqual({
      label: 'W2',
      date: '2026-07-02',
      page: null,
    });
  });

  it('WW/PT: pads with nulls when the index is beyond the current array length', () => {
    const merged = mergeSlotLabel(
      { ww: [], pt: [], qa: null },
      {
        kind: 'pt',
        index: 2,
        meta: { label: 'PT3', date: '2026-07-03', page: null },
      }
    );
    expect(merged.pt).toEqual([
      null,
      null,
      { label: 'PT3', date: '2026-07-03', page: null },
    ]);
  });

  it('QA: replaces the qa string, ignores ww/pt', () => {
    const current = {
      ww: [{ label: 'W1', date: '2026-07-01', page: null }],
      pt: [],
      qa: null,
    };
    const merged = mergeSlotLabel(current, {
      kind: 'qa',
      index: null,
      meta: { label: 'Quarterly Exam' },
    });
    expect(merged.qa).toBe('Quarterly Exam');
    expect(merged.ww).toEqual(current.ww);
  });

  it('handles a null current slot_labels (fresh sheet)', () => {
    const merged = mergeSlotLabel(null, {
      kind: 'ww',
      index: 0,
      meta: { label: 'W1', date: '2026-07-01', page: null },
    });
    expect(merged.ww?.[0]).toEqual({
      label: 'W1',
      date: '2026-07-01',
      page: null,
    });
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npx vitest run __tests__/grading/slot-label-sanitize.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 7: Write `lib/grading/slot-label-sanitize.ts`**

```ts
import type { SlotMeta, SlotLabels } from '@/lib/schemas/grading-sheet';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Sanitize per-field: trim, enforce max length, coerce empty to null. Lifted
// verbatim from app/api/grading-sheets/[id]/labels/route.ts (KD #105) so the
// entries route (first-score gate) can share the exact same rules — a slot's
// 'Ongoing'/ISO-date/trim/cap behavior must never drift between the two
// write paths.
export function sanitizeLabel(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = String(v).trim().slice(0, 120);
  return t || null;
}

export function sanitizePage(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = String(v).trim().slice(0, 40);
  return t || null;
}

export function sanitizeDate(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  if (t === 'Ongoing') return 'Ongoing';
  return ISO_DATE_RE.test(t) ? t : null;
}

export function sanitizeMeta(m: SlotMeta | null | undefined): SlotMeta | null {
  if (m == null) return null;
  return {
    label: sanitizeLabel(m.label),
    date: sanitizeDate(m.date),
    page: sanitizePage(m.page),
  };
}

/**
 * Patches ONE slot's metadata into a full slot_labels object, preserving
 * every other slot untouched. Used by the entries route's first-score gate
 * (Task 2), which — unlike the labels route's full-array replace — only
 * ever knows about the single slot the teacher just unlocked.
 */
export function mergeSlotLabel(
  current: SlotLabels | null,
  incoming: {
    kind: 'ww' | 'pt' | 'qa';
    index: number | null;
    meta: SlotMeta | { label: string | null };
  }
): SlotLabels {
  const base: SlotLabels = {
    ww: current?.ww ?? [],
    pt: current?.pt ?? [],
    qa: current?.qa ?? null,
  };
  if (incoming.kind === 'qa') {
    return {
      ...base,
      qa: sanitizeLabel((incoming.meta as { label: string | null }).label),
    };
  }
  const arrKey = incoming.kind;
  const arr = [...(base[arrKey] ?? [])];
  const idx = incoming.index as number;
  while (arr.length <= idx) arr.push(null);
  arr[idx] = sanitizeMeta(incoming.meta as SlotMeta);
  return { ...base, [arrKey]: arr };
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run __tests__/grading/slot-label-sanitize.test.ts`
Expected: PASS (all cases).

- [ ] **Step 9: Refactor the labels route to use the shared module (behavior-identical)**

In `app/api/grading-sheets/[id]/labels/route.ts`:

- Remove the inline `ISO_DATE_RE` const (line 8) and the four inline `sanitizeLabel`/`sanitizePage`/`sanitizeDate`/`sanitizeMeta` function definitions (lines 92-115).
- Add `import { sanitizeLabel, sanitizeMeta } from '@/lib/grading/slot-label-sanitize';` (the route only calls `sanitizeMeta` directly on each ww/pt entry and `sanitizeLabel` on `qa` — confirm by reading lines 117-120 which are unchanged: `newLabels.ww = (body.ww ?? []).map(sanitizeMeta); newLabels.pt = (body.pt ?? []).map(sanitizeMeta); newLabels.qa = sanitizeLabel(body.qa);`).
- This is a pure extraction — the function bodies must be character-for-character identical to what's being removed. Verify with `git diff` that the route's runtime behavior is unchanged (same trim/cap/Ongoing/ISO rules), only the functions' location moved.

- [ ] **Step 10: Typecheck and run the full suite**

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npx vitest run`
Expected: all passing, no regressions (the labels route refactor must not change any existing test's outcome — if any test currently exercises this route, confirm it still passes unchanged).

- [ ] **Step 11: Commit**

```bash
git add lib/grading/first-score-gate.ts lib/grading/slot-label-sanitize.ts "app/api/grading-sheets/[id]/labels/route.ts" __tests__/grading/first-score-gate.test.ts __tests__/grading/slot-label-sanitize.test.ts
git commit -m "feat(grading): add shared first-score gate predicate + extract slot-label sanitizers"
```

---

### Task 2: Server-side enforcement in the entries route

**Files:**

- Modify: `app/api/grading-sheets/[id]/entries/[entryId]/route.ts`
- Test: `__tests__/grading/entries-label-gate.test.ts`

**Interfaces:**

- Consumes: `slotMetaSatisfied`, `slotRosterScored` from Task 1's `lib/grading/first-score-gate.ts`; `mergeSlotLabel` from Task 1's `lib/grading/slot-label-sanitize.ts`.
- Produces: the entries PATCH body gains an optional `slot_label` field (contract below), and the route returns `422 { error, code: 'label_required', slots: string[] }` when a genuine first score arrives ungated. This is what Task 4 (client) will send.

**Read `app/api/grading-sheets/[id]/entries/[entryId]/route.ts` in full first** — it's a 750-line file with a delicate two-path lock model (Path A change-request apply via `apply_change_request_atomic`, Path B correction, and the unlocked direct-write `else` branch at the bottom of the `if (sheet.is_locked && appliedChangeRequest) {...} else {...}` block). **The gate must be its own independent `if (!sheet.is_locked)` block — not tied to which of those two write-branches executes** (a locked sheet running Path B correction also lands in the `else` write-branch today, since `appliedChangeRequest` is null for Path B — so gating on the write-branch instead of `sheet.is_locked` directly would incorrectly gate Path B corrections).

- [ ] **Step 1: Write the failing route tests**

Create `__tests__/grading/entries-label-gate.test.ts`. Follow this repo's existing pattern for testing this route — check for an existing test file covering `entries/[entryId]/route.ts` (search `__tests__/` for imports from that path) and match its mocking style for `requireRole` + `createServiceClient` (chainable `.from().select().eq()...` stub). If no existing test covers this route, build the minimal chainable Supabase mock needed for: two initial `Promise.all` selects (`grading_sheets`, `grade_entries` by id), a `grade_entries` roster select (`.eq('grading_sheet_id', ...)`), a `grading_sheets` update (for the label merge), and the final `grade_entries` update (for the score write) + its audit/drill-invalidation side effects (these can be no-op stubs — the test only asserts on the gate's behavior, not the full write pipeline).

Cover:

```ts
// Pseudocode structure — adapt to this repo's actual mock helpers once located.
describe('entries route — first-score label gate', () => {
  it('unlocked sheet, genuine first WW score, no label, no slot_label supplied -> 422 label_required', async () => { ... });
  it('unlocked sheet, genuine first WW score, valid slot_label supplied -> 200, label merged before the score write', async () => { ... });
  it('unlocked sheet, slot already scored by another roster row -> 200, no gate even with no label', async () => { ... });
  it('unlocked sheet, editing THIS entry\'s own existing non-null score -> 200, no gate', async () => { ... });
  it('unlocked sheet, slot_labels already satisfies the slot -> 200, no gate, no slot_label needed', async () => { ... });
  it('QA slot: needs only a label, no date required', async () => { ... });
  it('locked sheet, Path A change-request apply -> gate never runs (no label_required possible)', async () => { ... });
  it('locked sheet, Path B correction -> gate never runs', async () => { ... });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/grading/entries-label-gate.test.ts`
Expected: FAIL — the route doesn't implement the gate yet (all 422-expecting cases get 200, or the mock setup itself needs the new `slot_labels` select field first — iterate on the mock until it fails for the RIGHT reason, i.e. missing gate logic, not a broken test harness).

- [ ] **Step 3: Add `slot_labels` to the sheet select**

In the `Promise.all` sheet select (currently `id, ww_totals, pt_totals, qa_total, is_locked, subject:subjects(is_examinable), subject_config:subject_configs(ww_weight, pt_weight, qa_weight)`), add `slot_labels`:

```ts
    service
      .from('grading_sheets')
      .select(
        `id, ww_totals, pt_totals, qa_total, is_locked, slot_labels,
         subject:subjects(is_examinable),
         subject_config:subject_configs(ww_weight, pt_weight, qa_weight)`
      )
      .eq('id', sheetId)
      .single(),
```

Update the `sheet` type cast to add `slot_labels: SlotLabels | null` (import `type { SlotLabels } from '@/lib/schemas/grading-sheet';`).

- [ ] **Step 4: Add `slot_label` to the body type**

Add to the existing body type:

```ts
    slot_label?: {
      kind: 'ww' | 'pt' | 'qa';
      index: number | null;
      meta: { label: string | null; date?: string | null; page?: string | null };
    };
```

- [ ] **Step 5: Insert the gate block**

Place this **after** `computed` is calculated (after the `computeQuarterly(...)` call) and **before** the `let updated: Record<string, unknown> | null = null;` write-dispatch block:

```ts
// ----- First-score label gate (unlocked/direct path only; Hard Rule #5's
// locked change-request/correction paths are never touched by this) -----
if (!sheet.is_locked) {
  const { data: rosterRaw } = await service
    .from('grade_entries')
    .select('id, ww_scores, pt_scores, qa_score')
    .eq('grading_sheet_id', sheetId);
  const others = (
    (rosterRaw ?? []) as {
      id: string;
      ww_scores: (number | null)[] | null;
      pt_scores: (number | null)[] | null;
      qa_score: number | null;
    }[]
  )
    .filter((r) => r.id !== entryId)
    .map((r) => ({
      ww_scores: (r.ww_scores ?? []) as (number | null)[],
      pt_scores: (r.pt_scores ?? []) as (number | null)[],
      qa_score: r.qa_score,
    }));

  const prevWw = (entry.ww_scores as (number | null)[] | null) ?? [];
  const prevPt = (entry.pt_scores as (number | null)[] | null) ?? [];
  const prevQa = entry.qa_score as number | null;
  const labels = (sheet.slot_labels ?? {}) as SlotLabels;

  const incomingSatisfies = (kind: SlotKind, idx: number | null) =>
    !!body.slot_label &&
    body.slot_label.kind === kind &&
    (body.slot_label.index ?? null) === idx &&
    slotMetaSatisfied(kind, body.slot_label.meta);

  const violations: string[] = [];
  const checkSlot = (
    kind: SlotKind,
    idx: number | null,
    newVal: number | null,
    prevVal: number | null,
    existingMeta: unknown
  ) => {
    if (newVal == null || prevVal != null) return; // not a genuine new score
    if (slotRosterScored(kind, idx, others)) return; // grandfathered
    if (slotMetaSatisfied(kind, existingMeta as SlotMeta | string | null))
      return; // already labeled
    if (incomingSatisfies(kind, idx)) return; // client supplying it now
    violations.push(
      kind === 'qa' ? 'QA' : `${kind.toUpperCase()}${(idx as number) + 1}`
    );
  };

  ww_scores.forEach((v, i) =>
    checkSlot('ww', i, v, prevWw[i] ?? null, labels.ww?.[i])
  );
  pt_scores.forEach((v, i) =>
    checkSlot('pt', i, v, prevPt[i] ?? null, labels.pt?.[i])
  );
  checkSlot('qa', null, qa_score, prevQa, labels.qa);

  if (violations.length > 0) {
    const needsDate = violations.some((v) => v !== 'QA');
    return NextResponse.json(
      {
        error: `Add a description${needsDate ? ' and date administered' : ''} before entering the first score for ${violations.join(', ')}.`,
        code: 'label_required',
        slots: violations,
      },
      { status: 422 }
    );
  }

  if (body.slot_label) {
    const merged = mergeSlotLabel(
      sheet.slot_labels as SlotLabels | null,
      body.slot_label
    );
    const { error: lblErr } = await service
      .from('grading_sheets')
      .update({ slot_labels: merged })
      .eq('id', sheetId);
    if (lblErr)
      return NextResponse.json({ error: lblErr.message }, { status: 500 });
  }
}
```

Add the imports: `import { slotMetaSatisfied, slotRosterScored, type SlotKind } from '@/lib/grading/first-score-gate';` and `import { mergeSlotLabel } from '@/lib/grading/slot-label-sanitize';`.

**Note on `ww_scores`/`pt_scores`/`qa_score` used above:** these are the already-normalized, already-range-validated local variables from earlier in the handler (`const ww_scores = normalizeArr(...)`, etc.) — the gate reads the same normalized values the rest of the handler uses, not the raw request body.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run __tests__/grading/entries-label-gate.test.ts`
Expected: PASS (all 8 cases).

- [ ] **Step 7: Typecheck and run the full suite**

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npx vitest run`
Expected: all passing — **pay special attention to any existing test covering change-request apply (Path A) or corrections (Path B) on this route** (search `__tests__/change-requests/` — `decide.test.ts`, `slot-index-ceiling.test.ts` were found this session to reference this route indirectly) — confirm none of them regress, since this task adds a new code path that must be provably inert for those flows.

- [ ] **Step 8: Commit**

```bash
git add "app/api/grading-sheets/[id]/entries/[entryId]/route.ts" __tests__/grading/entries-label-gate.test.ts
git commit -m "feat(grading): server-side first-score label gate on the entries route"
```

---

### Task 3: The intercepting dialog component

**Files:**

- Create: `components/grading/first-score-label-dialog.tsx`
- Test: `__tests__/grading/first-score-label-dialog.test.tsx`

**Interfaces:**

- Consumes: `slotMetaSatisfied` from Task 1; the existing `components/grading/date-administered-field.tsx` (`DateAdministeredField`) and `components/ui/dialog.tsx` (`Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogFooter`).
- Produces: `FirstScoreLabelDialog` component, consumed by Task 4.

**Read first:** the existing editable `ActivityRow` in `components/grading/score-entry-grid.tsx` (the `if (editable) { ... }` branch, both the `qaMode` and non-QA sub-branches) — this dialog reuses the exact same input shapes (a plain `Input` for description with `maxLength={120}`, an optional `Input` for page with `maxLength={40}` placeholder `"p.#"`, and `DateAdministeredField` for the date), just inside a `Dialog` instead of inline in the grid.

- [ ] **Step 1: Write the failing test**

Create `__tests__/grading/first-score-label-dialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FirstScoreLabelDialog } from '@/components/grading/first-score-label-dialog';

describe('FirstScoreLabelDialog', () => {
  it('WW/PT mode: Save is disabled until BOTH description and date are filled', () => {
    const onConfirm = vi.fn();
    render(
      <FirstScoreLabelDialog
        open
        kind="ww"
        slotCode="W2"
        seedMeta={{ label: '', date: '', page: '' }}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );
    const save = screen.getByRole('button', { name: /save/i });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: 'Worksheet 2' },
    });
    expect(save).toBeDisabled(); // date still missing

    // Date administered has its own established UI (DatePicker + Ongoing toggle) —
    // exercise it via whatever DateAdministeredField already exposes (check the
    // component's existing test conventions, if any, or its rendered controls).
  });

  it('QA mode: Save requires only a description, no date/page fields render', () => {
    render(
      <FirstScoreLabelDialog
        open
        kind="qa"
        slotCode="QA"
        seedMeta={{ label: '' }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(
      screen.queryByLabelText(/date administered/i)
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/page/i)).not.toBeInTheDocument();
    const save = screen.getByRole('button', { name: /save/i });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: 'Quarterly Exam' },
    });
    expect(save).not.toBeDisabled();
  });

  it('Save fires onConfirm with the entered metadata', () => {
    const onConfirm = vi.fn();
    render(
      <FirstScoreLabelDialog
        open
        kind="qa"
        slotCode="QA"
        seedMeta={{ label: '' }}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );
    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: 'Quarterly Exam' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Quarterly Exam' })
    );
  });

  it('Cancel fires onCancel, not onConfirm', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <FirstScoreLabelDialog
        open
        kind="ww"
        slotCode="W1"
        seedMeta={{ label: '', date: '', page: '' }}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
```

Adjust the date-field assertions once you've read `DateAdministeredField`'s actual rendered output (its own props/DOM structure) — the goal is: confirm Save stays disabled with description-only filled, and becomes enabled once both description AND a date (real or "Ongoing") are set, for WW/PT.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/grading/first-score-label-dialog.test.tsx`
Expected: FAIL — component doesn't exist.

- [ ] **Step 3: Write `components/grading/first-score-label-dialog.tsx`**

```tsx
'use client';

import { useState } from 'react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DateAdministeredField } from './date-administered-field';
import {
  slotMetaSatisfied,
  type SlotKind,
} from '@/lib/grading/first-score-gate';
import type { SlotMeta } from '@/lib/schemas/grading-sheet';

// Intercepts a slot's very first score (roster-wide) — reuses the exact same
// input shapes as the "Activity labels" panel's editable ActivityRow, just
// surfaced as a focused dialog instead of an inline row. Save is disabled
// until the same slotMetaSatisfied rule the server independently enforces
// is met, so client and server validation are provably the same predicate.
export function FirstScoreLabelDialog({
  open,
  kind,
  slotCode,
  seedMeta,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  kind: SlotKind;
  slotCode: string;
  seedMeta: SlotMeta;
  onConfirm: (meta: SlotMeta) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(seedMeta.label ?? '');
  const [date, setDate] = useState(seedMeta.date ?? '');
  const [page, setPage] = useState(seedMeta.page ?? '');

  const meta: SlotMeta = { label, date, page };
  const canSave = slotMetaSatisfied(kind, meta);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Label {slotCode} before its first score</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-2">
          <div className="space-y-1.5">
            <label
              htmlFor="first-score-label-desc"
              className="text-sm font-medium"
            >
              Description
            </label>
            <Input
              id="first-score-label-desc"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={
                kind === 'qa'
                  ? 'e.g. Quarterly Exam'
                  : 'e.g. Worksheet 2: Multiplication Tables'
              }
              maxLength={120}
              autoFocus
            />
          </div>
          {kind !== 'qa' && (
            <>
              <div className="space-y-1.5">
                <label
                  htmlFor="first-score-label-page"
                  className="text-sm font-medium"
                >
                  Page #{' '}
                  <span className="text-muted-foreground">(optional)</span>
                </label>
                <Input
                  id="first-score-label-page"
                  value={page}
                  onChange={(e) => setPage(e.target.value)}
                  placeholder="p.#"
                  maxLength={40}
                />
              </div>
              <div className="space-y-1.5">
                <span className="text-sm font-medium">Date administered</span>
                <DateAdministeredField value={date} onChange={setDate} />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!canSave}
            onClick={() => onConfirm(meta)}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Adjust the `label`/`htmlFor` wiring if `Input` or the surrounding form primitives in this codebase expect a different accessible-labeling convention (e.g. `Label` component from `components/ui/label.tsx`) — check `ActivityRow`'s own `aria-label` pattern (`aria-label={\`${code} description\`}`) and match whichever convention this codebase actually uses consistently, rather than introducing a third pattern.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/grading/first-score-label-dialog.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: no regressions.

- [ ] **Step 7: Commit**

```bash
git add components/grading/first-score-label-dialog.tsx __tests__/grading/first-score-label-dialog.test.tsx
git commit -m "feat(grading): add the first-score label dialog component"
```

---

### Task 4: Client-side gate wiring in `score-entry-grid.tsx`

**Files:**

- Modify: `components/grading/score-entry-grid.tsx`
- Test: `__tests__/grading/score-entry-grid.test.tsx` (new — first test coverage of this component at all)

**Interfaces:**

- Consumes: `slotMetaSatisfied`, `slotRosterScored` (Task 1), `FirstScoreLabelDialog` (Task 3).
- Produces: the grid's PATCH payload to `/api/grading-sheets/[id]/entries/[entryId]` gains the `slot_label` field (Task 2's contract) when the gate resolves via dialog confirm.

**Critical correctness note (do not skip):** the file's existing `wwScored`/`ptScored` (around lines 469-482, `rows.some((r) => r.ww_scores[i] != null)`) are memoized on `rows`, which is updated **optimistically on every keystroke** via `onLocalChange`. By the time a score commits (`onCommit`/blur), the just-typed value is already reflected in `rows`, so `wwScored[i]` would already read `true` — **the gate must NOT use `wwScored`/`ptScored` at commit time, it would never fire.** Use `savedRowsRef` instead (already in the file, line ~169-171) — a `Map<entry_id, GradeRow>` that only advances on a successful server PATCH, giving the server-confirmed roster-wide truth the gate actually needs (and matching exactly what the server independently checks in Task 2).

- [ ] **Step 1: Read the file's current commit sites and `patchEntry` in full**

Read `components/grading/score-entry-grid.tsx` completely before editing — confirm the exact current line numbers for: `savedRowsRef` declaration, `labelsRef`/`onSlotChange`/`onQaChange`, `patchEntry`'s signature and body (the `payload` construction near the end), and the three `ScoreInput onCommit` call sites (WW, PT, QA). Line numbers below are from this session's read and may have shifted slightly — locate by the code shown, not by number alone.

- [ ] **Step 2: Write the failing grid tests**

Create `__tests__/grading/score-entry-grid.test.tsx`. Follow this repo's established client-component test conventions (`renderWithClient` from `__tests__/_utils/render-with-client`, `stubFetch`/`jsonResponse` from `__tests__/_utils/mock-fetch`, the `next/navigation` mock pattern used by sibling `__tests__/grading/*.test.tsx` files if any exist, or the pattern from `__tests__/ui/data-table-expandable.test.tsx` if none do). Build a minimal `GradeRow[]` fixture (2 students, 1 WW slot, 1 PT slot, a QA slot) with no scores and no labels initially.

Cover:

```ts
// Pseudocode structure — adapt exactly to this repo's real render/mock helpers.
describe('ScoreEntryGrid — first-score label gate', () => {
  it('typing the first WW score for a slot opens the label dialog, does not PATCH yet', () => { ... });
  it('dialog Save fires exactly one PATCH carrying both the score and slot_label', () => { ... });
  it('dialog Cancel fires no PATCH and the cell reverts to blank', () => { ... });
  it('a slot already scored by another student in the roster never opens the dialog', () => { ... });
  it('editing an existing non-null score on the same cell never opens the dialog', () => { ... });
  it('a slot whose metadata already satisfies the rule commits the first score directly, no dialog', () => { ... });
  it('QA slot: same first-score gate, description-only dialog', () => { ... });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run __tests__/grading/score-entry-grid.test.tsx`
Expected: FAIL — the gate isn't wired yet, every case that expects the dialog to appear/not-appear fails.

- [ ] **Step 4: Add the commit-time roster-scored check**

Near `savedRowsRef`, add:

```ts
const slotAlreadyScored = useCallback(
  (kind: 'ww' | 'pt' | 'qa', index: number | null): boolean => {
    for (const saved of savedRowsRef.current.values()) {
      const v =
        kind === 'qa'
          ? saved.qa_score
          : (kind === 'ww' ? saved.ww_scores : saved.pt_scores)[index!];
      if (v != null) return true;
    }
    return false;
  },
  []
);
```

- [ ] **Step 5: Add `pendingFirstScore` state**

Near the other `useState` declarations:

```ts
const [pendingFirstScore, setPendingFirstScore] = useState<{
  entryId: string;
  kind: 'ww' | 'pt' | 'qa';
  slotIndex: number | null;
  target: Omit<ChangeReferenceTarget, 'sheetId' | 'entryId'>;
  body: Partial<Pick<GradeRow, 'ww_scores' | 'pt_scores' | 'qa_score'>>;
  seedMeta: SlotMeta;
} | null>(null);
```

- [ ] **Step 6: Extend `patchEntry` to optionally attach a `slot_label`**

Add a 4th optional parameter and thread it into the payload construction (find the line `const payload = { ...body, ...(bodyOverride ?? {}), ...extraPayload };` inside `patchEntry`):

```ts
const patchEntry = useCallback(
  async (
    entryId: string,
    target: Omit<ChangeReferenceTarget, 'sheetId' | 'entryId'>,
    body: Partial<
      Pick<
        GradeRow,
        'ww_scores' | 'pt_scores' | 'qa_score' | 'letter_grade' | 'is_na'
      >
    >,
    slotLabel?: {
      kind: 'ww' | 'pt' | 'qa';
      index: number | null;
      meta: SlotMeta | { label: string | null };
    }
  ) => {
    // ...unchanged body...
    // change only:
    const payload = {
      ...body,
      ...(bodyOverride ?? {}),
      ...extraPayload,
      ...(slotLabel ? { slot_label: slotLabel } : {}),
    };
    // ...rest unchanged...
  },
  [
    /* existing deps unchanged */
  ]
);
```

- [ ] **Step 7: Add the `commitScore` gate wrapper**

Add near `patchEntry`:

```ts
const commitScore = useCallback(
  (
    entryId: string,
    kind: 'ww' | 'pt' | 'qa',
    slotIndex: number | null,
    target: Omit<ChangeReferenceTarget, 'sheetId' | 'entryId'>,
    body: Partial<Pick<GradeRow, 'ww_scores' | 'pt_scores' | 'qa_score'>>,
    value: number | null
  ) => {
    const gated =
      !readOnly &&
      !requireApproval &&
      value != null &&
      !slotAlreadyScored(kind, slotIndex) &&
      !slotMetaSatisfied(
        kind,
        kind === 'qa'
          ? labelsRef.current.qa
          : labelsRef.current[kind][slotIndex!]
      );
    if (gated) {
      const seedMeta: SlotMeta =
        kind === 'qa'
          ? { label: labelsRef.current.qa ?? '', date: null, page: null }
          : ((labelsRef.current[kind][slotIndex!] as SlotMeta | null) ?? {
              label: '',
              date: '',
              page: '',
            });
      setPendingFirstScore({
        entryId,
        kind,
        slotIndex,
        target,
        body,
        seedMeta,
      });
      return;
    }
    patchEntry(entryId, target, body);
  },
  [readOnly, requireApproval, slotAlreadyScored, patchEntry]
);
```

Add the import: `import { slotMetaSatisfied } from '@/lib/grading/first-score-gate';`.

- [ ] **Step 8: Replace the three `onCommit` call sites to go through `commitScore`**

WW (previously called `patchEntry` directly):

```tsx
onCommit={(v) => {
  const next = replaceAt(r.ww_scores, i, v, wwTotals.length);
  commitScore(r.entry_id, 'ww', i, { field: 'ww_scores', slotIndex: i }, { ww_scores: next }, v);
}}
```

PT (same shape):

```tsx
onCommit={(v) => {
  const next = replaceAt(r.pt_scores, i, v, ptTotals.length);
  commitScore(r.entry_id, 'pt', i, { field: 'pt_scores', slotIndex: i }, { pt_scores: next }, v);
}}
```

QA:

```tsx
onCommit={(v) =>
  commitScore(r.entry_id, 'qa', null, { field: 'qa_score', slotIndex: null }, { qa_score: v }, v)
}
```

- [ ] **Step 9: Add the dialog confirm/cancel handlers**

```ts
const handleFirstScoreConfirm = useCallback(
  (meta: SlotMeta) => {
    if (!pendingFirstScore) return;
    const { entryId, kind, slotIndex, target, body } = pendingFirstScore;
    if (kind === 'qa') {
      onQaChange(meta.label ?? '');
    } else {
      onSlotChange(kind, slotIndex as number, meta);
    }
    patchEntry(entryId, target, body, {
      kind,
      index: slotIndex,
      meta: kind === 'qa' ? { label: meta.label ?? null } : meta,
    });
    setPendingFirstScore(null);
  },
  [pendingFirstScore, onQaChange, onSlotChange, patchEntry]
);

const handleFirstScoreCancel = useCallback(() => {
  if (!pendingFirstScore) return;
  const { entryId, body } = pendingFirstScore;
  const saved = savedRowsRef.current.get(entryId);
  if (saved) {
    setRows((current) =>
      current.map((r) =>
        r.entry_id === entryId
          ? revertPatchedFields(r, saved, body as EntryPatchBody)
          : r
      )
    );
  }
  setPendingFirstScore(null);
}, [pendingFirstScore]);
```

- [ ] **Step 10: Mount the dialog**

Add `import { FirstScoreLabelDialog } from './first-score-label-dialog';`, then mount it as a sibling to the existing `{approvalDialog}` render (find where that's currently rendered in the JSX return):

```tsx
{
  pendingFirstScore && (
    <FirstScoreLabelDialog
      open
      kind={pendingFirstScore.kind}
      slotCode={
        pendingFirstScore.kind === 'qa'
          ? 'QA'
          : `${pendingFirstScore.kind.toUpperCase()}${(pendingFirstScore.slotIndex as number) + 1}`
      }
      seedMeta={pendingFirstScore.seedMeta}
      onConfirm={handleFirstScoreConfirm}
      onCancel={handleFirstScoreCancel}
    />
  );
}
```

- [ ] **Step 11: Run tests to verify they pass**

Run: `npx vitest run __tests__/grading/score-entry-grid.test.tsx`
Expected: PASS (all cases).

- [ ] **Step 12: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 13: Run the full test suite and build**

Run: `npx vitest run`
Expected: no regressions — in particular, any existing test exercising `patchEntry`'s call sites indirectly (none were found this session, but re-confirm) must still pass with the new 4th optional parameter (it's additive/optional, so untouched call sites are unaffected).

Run: `npx next build`
Expected: clean.

- [ ] **Step 14: Manual verification (no automated substitute — this is the full end-to-end flow)**

As a subject teacher on an unlocked sheet: enter a first score into a fresh WW slot → dialog appears → fill Description + Date → confirm → score saves, the "Activity labels" panel immediately shows the new label (no amber "Needs a label" flag). Enter a second student's score in the same slot → no dialog, saves directly. Edit the first student's score again → no dialog. Try a QA slot → description-only dialog. Cancel a dialog mid-flow → the cell reverts to blank, nothing saved. Confirm a locked sheet's teacher view still shows read-only cells (unaffected), and a manager's change-request/correction flow on a locked sheet is completely unaffected by any of this.

- [ ] **Step 15: Commit**

```bash
git add components/grading/score-entry-grid.tsx __tests__/grading/score-entry-grid.test.tsx
git commit -m "feat(grading): wire the first-score label gate into the score-entry grid"
```

---

## Notes

- The diagnostic script (plan Step 0) was already run before this implementation plan was written — see the design doc / conversation record for the real numbers (872 sheets, 1,662 existing scored-but-unlabeled pairs, 191 in AY2025 vs 29 in AY2026). No further action needed on it; it was a throwaway, already deleted, nothing to commit.
- Once this ships, consider a follow-up KD #105 update note documenting the reversal (migration 057's header comment describes almost this exact rule but was never implemented until now — worth reconciling that stale comment with reality, but that's a documentation-only follow-up, not part of this implementation).
