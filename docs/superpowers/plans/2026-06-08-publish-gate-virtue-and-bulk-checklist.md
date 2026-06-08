# Publish gate: virtue into comment hard-gate + bulk-publish checklist — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold the per-term virtue theme into the report-card comment hard-gate (so a card can't publish with a complete comment under a missing virtue heading), and give the bulk-publish dialog the readiness checklist + publish-ready/skip-blocked behaviour the single-section flow already has.

**Architecture:** Part 1 extends the shared `cumulativeCommentGaps` helper (the one source both the checklist display and the server block use) to treat a null `virtue_theme` as a gap; the two callers pass the column and surface it. Part 2 makes `BulkPublishDialog` fetch per-section `publish-readiness`, classify ✓/⚠/✗, and publish all non-hard-blocked sections.

**Tech Stack:** Next.js 16, TypeScript, Supabase, shadcn/ui, vitest.

**Spec:** `docs/superpowers/specs/2026-06-08-publish-gate-virtue-and-bulk-checklist-design.md`

---

## File structure

- **Modify** `lib/markbook/comment-completeness.ts` — virtue in `CumulativeTerm`/`CumulativeGap` + `cumulativeCommentGaps`.
- **Modify** `__tests__/markbook/comment-completeness.test.ts` — set `virtue_theme` on fixtures (keep comment tests green) + add virtue cases.
- **Modify** `app/api/report-card-publications/route.ts` — pass `virtue_theme`; virtue in the 422 message + payload.
- **Modify** `app/api/sections/[id]/publish-readiness/route.ts` — pass `virtue_theme` to the gate; remove the soft `virtue_readiness` block.
- **Modify** `components/admin/publish-window-panel.tsx` — comment row shows virtue gaps; remove the soft virtue row.
- **Modify** `components/admin/bulk-publish-dialog.tsx` — readiness fetch + classify + publish-ready/skip-blocked.

---

## Task 1: Virtue theme in the comment gate (logic + tests)

**Files:** Modify `lib/markbook/comment-completeness.ts`; Modify `__tests__/markbook/comment-completeness.test.ts`

- [ ] **Step 1: Update existing test fixtures so they isolate the comment logic**

In `__tests__/markbook/comment-completeness.test.ts`, the `TERMS` fixture (and the inline `ROSTER_WITH_T2_JOINER`/boundary cases reuse `TERMS`) must carry a non-empty `virtue_theme`, otherwise the new virtue check will make every existing "0 gaps" test fail. Change `TERMS` to:

```ts
const TERMS: CumulativeTerm[] = [
  {
    id: 't1',
    term_number: 1,
    end_date: '2026-03-31',
    virtue_theme: 'Diligence',
  },
  { id: 't2', term_number: 2, end_date: '2026-06-30', virtue_theme: 'Respect' },
  {
    id: 't3',
    term_number: 3,
    end_date: '2026-09-30',
    virtue_theme: 'Integrity',
  },
  { id: 't4', term_number: 4, end_date: '2026-11-30', virtue_theme: null },
];
```

- [ ] **Step 2: Add failing virtue tests**

Append to the `describe('cumulativeCommentGaps', …)` block:

```ts
it('blocks when a displayed term has comments done but no virtue theme', async () => {
  const service = makeService({
    rosterRows: ROSTER_ROWS,
    writeupsByTerm: { t1: [done('A'), done('B')] },
  });
  const termsNoVirtue: CumulativeTerm[] = [
    { id: 't1', term_number: 1, end_date: '2026-03-31', virtue_theme: '   ' },
  ];
  const gaps = await cumulativeCommentGaps(service, 'sec', termsNoVirtue, 1);
  expect(gaps).toHaveLength(1);
  expect(gaps[0].virtueMissing).toBe(true);
  expect(gaps[0].missing).toHaveLength(0);
});

it('reports both a comment gap and a virtue gap on the same term', async () => {
  const service = makeService({
    rosterRows: ROSTER_ROWS,
    writeupsByTerm: { t1: [done('A')] }, // B missing
  });
  const termsNoVirtue: CumulativeTerm[] = [
    { id: 't1', term_number: 1, end_date: '2026-03-31', virtue_theme: null },
  ];
  const gaps = await cumulativeCommentGaps(service, 'sec', termsNoVirtue, 1);
  expect(gaps).toHaveLength(1);
  expect(gaps[0].virtueMissing).toBe(true);
  expect(gaps[0].missing.map((m) => m.studentId)).toEqual(['B']);
});

it('passes when comments are done and the virtue theme is set', async () => {
  const service = makeService({
    rosterRows: ROSTER_ROWS,
    writeupsByTerm: { t1: [done('A'), done('B')] },
  });
  expect(await cumulativeCommentGaps(service, 'sec', TERMS, 1)).toHaveLength(0);
});
```

- [ ] **Step 3: Run — expect FAIL**

Run: `npx vitest run __tests__/markbook/comment-completeness.test.ts`
Expected: the new tests fail (`virtueMissing` undefined; no gap pushed for virtue-only).

- [ ] **Step 4: Implement virtue in the helper**

In `lib/markbook/comment-completeness.ts`:

- Add to `CumulativeTerm`:

```ts
  /** Term's free-text virtue theme; null/blank counts as a gap when this term is displayed (KD #49/#129). */
  virtue_theme?: string | null;
```

- Add to `CumulativeGap`:

```ts
/** True when the term's virtue_theme is null/blank — the comment-box heading would drop its HFSE-Virtues framing. */
virtueMissing: boolean;
```

- In `cumulativeCommentGaps`, replace the per-term loop body so a gap is pushed on a comment gap OR a virtue gap:

```ts
for (const t of requiredTerms) {
  const { missing } = await commentCompletenessForTerm(
    service,
    sectionId,
    t.id,
    roster,
    t.end_date ?? null
  );
  const virtueMissing = !t.virtue_theme?.trim();
  if (missing.length > 0 || virtueMissing) {
    gaps.push({
      termId: t.id,
      termNumber: t.term_number,
      missing,
      virtueMissing,
    });
  }
}
```

- [ ] **Step 5: Run — expect PASS**

Run: `npx vitest run __tests__/markbook/comment-completeness.test.ts` → all green (old + new).
Then `npx tsc --noEmit` → clean (the new required `virtueMissing` field will surface any caller that constructs a `CumulativeGap` literal — there are none outside the helper; the route reads `.missing`/`.termNumber` only).

- [ ] **Step 6: Commit**

```bash
git add lib/markbook/comment-completeness.ts __tests__/markbook/comment-completeness.test.ts
git commit -m "feat(markbook): virtue theme is part of the comment hard-gate"
```

---

## Task 2: Callers pass virtue_theme + surface it

**Files:** Modify `app/api/report-card-publications/route.ts`; Modify `app/api/sections/[id]/publish-readiness/route.ts`

- [ ] **Step 1: report-card-publications POST**

Read the file. In the hard-gate block (the `ayTerms` query ~L94–98), add `virtue_theme` to the select:

```ts
const { data: ayTerms } = await service
  .from('terms')
  .select('id, term_number, end_date, virtue_theme')
  .eq('academic_year_id', publishTerm.academic_year_id)
  .order('term_number');
```

The `cumulativeCommentGaps(... (ayTerms ?? []) as { id; term_number; end_date; virtue_theme }[] ...)` cast must include `virtue_theme: string | null`. Then extend the gap → message + payload so virtue surfaces. Replace the `detail`/response construction:

```ts
if (gaps.length > 0) {
  const detail = gaps
    .map((g) => {
      const parts: string[] = [];
      if (g.missing.length > 0)
        parts.push(
          `${g.missing.length} student${g.missing.length === 1 ? '' : 's'}`
        );
      if (g.virtueMissing) parts.push('virtue theme not set');
      return `Term ${g.termNumber} (${parts.join(', ')})`;
    })
    .join(', ');
  return NextResponse.json(
    {
      error: `This card can't publish yet — the adviser-comment block is incomplete for: ${detail}.`,
      code: 'comments_incomplete',
      comment_gate: {
        ok: false,
        gaps: gaps.map((g) => ({
          term_number: g.termNumber,
          virtue_missing: g.virtueMissing,
          missing: g.missing.map((m) => ({
            name: m.name,
            index: m.indexNumber,
          })),
        })),
      },
    },
    { status: 422 }
  );
}
```

- [ ] **Step 2: publish-readiness route**

Read the file. Two changes:

1. The terms query feeding the gate must select `virtue_theme` and pass it through to `cumulativeCommentGaps` (find where it builds the `allTerms` arg around L408–438; add `virtue_theme` to that select + the cast).
2. **Remove the soft `virtue_readiness` block** (the `virtueReadiness` computation ~L440–456 and the `virtue_readiness: virtueReadiness` key in the response ~L495). The hard `comment_gate` now covers virtue.

After this, the response's `comment_gate.gaps` entries carry `virtue_missing` per term (the panel reads it in Task 3). Confirm the `comment_gate` shape exposes `gaps[].virtue_missing` + `gaps[].term_number` + `gaps[].missing` (mirror Step 1's shape so the readiness route and the publish route emit the same gate JSON).

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` (clean) + `npx next build` (compiles). Grep confirms no remaining `virtue_readiness` references in routes/components except where Task 3 will remove the panel usage: `rg -n "virtue_readiness|virtueReadiness"`.

- [ ] **Step 4: Commit**

```bash
git add "app/api/report-card-publications/route.ts" "app/api/sections/[id]/publish-readiness/route.ts"
git commit -m "feat(markbook): publish routes carry virtue in the comment gate; drop soft virtue row"
```

---

## Task 3: PublishWindowPanel — comment row shows virtue, soft virtue row removed

**Files:** Modify `components/admin/publish-window-panel.tsx`

> **UI task** — invoke `ui-ux-pro-max@ui-ux-pro-max-skill` + skim `docs/context/09-design-system.md`. Tokens only.

- [ ] **Step 1: Read the panel** and locate (a) the soft virtue `<ChecklistRow>` (driven by the now-removed `virtue_readiness`) and (b) the hard comment `<ChecklistRow>` (driven by `comment_gate`).

- [ ] **Step 2: Remove the soft virtue row** entirely (its data source is gone). Remove any `virtue_readiness` reads from the panel's readiness type + JSX.

- [ ] **Step 3: Surface virtue in the comment hard row.** The comment row already lists per-term comment gaps from `comment_gate.gaps`. Extend its detail text so a term that is `virtue_missing` reads e.g. "Term 2 — virtue theme not set" alongside the student-count gaps, and add a deep-link button to `/evaluation/virtue-themes` when any gap has `virtue_missing` (mirroring the existing per-row deep-link pattern; the comment row already deep-links to Evaluation for student comment gaps — keep that, and route virtue gaps to `/evaluation/virtue-themes`). Tokens only; keep it on the existing destructive "Required to publish" styling.

- [ ] **Step 4: Verify**

`npx tsc --noEmit` (clean) + `npx next build`. Manually: a section with a displayed term missing its virtue theme shows the comment row as blocked with the virtue note + the Evaluation deep-link; setting the theme clears it.

- [ ] **Step 5: Commit**

```bash
git add components/admin/publish-window-panel.tsx
git commit -m "feat(markbook): publish checklist comment row covers virtue; drop soft virtue row"
```

---

## Task 4: Bulk-publish readiness checklist + publish-ready/skip-blocked

**Files:** Modify `components/admin/bulk-publish-dialog.tsx`

> **UI task** — invoke `ui-ux-pro-max@ui-ux-pro-max-skill`. Tokens only. Read the current file first — keep the term/window pickers, the section multi-select, and the chunked publish loop; this adds a readiness layer + changes the loop's halt-on-first to skip-blocked.

- [ ] **Step 1: Add a readiness type + per-section state**

Add near the top of the component:

```ts
type SectionReadiness =
  | { state: 'loading' }
  | { state: 'ready' }
  | { state: 'warn'; reasons: string[] }
  | { state: 'blocked'; reasons: string[] };
const [readiness, setReadiness] = useState<Record<string, SectionReadiness>>(
  {}
);
```

- [ ] **Step 2: Fetch + classify readiness on open / term change**

Add an effect that, when the dialog is `open` and `termId` is set, fetches `/api/sections/${id}/publish-readiness?term_id=${termId}` for every section (chunked 5 at a time), classifying each. Cache by `${sectionId}:${termId}` so re-runs are cheap. Classifier:

```ts
function classify(r: {
  grading_sheets: { unlocked: { subject_name: string }[] };
  attendance: { missing: unknown[] };
  t4_readiness: { ok: boolean } | null;
  comment_gate: {
    ok: boolean;
    gaps: {
      term_number: number;
      virtue_missing: boolean;
      missing: unknown[];
    }[];
  };
}): SectionReadiness {
  if (!r.comment_gate.ok) {
    const reasons = r.comment_gate.gaps.map((g) => {
      const bits: string[] = [];
      if (g.missing.length)
        bits.push(
          `${g.missing.length} comment${g.missing.length === 1 ? '' : 's'}`
        );
      if (g.virtue_missing) bits.push('virtue');
      return `T${g.term_number} (${bits.join(', ')})`;
    });
    return { state: 'blocked', reasons };
  }
  const warn: string[] = [];
  if (r.grading_sheets.unlocked.length)
    warn.push(
      `${r.grading_sheets.unlocked.length} sheet${r.grading_sheets.unlocked.length === 1 ? '' : 's'} unlocked`
    );
  if (r.attendance.missing.length)
    warn.push(
      `${r.attendance.missing.length} attendance gap${r.attendance.missing.length === 1 ? '' : 's'}`
    );
  if (r.t4_readiness && !r.t4_readiness.ok) warn.push('T4 grades incomplete');
  return warn.length ? { state: 'warn', reasons: warn } : { state: 'ready' };
}
```

Use the existing chunk pattern (5 at a time); set `{ state: 'loading' }` for each selected section before its fetch resolves. On fetch error, treat as `{ state: 'warn', reasons: ['readiness check failed'] }` (don't hard-block on a failed check — it'll still be caught by the server gate at publish).

- [ ] **Step 3: Render per-section status**

In the section list rows, show a status pill next to each section name driven by `readiness[s.id]`: ✓ Ready (mint/`StatusBadge` healthy), ⚠ + reasons (amber/warning), ✗ Blocked + reasons (destructive), or a small spinner while `loading`. Tokens only; reuse `StatusBadge` or the existing chip styling. Blocked rows render with their checkbox **disabled + unchecked** (can't select a hard-blocked section), or keep them visible-but-excluded — pick disabled-checkbox for clarity.

- [ ] **Step 4: Publish-ready / skip-blocked**

Change `submit()`: the publish set = selected sections whose readiness is `ready` or `warn` (exclude `blocked` and still-`loading`). Keep the chunked POST loop, but **remove the halt-on-first `break`** — collect per-section results and continue. A POST that still 422s (state changed between check and publish) is counted as `skipped` (not a fatal halt). End with a summary toast:

```ts
toast.success(
  `Published ${published} section${published === 1 ? '' : 's'}` +
    (skipped > 0 ? ` · ${skipped} skipped (incomplete)` : '') +
    (failed > 0 ? ` · ${failed} failed` : '')
);
```

The Publish button label uses the publishable count (`ready + warn` among selected), e.g. "Publish 17"; show the blocked count beside it ("3 blocked").

- [ ] **Step 5: Verify**

`npx tsc --noEmit` + `npx next build`. Manual: open bulk publish for a term where sections vary — confirm ✓/⚠/✗ render, blocked sections can't be selected, Publish sends ✓+⚠ and the toast reports published/skipped, and a blocked section is never published.

- [ ] **Step 6: Commit**

```bash
git add components/admin/bulk-publish-dialog.tsx
git commit -m "feat(markbook): bulk publish shows readiness + publishes ready, skips blocked"
```

---

## Task 5: Final verification

- [ ] **Step 1:** `npx tsc --noEmit` clean.
- [ ] **Step 2:** `npx vitest run` — all pass (incl. new virtue cases).
- [ ] **Step 3:** `npx next build` clean; `rg -n "virtue_readiness|virtueReadiness"` returns nothing (soft row fully removed).
- [ ] **Step 4:** Manual matrix per the spec's Verification section (Part 1 single-section virtue block + Part 2 bulk classify/publish).
- [ ] **Step 5:** Dispatch `feature-dev:code-reviewer` over the branch diff; address findings.

---

## Self-review notes (author)

- **Spec coverage:** Part 1 = Tasks 1–3 (helper + routes + panel); Part 2 = Task 4 (bulk). All spec bullets mapped.
- **Breaking-change guard:** Task 1 Step 1 updates the existing test fixtures' `virtue_theme` first, so the new virtue check doesn't silently fail the comment suite.
- **Gate JSON parity:** Tasks 2 (both routes) emit the same `comment_gate.gaps[]` shape (`term_number` / `virtue_missing` / `missing`) the panel (Task 3) and bulk classifier (Task 4) consume — single shape, no drift.
- **Soft stays soft:** only virtue is hardened; grading/attendance/T4/letterhead remain warnings in both single + bulk (spec non-goal honored).
- **Risk:** the publish-readiness route's exact line numbers for the virtue block will have shifted — Task 2 Step 2 says to locate by name (`virtueReadiness`/`virtue_readiness`), not line number.
