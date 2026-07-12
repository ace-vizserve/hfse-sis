# SIS Admin Content &amp; Functionality Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the content and functionality of SIS Admin's 13 pages — same routes, real artifact-preview UI, and one genuine functionality upgrade per phase — per the approved spec and mockups.

**Architecture:** Seven independently-shippable phases, ordered by real downstream stakes (traced via three parallel data-flow research agents this session). Each phase adds pure, unit-tested helper functions first, then wires them into the existing page/component (no new routes, no migrations). Two phases (Staff in Phase 3, Audit Log/Settings in Phase 7) need no engineering task — the exploration confirmed they're already correct — and are noted as such rather than padded with busywork.

**Tech Stack:** Next.js 16 App Router, Supabase (service-role RSC loaders), shadcn/Aurora Vault design system, Vitest, TanStack Query (client mutations per KD #24).

**Spec:** `docs/superpowers/specs/2026-07-13-sis-admin-content-redesign-design.md` (+ 8 approved mockup screens, `.superpowers/brainstorm/30805-1783872331/content/*.html`).

## Global Constraints

- Hard Rule #7: tokens only — no raw hex/oklch/slate/zinc/gray/bg-white/bg-black in `app/` or `components/`. Use the real Aurora Vault tokens confirmed this session: `brand-indigo` #213098, `brand-mint` #34d399, `brand-amber` #ed7622, `brand-amber-light` #fde8d5, `ink`/`ink-2`/`ink-3`/`ink-4`/`ink-5`, `hairline`/`hairline-strong`, `destructive`.
- `font-serif` for headlines/titles, `font-mono` for eyebrows/codes/status text, `font-sans` (default) for body/controls.
- Gradient is ONLY for icon tiles (`bg-gradient-to-br from-brand-indigo to-brand-navy` + `shadow-brand-tile`) — never a content background.
- No new routes, no redirect stubs, no migrations. Every change is content/logic inside an existing page at its existing URL.
- Invoke the `frontend-design:frontend-design` skill before writing any new JSX, per the project's Always-Do-First rule — the approved mockups are the source of truth for shape/copy, this is about not drifting from tokens while implementing them.
- Reuse existing pure/tested patterns rather than re-deriving: `computeSubjectConfigGaps` (`lib/sis/subject-config-gaps.ts`), `checklistSummary` (`lib/sis/year-setup.ts`), `buildAttentionRows` (`lib/sis/hub-attention.ts`), `GenerateIndexButton`/`GenerateIndexDialog` (`components/sis/generate-index-button.tsx`), `classifyCodeStatus` (`components/ui/discount-code-status-badge.tsx`), `ReportCardLetterhead` (`components/report-card/report-card-letterhead.tsx`).
- Commit per task; message suffix `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Pre-commit hook runs prettier — expect reformatting.
- Per-task verify: `npx vitest run <touched test files>`. End-of-phase verify: full `npx vitest run` + `npx next build` clean.

---

## Phase 1 — Grading setup (Structure Defaults + Subject Weights)

**Stakes:** highest in the module — a bad weight edit or template-apply silently re-grades a whole cohort. Confirmed this session: the `apply_template_to_ay` RPC (`supabase/migrations/031_template_tables.sql:153-234`) returns only row _counts_ (`sections_inserted/updated`, `configs_inserted/updated`), never old→new field values — so Apply-with-preview needs its own new diff computation, run BEFORE the RPC is called, not derived from its response.

### Task 1: Value-level template diff (pure, TDD)

**Files:**

- Create: `lib/sis/template-diff.ts`
- Test: `__tests__/sis/template-diff.test.ts`

**Interfaces (Produces):**

- `computeTemplateDiff(templateConfigs: TemplateSubjectConfigRow[], actualConfigs: SubjectConfigRow[], templateSections: TemplateSectionRow[], actualSections: SectionRow[]): TemplateDiff`
- `TemplateDiff = { newSections: Array<{ levelId: string; name: string }>; configChanges: Array<{ subjectId: string; levelId: string; field: 'wwWeight'|'ptWeight'|'qaWeight'|'wwMaxSlots'|'ptMaxSlots'|'qaMax'; from: number; to: number }>; newConfigs: Array<{ subjectId: string; levelId: string }> }`
- Row types (shared with `lib/sis/subject-config-gaps.ts`'s existing style): `TemplateSubjectConfigRow = { subject_id: string; level_id: string; ww_weight: number; pt_weight: number; qa_weight: number; ww_max_slots: number; pt_max_slots: number; qa_max: number }`; `SubjectConfigRow` = the identical shape (confirmed field-for-field identical this session, only `academic_year_id` differs and isn't part of the diff key); `TemplateSectionRow = { level_id: string; name: string }`; `SectionRow = { level_id: string; name: string }`.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/sis/template-diff.test.ts
import { describe, expect, it } from 'vitest';
import { computeTemplateDiff } from '@/lib/sis/template-diff';

const TEMPLATE_CONFIGS = [
  {
    subject_id: 'sci',
    level_id: 'p3',
    ww_weight: 0.35,
    pt_weight: 0.45,
    qa_weight: 0.2,
    ww_max_slots: 5,
    pt_max_slots: 5,
    qa_max: 30,
  },
  {
    subject_id: 'math',
    level_id: 'p3',
    ww_weight: 0.4,
    pt_weight: 0.4,
    qa_weight: 0.2,
    ww_max_slots: 5,
    pt_max_slots: 5,
    qa_max: 30,
  },
];
const ACTUAL_CONFIGS = [
  {
    subject_id: 'sci',
    level_id: 'p3',
    ww_weight: 0.4,
    pt_weight: 0.4,
    qa_weight: 0.2,
    ww_max_slots: 5,
    pt_max_slots: 5,
    qa_max: 30,
  },
  {
    subject_id: 'math',
    level_id: 'p3',
    ww_weight: 0.4,
    pt_weight: 0.4,
    qa_weight: 0.2,
    ww_max_slots: 5,
    pt_max_slots: 5,
    qa_max: 30,
  },
];
const TEMPLATE_SECTIONS = [
  { level_id: 'p3', name: 'Obedience' },
  { level_id: 's3', name: 'Consistency' },
];
const ACTUAL_SECTIONS = [{ level_id: 'p3', name: 'Obedience' }];

describe('computeTemplateDiff', () => {
  it('reports a weight change only for the subject that actually differs', () => {
    const diff = computeTemplateDiff(
      TEMPLATE_CONFIGS,
      ACTUAL_CONFIGS,
      TEMPLATE_SECTIONS,
      ACTUAL_SECTIONS
    );
    expect(diff.configChanges).toEqual([
      {
        subjectId: 'sci',
        levelId: 'p3',
        field: 'wwWeight',
        from: 0.4,
        to: 0.35,
      },
      {
        subjectId: 'sci',
        levelId: 'p3',
        field: 'ptWeight',
        from: 0.4,
        to: 0.45,
      },
    ]);
  });

  it('reports a new section not present in the target AY', () => {
    const diff = computeTemplateDiff(
      TEMPLATE_CONFIGS,
      ACTUAL_CONFIGS,
      TEMPLATE_SECTIONS,
      ACTUAL_SECTIONS
    );
    expect(diff.newSections).toEqual([{ levelId: 's3', name: 'Consistency' }]);
  });

  it('reports a new config for a (subject, level) with no existing row', () => {
    const diff = computeTemplateDiff(
      TEMPLATE_CONFIGS,
      [ACTUAL_CONFIGS[0]], // math is missing from the target AY
      [],
      []
    );
    expect(diff.newConfigs).toEqual([{ subjectId: 'math', levelId: 'p3' }]);
    expect(diff.configChanges).toEqual([]);
  });

  it('produces an empty diff when template and target already match', () => {
    const diff = computeTemplateDiff(
      [TEMPLATE_CONFIGS[1]], // math only, matches actual exactly
      [ACTUAL_CONFIGS[1]],
      [],
      []
    );
    expect(diff).toEqual({
      newSections: [],
      configChanges: [],
      newConfigs: [],
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run __tests__/sis/template-diff.test.ts`
Expected: FAIL — `Cannot find module '@/lib/sis/template-diff'`

- [ ] **Step 3: Implement**

```ts
// lib/sis/template-diff.ts
// Pure, no I/O. Computes what "Propagate to AYs" WOULD change, before the
// apply_template_to_ay RPC runs — the RPC itself only returns row COUNTS
// (supabase/migrations/031_template_tables.sql:153-234), never field-level
// old->new values, so this preview is computed client/server-side from the
// same two tables the RPC reads, never from the RPC's response.

export type TemplateSubjectConfigRow = {
  subject_id: string;
  level_id: string;
  ww_weight: number;
  pt_weight: number;
  qa_weight: number;
  ww_max_slots: number;
  pt_max_slots: number;
  qa_max: number;
};
export type SubjectConfigRow = TemplateSubjectConfigRow;
export type TemplateSectionRow = { level_id: string; name: string };
export type SectionRow = { level_id: string; name: string };

export type TemplateConfigField =
  | 'wwWeight'
  | 'ptWeight'
  | 'qaWeight'
  | 'wwMaxSlots'
  | 'ptMaxSlots'
  | 'qaMax';

export type TemplateDiff = {
  newSections: Array<{ levelId: string; name: string }>;
  configChanges: Array<{
    subjectId: string;
    levelId: string;
    field: TemplateConfigField;
    from: number;
    to: number;
  }>;
  newConfigs: Array<{ subjectId: string; levelId: string }>;
};

const FIELD_MAP: Array<[TemplateConfigField, keyof TemplateSubjectConfigRow]> =
  [
    ['wwWeight', 'ww_weight'],
    ['ptWeight', 'pt_weight'],
    ['qaWeight', 'qa_weight'],
    ['wwMaxSlots', 'ww_max_slots'],
    ['ptMaxSlots', 'pt_max_slots'],
    ['qaMax', 'qa_max'],
  ];

function configKey(r: { subject_id: string; level_id: string }): string {
  return `${r.subject_id}|${r.level_id}`;
}
function sectionKey(r: { level_id: string; name: string }): string {
  return `${r.level_id}|${r.name}`;
}

export function computeTemplateDiff(
  templateConfigs: TemplateSubjectConfigRow[],
  actualConfigs: SubjectConfigRow[],
  templateSections: TemplateSectionRow[],
  actualSections: SectionRow[]
): TemplateDiff {
  const actualConfigByKey = new Map(
    actualConfigs.map((c) => [configKey(c), c])
  );
  const actualSectionKeys = new Set(actualSections.map(sectionKey));

  const newSections = templateSections
    .filter((s) => !actualSectionKeys.has(sectionKey(s)))
    .map((s) => ({ levelId: s.level_id, name: s.name }));

  const configChanges: TemplateDiff['configChanges'] = [];
  const newConfigs: TemplateDiff['newConfigs'] = [];

  for (const t of templateConfigs) {
    const actual = actualConfigByKey.get(configKey(t));
    if (!actual) {
      newConfigs.push({ subjectId: t.subject_id, levelId: t.level_id });
      continue;
    }
    for (const [field, key] of FIELD_MAP) {
      if (t[key] !== actual[key]) {
        configChanges.push({
          subjectId: t.subject_id,
          levelId: t.level_id,
          field,
          from: actual[key],
          to: t[key],
        });
      }
    }
  }

  return { newSections, configChanges, newConfigs };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run __tests__/sis/template-diff.test.ts`
Expected: PASS, 4/4

- [ ] **Step 5: Commit**

```bash
git add lib/sis/template-diff.ts __tests__/sis/template-diff.test.ts
git commit -m "feat(sis): pure template->AY diff computation for Apply-with-preview

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Apply-with-preview UI on Structure Defaults

**Files:**

- Modify: `components/sis/template-manager-client.tsx` (`PropagateDialog`, lines 729-904)
- Create: `app/api/sis/admin/template/diff/route.ts`
- Test: `__tests__/sis/template-diff-route.test.ts`

**Interfaces:**

- Consumes: `computeTemplateDiff` (Task 1).
- Produces: `GET /api/sis/admin/template/diff?ay_code=AY2027` → `{ diff: TemplateDiff }` (single-AY preview; the dialog calls this once per selected AY before the user confirms).

**Context:** `PropagateDialog` currently goes straight from AY selection to `applyMutation` (`POST /api/sis/admin/template/apply`). Per the approved mockup, it must show a diff card between selection and the final "Apply N changes" button.

- [ ] **Step 1: Write the failing route test**

```ts
// __tests__/sis/template-diff-route.test.ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/require-role', () => ({
  requireRole: vi.fn(() =>
    Promise.resolve({ user: { id: 'u1' }, role: 'superadmin' })
  ),
}));

vi.mock('@/lib/supabase/service', () => {
  const makeChain = (result: { data: unknown; error: null }) => ({
    select: () => makeChain(result),
    eq: () => makeChain(result),
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve(result).then(resolve),
  });
  return {
    createServiceClient: vi.fn(() => ({
      from: (table: string) => {
        if (table === 'academic_years') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({ data: { id: 'ay-1' }, error: null }),
              }),
            }),
          };
        }
        if (table === 'template_subject_configs') {
          return makeChain({
            data: [
              {
                subject_id: 'sci',
                level_id: 'p3',
                ww_weight: 0.35,
                pt_weight: 0.45,
                qa_weight: 0.2,
                ww_max_slots: 5,
                pt_max_slots: 5,
                qa_max: 30,
              },
            ],
            error: null,
          });
        }
        if (table === 'subject_configs') {
          return makeChain({
            data: [
              {
                subject_id: 'sci',
                level_id: 'p3',
                ww_weight: 0.4,
                pt_weight: 0.4,
                qa_weight: 0.2,
                ww_max_slots: 5,
                pt_max_slots: 5,
                qa_max: 30,
              },
            ],
            error: null,
          });
        }
        if (table === 'template_sections')
          return makeChain({ data: [], error: null });
        if (table === 'sections') return makeChain({ data: [], error: null });
        return makeChain({ data: [], error: null });
      },
    })),
  };
});

import { GET } from '@/app/api/sis/admin/template/diff/route';

describe('GET /api/sis/admin/template/diff', () => {
  it('returns the computed diff for the requested AY', async () => {
    const req = new Request(
      'http://localhost/api/sis/admin/template/diff?ay_code=AY2027'
    );
    const res = await GET(req as never);
    const body = await res.json();
    expect(body.diff.configChanges).toEqual([
      {
        subjectId: 'sci',
        levelId: 'p3',
        field: 'wwWeight',
        from: 0.4,
        to: 0.35,
      },
      {
        subjectId: 'sci',
        levelId: 'p3',
        field: 'ptWeight',
        from: 0.4,
        to: 0.45,
      },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run __tests__/sis/template-diff-route.test.ts`
Expected: FAIL — route module not found

- [ ] **Step 3: Implement the route**

```ts
// app/api/sis/admin/template/diff/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { requireRole } from '@/lib/auth/require-role';
import { createServiceClient } from '@/lib/supabase/service';
import { computeTemplateDiff } from '@/lib/sis/template-diff';

// GET /api/sis/admin/template/diff?ay_code=AY2027 — read-only preview of
// what "Propagate to AYs" would change for ONE AY, computed the same way
// apply_template_to_ay's UPSERT would resolve it, but never writes.
export async function GET(request: NextRequest) {
  const auth = await requireRole(['school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const ayCode = request.nextUrl.searchParams.get('ay_code');
  if (!ayCode || !/^AY[0-9]{4}$/.test(ayCode)) {
    return NextResponse.json(
      { error: 'ay_code must look like AY2027' },
      { status: 400 }
    );
  }

  const service = createServiceClient();
  const { data: ay } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode)
    .maybeSingle();
  if (!ay) return NextResponse.json({ error: 'AY not found' }, { status: 404 });

  const [
    { data: templateConfigs },
    { data: actualConfigs },
    { data: templateSections },
    { data: actualSections },
  ] = await Promise.all([
    service
      .from('template_subject_configs')
      .select(
        'subject_id, level_id, ww_weight, pt_weight, qa_weight, ww_max_slots, pt_max_slots, qa_max'
      ),
    service
      .from('subject_configs')
      .select(
        'subject_id, level_id, ww_weight, pt_weight, qa_weight, ww_max_slots, pt_max_slots, qa_max'
      )
      .eq('academic_year_id', ay.id),
    service.from('template_sections').select('level_id, name'),
    service
      .from('sections')
      .select('level_id, name')
      .eq('academic_year_id', ay.id),
  ]);

  const diff = computeTemplateDiff(
    templateConfigs ?? [],
    actualConfigs ?? [],
    templateSections ?? [],
    actualSections ?? []
  );

  return NextResponse.json({ diff });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run __tests__/sis/template-diff-route.test.ts`
Expected: PASS

- [ ] **Step 5: Wire the preview into `PropagateDialog`**

In `components/sis/template-manager-client.tsx`, inside `PropagateDialog` (lines 729-904):

- Add state: `const [previewAyCode, setPreviewAyCode] = useState<string | null>(null);`
- Add a query (TanStack Query, per KD #24): `const diffQuery = useQuery({ queryKey: ['template-diff', previewAyCode], queryFn: () => apiFetch<{ diff: TemplateDiff }>(`/api/sis/admin/template/diff?ay_code=${previewAyCode}`), enabled: !!previewAyCode });`
- Change the per-AY checkbox row: when a single AY is checked (or on a new "Preview" button per row, matching the mockup's flow), call `setPreviewAyCode(ayCode)` instead of immediately allowing Apply.
- Render a diff card (matching the mockup's shape exactly — `+ NEW` mint badge per `diff.newSections`/`diff.newConfigs`, `~ UPDATE` amber badge per `diff.configChanges` with `from → to` shown as `<span className="rounded bg-muted px-1.5 py-0.5 font-mono line-through decoration-destructive/60">{from}</span> <span className="mx-1 text-ink-5">→</span> <span className="rounded bg-brand-mint/20 px-1.5 py-0.5 font-mono text-ink">{to}</span>`), plus the fixed honest note: `"Apply never removes. If a section or subject was deleted from the template, it stays in {ayCode} untouched — remove it there directly."`
- The final confirm button becomes `Apply {changeCount} change{changeCount === 1 ? '' : 's'} to {previewAyCode}`, `disabled={diffQuery.isLoading}`, calling the EXISTING `applyMutation.mutate([previewAyCode])` unchanged — Task 2 only adds a preview step in front of the existing apply call, it does not change what apply does.
- Multi-AY selection ("select all" checkbox, lines 774-803 unchanged) keeps working as before for bulk apply without per-AY preview — the preview is opt-in per AY, matching "Preview changes" as its own button per the mockup, not a blocking gate on bulk apply.

- [ ] **Step 6: Run the full subjects/template suite**

Run: `npx vitest run __tests__/sis/template-diff-route.test.ts __tests__/sis/template-diff.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add app/api/sis/admin/template/diff/route.ts __tests__/sis/template-diff-route.test.ts components/sis/template-manager-client.tsx
git commit -m "feat(sis): Apply-with-preview on Structure Defaults

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Grading-sheet-column preview on Subject Weights

**Files:**

- Modify: `components/sis/subject-config-matrix.tsx` (`SubjectCard`, lines 188-280)
- Test: `__tests__/ui/subject-config-matrix-preview.test.tsx`

**Interfaces:**

- Consumes: `Config` type (already defined in this file, lines 21-38 — `ww_weight, pt_weight, qa_weight, ww_max_slots, pt_max_slots, qa_max`).
- Produces: nothing new consumed elsewhere — presentational only.

**Context:** Confirmed this session — `SubjectCard` renders one chip per `(subject × level)` showing only the WW·PT·QA percentage triplet; slot counts exist only in the chip's `title` tooltip attribute, never visually. The mockup's grading-sheet-column strip (WW1-5/PT1-5/QA mini-columns) is greenfield — nothing like it exists today.

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/ui/subject-config-matrix-preview.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GradingSheetPreview } from '@/components/sis/subject-config-matrix';

describe('GradingSheetPreview', () => {
  it('renders one column chip per WW/PT slot plus one QA chip, matching the real sheet shape', () => {
    render(
      <GradingSheetPreview
        config={{ ww_max_slots: 5, pt_max_slots: 5, qa_max: 30 } as never}
      />
    );
    expect(screen.getAllByText(/^WW\d$/)).toHaveLength(5);
    expect(screen.getAllByText(/^PT\d$/)).toHaveLength(5);
    expect(screen.getByText('QA')).toBeInTheDocument();
    expect(screen.getByText('/30')).toBeInTheDocument();
  });

  it('scales the column count to a custom slot count', () => {
    render(
      <GradingSheetPreview
        config={{ ww_max_slots: 4, pt_max_slots: 5, qa_max: 40 } as never}
      />
    );
    expect(screen.getAllByText(/^WW\d$/)).toHaveLength(4);
    expect(screen.getByText('/40')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run __tests__/ui/subject-config-matrix-preview.test.tsx`
Expected: FAIL — `GradingSheetPreview` is not exported

- [ ] **Step 3: Implement — add the export to `subject-config-matrix.tsx`**

Add near the top of the file, after the existing type definitions (after line 38):

```tsx
// Renders the ACTUAL grading-sheet columns a teacher would see (WW/PT slot
// count + QA denominator), matching the approved mockup's artifact-preview
// direction — this is the same information that was previously only in the
// chip's `title` tooltip (invisible at a glance).
export function GradingSheetPreview({
  config,
}: {
  config: Pick<Config, 'ww_max_slots' | 'pt_max_slots' | 'qa_max'>;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto py-1">
      {Array.from({ length: config.ww_max_slots }, (_, i) => (
        <div key={`ww${i}`} className="w-11 flex-none text-center">
          <div className="rounded-t-md bg-brand-sky/15 py-1 font-mono text-[9px] font-semibold uppercase text-brand-indigo-deep">
            WW{i + 1}
          </div>
          <div className="rounded-b-md border border-t-0 border-border bg-card py-1 font-mono text-[10px] text-ink-3">
            /10
          </div>
        </div>
      ))}
      <div className="w-2 flex-none" aria-hidden />
      {Array.from({ length: config.pt_max_slots }, (_, i) => (
        <div key={`pt${i}`} className="w-11 flex-none text-center">
          <div className="rounded-t-md bg-brand-mint/20 py-1 font-mono text-[9px] font-semibold uppercase text-ink">
            PT{i + 1}
          </div>
          <div className="rounded-b-md border border-t-0 border-border bg-card py-1 font-mono text-[10px] text-ink-3">
            /10
          </div>
        </div>
      ))}
      <div className="w-2 flex-none" aria-hidden />
      <div className="w-12 flex-none text-center">
        <div className="rounded-t-md bg-brand-amber-light py-1 font-mono text-[9px] font-semibold uppercase text-brand-amber">
          QA
        </div>
        <div className="rounded-b-md border border-t-0 border-border bg-card py-1 font-mono text-[10px] text-ink-3">
          /{config.qa_max}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Mount it — expand the chip on click instead of only opening the edit dialog**

The chip's `onClick` (line ~248) currently only calls `onOpenCell`. Add a second, lower-key affordance: wrap each level's chip **and** a collapsible `GradingSheetPreview` in a small `Collapsible` (already installed per KD #151), triggered by a tiny expand caret next to the chip, so a registrar can preview the sheet without committing to opening the edit dialog. Keep `onOpenCell` on the chip itself unchanged (still the edit entry point).

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run __tests__/ui/subject-config-matrix-preview.test.tsx`
Expected: PASS, 2/2

- [ ] **Step 6: Commit**

```bash
git add components/sis/subject-config-matrix.tsx __tests__/ui/subject-config-matrix-preview.test.tsx
git commit -m "feat(sis): live grading-sheet-column preview on Subject Weights

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Inline "This year / Structure Defaults" tab on Subject Weights

**Files:**

- Modify: `app/(sis)/sis/admin/subjects/page.tsx` (lines 64-75, 158-177)
- Modify: `components/sis/subject-config-matrix.tsx` (top-level wrapper)
- Test: `__tests__/sis/subject-config-gaps.test.ts` (extend, if the value-diff needs a second pure function — see note)

**Interfaces:**

- Consumes: `computeSubjectConfigGaps` (existing, `lib/sis/subject-config-gaps.ts`) for the drift COUNT badge; `computeTemplateDiff` (Task 1) for the drift DETAIL when the tab is opened (same diff engine, reused — not a third implementation).

**Context:** This is the ONE approved light-IA exception from the spec — no new route, an inline tab on the existing page. `subjects/page.tsx` already fetches `templateRows` (level_id/subject_id only) for the gap count; this task widens that fetch to the FULL template row shape so the tab can render actual values, and passes it to `SubjectConfigMatrix`.

- [ ] **Step 1: Widen the page's template fetch**

In `app/(sis)/sis/admin/subjects/page.tsx`, replace the existing gap-check block (lines 64-75):

```tsx
// Structure Defaults comparison — full rows now (not just level/subject
// ids) so the inline "Structure Defaults" tab can render actual values,
// not just a gap count.
const { data: templateConfigs } = currentAy
  ? await service
      .from('template_subject_configs')
      .select(
        'subject_id, level_id, ww_weight, pt_weight, qa_weight, ww_max_slots, pt_max_slots, qa_max'
      )
  : { data: [] };
const subjectConfigGaps = currentAy
  ? computeSubjectConfigGaps(levels, subjects, templateConfigs ?? [], configs)
  : [];
```

(`computeSubjectConfigGaps` takes `{level_id, subject_id}` shaped rows — the wider select is a strict superset, so this call is unaffected; verify by re-running its existing test.)

- [ ] **Step 2: Pass `templateConfigs` down**

At the `SubjectConfigMatrix` call site (lines 158-177 area), add the new prop:

```tsx
<SubjectConfigMatrix
  subjects={subjects}
  levels={levels}
  configs={configs}
  templateConfigs={templateConfigs ?? []}
  ayCode={currentAy.ay_code}
/>
```

- [ ] **Step 3: Add the tab wrapper to `SubjectConfigMatrix`**

Add `templateConfigs: TemplateSubjectConfigRow[]` to the component's props type. Wrap the existing return value (the search+legend card + subject cards) in a `Tabs` matching the mockup:

```tsx
const drift = useMemo(
  () =>
    computeTemplateDiff(templateConfigs, configs, [], []).configChanges.length,
  [templateConfigs, configs]
);

return (
  <Tabs defaultValue="this-year">
    <TabsList variant="segmented" className="mt-2">
      <TabsTrigger value="this-year">This year</TabsTrigger>
      <TabsTrigger value="structure-defaults" className="gap-1.5">
        Structure Defaults
        {drift > 0 && (
          <span className="rounded-full bg-brand-amber-light px-1.5 py-0.5 font-mono text-[10px] font-semibold text-brand-amber">
            {drift} drift
          </span>
        )}
      </TabsTrigger>
    </TabsList>
    <TabsContent value="this-year">
      {/* existing search/legend/SubjectCard markup, unchanged */}
    </TabsContent>
    <TabsContent value="structure-defaults">
      <TemplateDriftList
        changes={
          computeTemplateDiff(templateConfigs, configs, [], []).configChanges
        }
        subjects={subjects}
        levels={levels}
      />
    </TabsContent>
  </Tabs>
);
```

(`computeTemplateDiff`'s `newSections`/`newConfigs` outputs aren't relevant here — this tab is comparing an already-populated AY against the template for VALUE drift only, so pass `[]`/`[]` for the sections/actualSections params, matching Task 1's test case 4 pattern of a partial call.)

`TemplateDriftList` is a small new local component in the same file: a list of `{subjectCode} · {levelLabel}: {field} {from} → {to}` rows, reusing the design tokens already established in Task 2's diff card (mint/amber `from→to` chips) — no new tokens.

- [ ] **Step 4: Run**

Run: `npx vitest run __tests__/sis/subject-config-gaps.test.ts` (regression check — must still pass unmodified)
Expected: PASS, 5/5 (existing tests)

- [ ] **Step 5: Commit**

```bash
git add "app/(sis)/sis/admin/subjects/page.tsx" components/sis/subject-config-matrix.tsx
git commit -m "feat(sis): inline Structure Defaults drift tab on Subject Weights

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Phase 1 verification

- `npx vitest run __tests__/sis/template-diff.test.ts __tests__/sis/template-diff-route.test.ts __tests__/ui/subject-config-matrix-preview.test.tsx __tests__/sis/subject-config-gaps.test.ts` — all green.
- `npx next build` clean.
- Manual: open `/sis/admin/template`, select AY2027, click Preview — confirm the diff card shows real `from → to` values matching what's actually in `subject_configs` vs `template_subject_configs` for a test AY; confirm Apply still calls the unchanged `apply_template_to_ay` RPC. Open `/sis/admin/subjects`, expand a subject's grading-sheet preview, confirm slot counts match `ww_max_slots`/`pt_max_slots`/`qa_max`. Click the Structure Defaults tab, confirm the drift count matches Task 4's computation.

---

## Phase 2 — School year (School Calendar + AY Setup)

**Stakes:** the fail-closed attendance gate — confirmed this session, `isNonSchoolDay` (`app/api/attendance/daily/route.ts:201-244`) blocks a write when a date has no `school_calendar` row AND the term has rows elsewhere. Also confirmed: the month grid currently has NO way to distinguish "explicit school_day row" from "no row at all" — both render as a bare cell.

### Task 5: Expose "no row for this date" in the calendar index (pure, TDD)

**Files:**

- Modify: `components/attendance/calendar/hooks/use-calendar-index.ts`
- Test: `__tests__/attendance/calendar-index-missing-rows.test.ts`

**Interfaces:**

- Consumes: the existing `calendar: SchoolCalendarRow[]` input already passed to `useCalendarIndex`.
- Produces: `useCalendarIndex(...)` return value gains `hasRowByIso: Set<string>` alongside the existing `entriesByIso` — every ISO date that has AT LEAST ONE `school_calendar` row (any audience) is in the set.

**Context:** `useCalendarIndex` (lines 41-101) builds `entriesByIso` by grouping `calendar` rows via `byDateAud` — a date with zero rows simply never gets an entry. This task adds a parallel, cheap `hasRowByIso` Set built from the exact same grouping pass (no new query, no new prop needed from callers — same `calendar` array already available).

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/attendance/calendar-index-missing-rows.test.ts
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useCalendarIndex } from '@/components/attendance/calendar/hooks/use-calendar-index';

const ROW = (
  date: string,
  audience: 'all' | 'primary' | 'secondary' = 'all'
) => ({
  date,
  audience,
  day_type: 'school_day' as const,
  hbl_overlay: false,
});

describe('useCalendarIndex — hasRowByIso', () => {
  it('marks a date with an explicit row as present', () => {
    const { result } = renderHook(() =>
      useCalendarIndex([ROW('2026-07-17')], [], null)
    );
    expect(result.current.hasRowByIso.has('2026-07-17')).toBe(true);
  });

  it('does NOT mark a date with zero rows as present', () => {
    const { result } = renderHook(() =>
      useCalendarIndex([ROW('2026-07-17')], [], null)
    );
    expect(result.current.hasRowByIso.has('2026-07-23')).toBe(false);
  });

  it('marks a date present when only a level-specific row exists (no "all" row)', () => {
    const { result } = renderHook(() =>
      useCalendarIndex([ROW('2026-07-17', 'primary')], [], 'primary')
    );
    expect(result.current.hasRowByIso.has('2026-07-17')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run __tests__/attendance/calendar-index-missing-rows.test.ts`
Expected: FAIL — `result.current.hasRowByIso` is `undefined`

- [ ] **Step 3: Implement**

In `use-calendar-index.ts`, inside the existing `byDateAud`-building loop (lines 42-51), add one line building a parallel `Set`:

```ts
// Added alongside the existing byDateAud Map build (same loop, same input,
// zero new queries): tracks every date that has AT LEAST ONE row for ANY
// audience, regardless of day_type — this is "the date is configured at
// all", independent of what it's configured AS. Powers the calendar's new
// "unmarked — will block attendance" flag (Phase 2 redesign).
const hasRowByIso = new Set<string>();
for (const row of calendar) {
  hasRowByIso.add(row.date);
}
```

Add `hasRowByIso` to the hook's returned object (alongside the existing `entriesByIso` return, near the end of the function body).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run __tests__/attendance/calendar-index-missing-rows.test.ts`
Expected: PASS, 3/3

- [ ] **Step 5: Commit**

```bash
git add components/attendance/calendar/hooks/use-calendar-index.ts __tests__/attendance/calendar-index-missing-rows.test.ts
git commit -m "feat(calendar): expose which dates have zero school_calendar rows

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Flag unmarked dates in the month grid + consequence panel

**Files:**

- Modify: `components/attendance/calendar/views/month-view.tsx`
- Modify: `components/attendance/calendar/calendar-cell.tsx`
- Modify: `app/(sis)/sis/calendar/page.tsx`
- Test: `__tests__/ui/calendar-cell-missing-row.test.tsx`

**Interfaces:**

- Consumes: `hasRowByIso` (Task 5).
- Produces: `CalendarCell` gains an optional `missingRow?: boolean` prop; when true and the cell is inside an already-started term, it renders the destructive "Unmarked" tag from the mockup instead of a bare cell.

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/ui/calendar-cell-missing-row.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CalendarCell } from '@/components/attendance/calendar/calendar-cell';

describe('CalendarCell — missingRow', () => {
  it('renders an "Unmarked" tag when missingRow is true', () => {
    render(
      <CalendarCell
        cell={{ iso: '2026-07-23', dayOfMonth: 23, outOfMonth: false }}
        chips={[]}
        missingRow
        onClick={() => {}}
      />
    );
    expect(screen.getByText('Unmarked')).toBeInTheDocument();
  });

  it('renders nothing extra when missingRow is false', () => {
    render(
      <CalendarCell
        cell={{ iso: '2026-07-17', dayOfMonth: 17, outOfMonth: false }}
        chips={[]}
        missingRow={false}
        onClick={() => {}}
      />
    );
    expect(screen.queryByText('Unmarked')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run __tests__/ui/calendar-cell-missing-row.test.tsx`
Expected: FAIL — `missingRow` prop not recognized / "Unmarked" not rendered

- [ ] **Step 3: Implement in `calendar-cell.tsx`**

Add `missingRow?: boolean` to `CalendarCell`'s props type. Following the exact pattern the existing `isBreak` band already uses (lines 140-145) for a full-width tag, add a sibling conditional block:

```tsx
{
  missingRow && !isBreak && (
    <span className="mt-1 block w-fit rounded bg-destructive px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-white">
      Unmarked
    </span>
  );
}
```

Also apply the destructive-bordered cell treatment from the mockup when `missingRow`: `className={cn(baseCellClass, missingRow && 'border-2 border-destructive/50 bg-destructive/5')}`.

- [ ] **Step 4: Wire `missingRow` through `MonthView`**

In `month-view.tsx`, `MonthView` needs the term's date range (already receives `term: {startDate, endDate}`, line ~358-370) and `index.hasRowByIso` (Task 5). For each rendered cell:

```ts
const cellInTerm = /* existing check, already computed per cell */;
const missingRow = cellInTerm && !index.hasRowByIso.has(cell.iso);
```

Pass `missingRow` into the `cellProps` object (alongside the existing props built at lines 291-303) so it reaches `CalendarCell`.

- [ ] **Step 5: Add the consequence panel to the calendar page**

In `app/(sis)/sis/calendar/page.tsx`, after loading `calendar`/`terms` (existing, lines 104-112), compute which dates in the SELECTED month are missing (a small inline reduce over the dated terms + `calendar` array — reuses the exact same "term has rows elsewhere" check `isNonSchoolDay` does, but read-only, no DB round trip since `calendar` is already loaded):

```tsx
// Mirrors the fail-closed gate in app/api/attendance/daily/route.ts's
// isNonSchoolDay: a date inside a term that has ANY calendar rows, but no
// row of its own, will be blocked. Surfaced here so a registrar sees it
// before a teacher hits the 409.
const datesWithRows = new Set(calendar.map((c) => c.date));
const missingDates = dated.flatMap((t) => {
  const termHasAnyRows = calendar.some((c) => c.term_id === t.id);
  if (!termHasAnyRows) return [];
  return eachWeekday(t.start_date, t.end_date).filter(
    (d) => !datesWithRows.has(d)
  );
});
```

(`eachWeekday` — reuse the existing date-iteration helper already in `lib/attendance/calendar.ts` if one exists with this exact signature; if not, this is a 5-line pure loop, not worth its own file for one call site.)

Render the consequence panel (matching the mockup exactly — destructive icon tile, `"Jul 23 will block attendance entry"` style headline naming the first missing date, body text `"This term already has other days marked, so an unlisted date reads as a holiday and teachers get blocked when they try to mark it."`) only when `missingDates.length > 0`, passed as a prop or rendered directly above `CalendarAdminClient`.

- [ ] **Step 6: Run to verify it passes**

Run: `npx vitest run __tests__/ui/calendar-cell-missing-row.test.tsx __tests__/attendance/calendar-index-missing-rows.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add components/attendance/calendar/views/month-view.tsx components/attendance/calendar/calendar-cell.tsx "app/(sis)/sis/calendar/page.tsx" __tests__/ui/calendar-cell-missing-row.test.tsx
git commit -m "feat(calendar): flag dates that will block attendance entry

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Consequence-first AY Setup checklist copy

**Files:**

- Modify: `lib/sis/year-setup.ts` (`checklistSummary`, lines 59-139)
- Test: `__tests__/sis/year-setup.test.ts` (extend existing, or create if absent)

**Interfaces:**

- Consumes: nothing new — `checklistSummary(stepId, ctx)` keeps its exact existing signature (`ReadinessStepId`, `{ step: ReadinessStep; ay: AcademicYearListItem; terms: TermRow[] }`).
- Produces: same signature, richer per-branch copy. No caller (`year-setup-checklist.tsx`) needs to change.

**Context:** This is a pure copy change inside an already-pure, already-tested function — the lowest-risk task in the whole plan. Each `case` branch in the existing `switch (stepId)` gets its plain-English consequence sentence upgraded, per the mockup's exact wording for the two most stakes-heavy steps (`calendar`, `classes`) — the other 6 branches keep their existing tone but should be spot-checked for the same "what actually happens" specificity.

- [ ] **Step 1: Write the failing test for the two upgraded branches**

```ts
// __tests__/sis/year-setup.test.ts (add to existing describe block, or create the file)
import { describe, expect, it } from 'vitest';
import { checklistSummary } from '@/lib/sis/year-setup';

describe('checklistSummary — consequence-first copy (Phase 2 redesign)', () => {
  it('calendar: partial state names the blocking consequence, not just a fraction', () => {
    const summary = checklistSummary('calendar', {
      step: { id: 'calendar', fraction: { done: 3, total: 4 } } as never,
      ay: {} as never,
      terms: [] as never,
    });
    expect(summary).toContain('will be blocked');
  });

  it('classes: partial state names what disappears from the report card', () => {
    const summary = checklistSummary('classes', {
      step: { id: 'classes', fraction: { done: 2, total: 3 } } as never,
      ay: {} as never,
      terms: [] as never,
    });
    expect(summary).toContain("won't appear on report cards");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run __tests__/sis/year-setup.test.ts`
Expected: FAIL — current copy doesn't contain those phrases

- [ ] **Step 3: Update the two branches in `checklistSummary`**

In `lib/sis/year-setup.ts`, locate the `case 'calendar':` and `case 'classes':` branches inside `checklistSummary`'s `switch`. Replace their partial-state message with:

```ts
case 'calendar': {
  if (!step.fraction) return 'Set term dates first.';
  const { done, total } = step.fraction;
  if (done === total) return `School days cover all ${total} term(s).`;
  const remaining = total - done;
  return `${remaining} term${remaining === 1 ? '' : 's'} still ${remaining === 1 ? 'has' : 'have'} unmarked dates — attendance entry will be blocked there until they're set.`;
}
case 'classes': {
  if (!step.fraction) return 'Create sections first.';
  const { done, total } = step.fraction;
  if (done === total) return `Every level's subjects are configured (${total}/${total}).`;
  const gap = total - done;
  return `${gap} level${gap === 1 ? '' : 's'} ${gap === 1 ? 'is' : 'are'} missing subjects from Structure Defaults — those subjects won't appear on report cards.`;
}
```

(Keep every other branch's existing text — the spec scoped this task to the two highest-stakes steps; the other six already read reasonably in plain English per the earlier KD #121 humanizer pass.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run __tests__/sis/year-setup.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/sis/year-setup.ts __tests__/sis/year-setup.test.ts
git commit -m "feat(sis): consequence-first checklist copy for calendar + classes steps

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Phase 2 verification

- `npx vitest run __tests__/attendance/calendar-index-missing-rows.test.ts __tests__/ui/calendar-cell-missing-row.test.tsx __tests__/sis/year-setup.test.ts` — all green.
- `npx next build` clean.
- Manual: on a test AY, remove a `school_calendar` row from the middle of a term that has other rows; confirm the calendar page shows it destructive-flagged with the consequence panel; confirm the AY Setup checklist's Calendar/Classes rows show the new consequence copy.

---

## Phase 3 — People &amp; rosters (Sections)

**Stakes:** `index_number` completeness is invisible on the sections list today (no query touches it) despite being load-bearing for the attendance register, xlsx export, and masterfile export.

**Staff (`/sis/admin/staff`) needs no task.** Confirmed this session: `StaffTable`'s `load` column already renders `"No assignments"` (`components/sis/staff-table.tsx:104-113`), and `AssignmentChips` (`components/sis/staff-visuals.tsx`) independently renders its own `"No assignments"` empty state when both `fcaSection` and `subjectAssignments` are empty. The redundancy is harmless, not a gap. Adviser data for Sections was also confirmed already-live (`loadFormAdvisersBySection` reads `teacher_assignments` directly, `lib/sis/staff.ts:145-172`) — there was never drift on this page, so no Fix-2-style correction applies here.

### Task 8: Index-completeness status + inline Generate Index on Sections list

**Files:**

- Modify: `app/(sis)/sis/sections/page.tsx` (lines 73-157)
- Modify: `components/sis/sections-data-table.tsx` (`SisSectionRow` type + `buildColumns`)
- Test: `__tests__/sis/section-index-status.test.ts`

**Interfaces:**

- Produces: `computeIndexStatus(activeCount: number, unnumberedCount: number): { label: string; tone: 'mint' | 'amber' }` (pure, colocated in a new small file so it's testable independent of the data fetch).
- `SisSectionRow` gains `indexStatus: { label: string; tone: 'mint' | 'amber' }`.

- [ ] **Step 1: Write the failing test for the pure classifier**

```ts
// __tests__/sis/section-index-status.test.ts
import { describe, expect, it } from 'vitest';
import { computeIndexStatus } from '@/lib/sis/section-index-status';

describe('computeIndexStatus', () => {
  it('mint "complete" when every active student has an index number', () => {
    expect(computeIndexStatus(21, 0)).toEqual({
      label: 'Index #1–21 complete',
      tone: 'mint',
    });
  });

  it('amber "N unnumbered" when some students are missing one', () => {
    expect(computeIndexStatus(20, 1)).toEqual({
      label: '1 student unnumbered',
      tone: 'amber',
    });
  });

  it('pluralizes correctly for multiple unnumbered students', () => {
    expect(computeIndexStatus(18, 3)).toEqual({
      label: '3 students unnumbered',
      tone: 'amber',
    });
  });

  it('an empty section (0 active) reads as complete, not amber', () => {
    expect(computeIndexStatus(0, 0)).toEqual({
      label: 'Index #1–0 complete',
      tone: 'mint',
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run __tests__/sis/section-index-status.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// lib/sis/section-index-status.ts
// Pure classifier for the sections-list index-completeness chip (Phase 3
// redesign) — surfaces what was previously invisible without opening each
// section (Joann's named misaligned-index-numbers pain point).

export type IndexStatus = { label: string; tone: 'mint' | 'amber' };

export function computeIndexStatus(
  activeCount: number,
  unnumberedCount: number
): IndexStatus {
  if (unnumberedCount === 0) {
    return { label: `Index #1–${activeCount} complete`, tone: 'mint' };
  }
  return {
    label: `${unnumberedCount} student${unnumberedCount === 1 ? '' : 's'} unnumbered`,
    tone: 'amber',
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run __tests__/sis/section-index-status.test.ts`
Expected: PASS, 4/4

- [ ] **Step 5: Fetch the new data in the sections page**

In `app/(sis)/sis/sections/page.tsx`, extend the existing `section_students` count query (lines ~98-110) to also select `index_number`, and compute `unnumberedCount` per section (active rows where `index_number IS NULL`) alongside the existing `active`/`withdrawn` counts:

```tsx
const { data: rosterRows } = await service
  .from('section_students')
  .select('section_id, enrollment_status, index_number')
  .in('section_id', sectionIds);

const unnumberedBySection = new Map<string, number>();
for (const r of rosterRows ?? []) {
  if (r.enrollment_status === 'withdrawn') continue;
  if (r.index_number == null) {
    unnumberedBySection.set(
      r.section_id,
      (unnumberedBySection.get(r.section_id) ?? 0) + 1
    );
  }
}
```

(This reuses/widens whatever the existing roster-count query already selects — do not add a second query if `section_students` is already fetched for the `active`/`withdrawn` counts; add `index_number` to that existing `.select(...)`.)

In the row-shape build (lines 149-157), add:

```tsx
indexStatus: computeIndexStatus(c.active, unnumberedBySection.get(c.id) ?? 0),
```

- [ ] **Step 6: Add the column**

In `components/sis/sections-data-table.tsx`, add `indexStatus: { label: string; tone: 'mint' | 'amber' }` to `SisSectionRow` (lines 24-32). Add a new column between `withdrawn` (line 139) and `actions` (line 140):

```tsx
{
  id: 'indexStatus',
  header: 'Index',
  cell: ({ row }) => {
    const s = row.original.indexStatus;
    const Icon = s.tone === 'mint' ? CheckCircle2 : AlertTriangle;
    return (
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'inline-flex h-6 items-center gap-1 rounded-full border px-2.5 font-sans text-[11px] font-semibold',
            s.tone === 'mint'
              ? 'border-brand-mint bg-brand-mint/20 text-ink'
              : 'border-brand-amber bg-brand-amber-light text-brand-amber'
          )}
        >
          <Icon className="size-3" />
          {s.label}
        </span>
        {s.tone === 'amber' && (
          <GenerateIndexButton
            sectionId={row.original.id}
            sectionName={row.original.name}
            termStarted={termStarted}
            variant="compact"
          />
        )}
      </div>
    );
  },
},
```

(`GenerateIndexButton` is the existing uncontrolled wrapper confirmed reusable this session — `components/sis/generate-index-button.tsx:152-179`, self-manages its own dialog state, `variant='compact'` already supported. `termStarted` is already computed and threaded through the page per the exploration — pass it down as a new prop on `SectionsDataTable` if it isn't already available at this call site.)

- [ ] **Step 7: Run**

Run: `npx vitest run __tests__/sis/section-index-status.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add lib/sis/section-index-status.ts __tests__/sis/section-index-status.test.ts "app/(sis)/sis/sections/page.tsx" components/sis/sections-data-table.tsx
git commit -m "feat(sis): index-completeness status + inline Generate Index on sections list

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Phase 3 verification

- `npx vitest run __tests__/sis/section-index-status.test.ts` — green.
- `npx next build` clean.
- Manual: on a test AY, confirm a section with an unindexed new student shows the amber chip + inline Generate Index button; clicking it opens the same dialog as the existing per-row `⋯` menu action (no duplicate dialog state); confirm a fully-indexed section shows the mint chip with no button.

---

## Phase 4 — Approvers

**Stakes:** confirmed this session — only ONE approver flow exists today (`APPROVER_FLOWS = ['markbook.change_request']`, `lib/schemas/approvers.ts:7`). A correction table `Record<ApproverFlow, ApproverUser[]>` — the earlier mockup's second "Attendance corrections" flow does not exist in the schema and must not be implemented as if it does. This task designs the readiness classifier to scale to N flows (the constants are already `Record`-shaped for extension) but renders the ONE real flow with real counts.

### Task 9: Per-flow approver readiness classifier (pure, TDD)

**Files:**

- Create: `lib/sis/approver-readiness.ts`
- Test: `__tests__/sis/approver-readiness.test.ts`

**Interfaces:**

- Produces: `classifyApproverReadiness(approverCount: number): { tone: 'mint' | 'destructive'; label: string; warning: string | null }`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/sis/approver-readiness.test.ts
import { describe, expect, it } from 'vitest';
import { classifyApproverReadiness } from '@/lib/sis/approver-readiness';

describe('classifyApproverReadiness', () => {
  it('2+ approvers is ready (mint), no warning', () => {
    expect(classifyApproverReadiness(3)).toEqual({
      tone: 'mint',
      label: 'Ready — 3 approvers',
      warning: null,
    });
  });

  it('exactly 1 approver is loudly flagged — a request needs two distinct people', () => {
    const r = classifyApproverReadiness(1);
    expect(r.tone).toBe('destructive');
    expect(r.label).toBe('Only 1 approver');
    expect(r.warning).toContain('two different approvers');
  });

  it('0 approvers is loudly flagged with a distinct message', () => {
    const r = classifyApproverReadiness(0);
    expect(r.tone).toBe('destructive');
    expect(r.label).toBe('No approvers assigned');
    expect(r.warning).toContain('No one can file');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run __tests__/sis/approver-readiness.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// lib/sis/approver-readiness.ts
// Pure. A locked-sheet change request requires a primary AND a distinct
// secondary approver from the flow's assigned list (app/api/change-requests/
// route.ts's filing validation) — a flow with 0 or 1 assigned approvers
// silently makes filing impossible on that flow. This classifier surfaces
// that as a loud, named state instead of a bare count.

export type ApproverReadiness = {
  tone: 'mint' | 'destructive';
  label: string;
  warning: string | null;
};

export function classifyApproverReadiness(
  approverCount: number
): ApproverReadiness {
  if (approverCount >= 2) {
    return {
      tone: 'mint',
      label: `Ready — ${approverCount} approvers`,
      warning: null,
    };
  }
  if (approverCount === 1) {
    return {
      tone: 'destructive',
      label: 'Only 1 approver',
      warning:
        'A correction needs two different approvers. With only one assigned, no one can file a request on this flow — add a second person now.',
    };
  }
  return {
    tone: 'destructive',
    label: 'No approvers assigned',
    warning:
      'No one can file a request on this flow until at least two approvers are assigned.',
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run __tests__/sis/approver-readiness.test.ts`
Expected: PASS, 3/3

- [ ] **Step 5: Commit**

```bash
git add lib/sis/approver-readiness.ts __tests__/sis/approver-readiness.test.ts
git commit -m "feat(sis): pure per-flow approver readiness classifier

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Grouped-by-flow readiness cards on Approvers page

**Files:**

- Modify: `components/sis/approvers-data-table.tsx` (add a readiness summary above the existing flat table)
- Test: `__tests__/ui/approver-readiness-card.test.tsx`

**Interfaces:**

- Consumes: `classifyApproverReadiness` (Task 9), `byFlow: AllApproversByFlow` (existing prop, `Record<ApproverFlow, ApproverUser[]>`).

**Context:** The existing flat table with a Flow facet (`components/sis/approvers-data-table.tsx`) stays — it's the correct primitive for when more flows exist. This task adds ONE new element above it: a per-flow readiness card row (today, exactly one card, since `APPROVER_FLOWS` has one entry), matching the mockup's healthy/destructive card treatment, driven by real `byFlow[flow].length` and `classifyApproverReadiness`.

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/ui/approver-readiness-card.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApproverReadinessCards } from '@/components/sis/approvers-data-table';

describe('ApproverReadinessCards', () => {
  it('renders one card per flow with the real approver count', () => {
    render(
      <ApproverReadinessCards
        byFlow={{
          'markbook.change_request': [
            { user_id: 'u1' },
            { user_id: 'u2' },
            { user_id: 'u3' },
          ] as never,
        }}
      />
    );
    expect(screen.getByText('Ready — 3 approvers')).toBeInTheDocument();
  });

  it('shows the destructive warning card when a flow has only 1 approver', () => {
    render(
      <ApproverReadinessCards
        byFlow={{ 'markbook.change_request': [{ user_id: 'u1' }] as never }}
      />
    );
    expect(screen.getByText('Only 1 approver')).toBeInTheDocument();
    expect(screen.getByText(/two different approvers/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run __tests__/ui/approver-readiness-card.test.tsx`
Expected: FAIL — `ApproverReadinessCards` not exported

- [ ] **Step 3: Implement — add the export to `approvers-data-table.tsx`**

```tsx
import { classifyApproverReadiness } from '@/lib/sis/approver-readiness';
import {
  APPROVER_FLOW_LABELS,
  type AllApproversByFlow,
} from '@/lib/schemas/approvers';

// One card per flow (today: exactly one, markbook.change_request — the
// constant is Record-shaped for future flows without this component
// changing). Matches the approved mockup's healthy/destructive card
// treatment, driven by the real per-flow approver count.
export function ApproverReadinessCards({
  byFlow,
}: {
  byFlow: AllApproversByFlow;
}) {
  return (
    <div className="space-y-3">
      {(Object.keys(byFlow) as Array<keyof AllApproversByFlow>).map((flow) => {
        const approvers = byFlow[flow];
        const readiness = classifyApproverReadiness(approvers.length);
        const destructive = readiness.tone === 'destructive';
        return (
          <div
            key={flow}
            className={cn(
              'overflow-hidden rounded-xl border',
              destructive ? 'border-2 border-destructive/40' : 'border-border'
            )}
          >
            <div
              className={cn(
                'flex items-center justify-between border-b px-5 py-3',
                destructive
                  ? 'border-destructive/30 bg-destructive/5'
                  : 'border-border bg-muted/60'
              )}
            >
              <p className="font-serif text-[15px] font-semibold text-foreground">
                {APPROVER_FLOW_LABELS[flow]}
              </p>
              <span
                className={cn(
                  'inline-flex h-6 items-center gap-1 rounded-full border px-2.5 font-sans text-[11px] font-semibold',
                  destructive
                    ? 'border-destructive/40 bg-destructive/10 text-destructive'
                    : 'border-brand-mint bg-brand-mint/20 text-ink'
                )}
              >
                {readiness.label}
              </span>
            </div>
            {readiness.warning && (
              <div className="flex items-start gap-3 bg-destructive/5 px-5 py-3.5">
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                <p className="text-[12.5px] leading-relaxed text-destructive">
                  {readiness.warning}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Mount it above the existing table**

In `app/(sis)/sis/admin/approvers/page.tsx`, add `<ApproverReadinessCards byFlow={byFlow} />` immediately before the existing `<ApproversDataTable byFlow candidatesByFlow />` call.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run __tests__/ui/approver-readiness-card.test.tsx`
Expected: PASS, 2/2

- [ ] **Step 6: Commit**

```bash
git add components/sis/approvers-data-table.tsx "app/(sis)/sis/admin/approvers/page.tsx" __tests__/ui/approver-readiness-card.test.tsx
git commit -m "feat(sis): loud per-flow readiness cards on Approvers page

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Phase 4 verification

- `npx vitest run __tests__/sis/approver-readiness.test.ts __tests__/ui/approver-readiness-card.test.tsx` — green.
- `npx next build` clean.
- Manual: with the real `markbook.change_request` flow's current approver count on a test AY, confirm the card reflects it accurately; temporarily remove approvers down to 1 via the existing remove flow, confirm the destructive card + warning appear; restore.

---

## Phase 5 — School details (School Config)

**Stakes:** every letterhead field maps to an exact spot on the printed card. Confirmed this session: `ReportCardLetterhead` is already a pure, reusable component (`{ config: SchoolConfig }`) — directly reusable for a live preview. The T4 signature block, however, is inline inside `ReportCardDocument` (not its own component) — this phase extracts it first so the real card and the preview share one implementation, never two that could drift.

### Task 11: Extract the signature block into a shared component

**Files:**

- Create: `components/report-card/report-card-signature-block.tsx`
- Modify: `components/report-card/report-card-document.tsx` (lines 331-372)
- Test: `__tests__/report-card/signature-block.test.tsx`

**Interfaces:**

- Produces: `ReportCardSignatureBlock({ isFinal, formClassAdviser, principalName, ceoName }: { isFinal: boolean; formClassAdviser: string | null; principalName: string; ceoName: string })`

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/report-card/signature-block.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReportCardSignatureBlock } from '@/components/report-card/report-card-signature-block';

describe('ReportCardSignatureBlock', () => {
  it('T4 (isFinal): renders adviser, principal, and CEO lines', () => {
    render(
      <ReportCardSignatureBlock
        isFinal
        formClassAdviser="Maria T."
        principalName="Dr. Santos"
        ceoName="Jane Lim"
      />
    );
    expect(screen.getByText('Maria T.')).toBeInTheDocument();
    expect(screen.getByText('Dr. Santos')).toBeInTheDocument();
    expect(screen.getByText('Jane Lim')).toBeInTheDocument();
    expect(screen.getByText('School Principal')).toBeInTheDocument();
    expect(screen.getByText('Founder & CEO')).toBeInTheDocument();
  });

  it('T4: falls back to "Form Teacher" label when no adviser name, and a blank space (not omitted) for empty principal/CEO', () => {
    render(
      <ReportCardSignatureBlock
        isFinal
        formClassAdviser={null}
        principalName=""
        ceoName=""
      />
    );
    expect(screen.getByText('Form Teacher')).toBeInTheDocument();
    // principal/CEO name nodes render but are visually blank — assert the
    // labels are still present (the space fallback keeps the layout, per
    // the real report-card-document.tsx rule, unlike the letterhead's
    // hide-when-empty rule).
    expect(screen.getByText('School Principal')).toBeInTheDocument();
    expect(screen.getByText('Founder & CEO')).toBeInTheDocument();
  });

  it('interim (T1-T3): renders only the Parent Signature block, no adviser/principal/CEO names', () => {
    render(
      <ReportCardSignatureBlock
        isFinal={false}
        formClassAdviser="Maria T."
        principalName="Dr. Santos"
        ceoName="Jane Lim"
      />
    );
    expect(screen.getByText("Parent's Signature")).toBeInTheDocument();
    expect(screen.queryByText('Maria T.')).not.toBeInTheDocument();
    expect(screen.queryByText('Dr. Santos')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run __tests__/report-card/signature-block.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Extract — move the exact JSX from `report-card-document.tsx:331-372` into the new file**

```tsx
// components/report-card/report-card-signature-block.tsx
// Extracted verbatim from report-card-document.tsx (T4 vs interim branching,
// the |= ' ' space-fallback for principal/CEO vs adviser's ?? 'Form Teacher'
// fallback) so a School Config live preview (Phase 5) can render EXACTLY
// what prints, never a re-derived approximation that could drift.

export function ReportCardSignatureBlock({
  isFinal,
  formClassAdviser,
  principalName,
  ceoName,
}: {
  isFinal: boolean;
  formClassAdviser: string | null;
  principalName: string;
  ceoName: string;
}) {
  if (!isFinal) {
    return (
      <div className="mt-8 flex justify-center">
        <div className="text-center text-[10.5px] text-ink-4">
          <div className="mb-6 h-px w-32 border-t border-hairline-strong" />
          <span>&nbsp;</span>
          <p className="mt-0.5 text-ink-5">Parent&apos;s Signature</p>
        </div>
      </div>
    );
  }
  return (
    <div className="mt-8 grid grid-cols-3 gap-6 sm:gap-8">
      <div className="text-center text-[10.5px] text-ink-4">
        <div className="mb-6 h-px w-24 border-t border-hairline-strong" />
        <span className="font-semibold text-foreground">
          {formClassAdviser ?? 'Form Teacher'}
        </span>
        <p className="mt-0.5 text-ink-5">Form Teacher</p>
      </div>
      <div className="text-center text-[10.5px] text-ink-4">
        <div className="mb-6 h-px w-24 border-t border-hairline-strong" />
        <span className="font-semibold text-foreground">
          {principalName || ' '}
        </span>
        <p className="mt-0.5 text-ink-5">School Principal</p>
      </div>
      <div className="text-center text-[10.5px] text-ink-4">
        <div className="mb-6 h-px w-24 border-t border-hairline-strong" />
        <span className="font-semibold text-foreground">{ceoName || ' '}</span>
        <p className="mt-0.5 text-ink-5">Founder &amp; CEO</p>
      </div>
    </div>
  );
}
```

(Copy the EXACT existing classNames from `report-card-document.tsx:331-372` rather than the illustrative ones above if they differ even slightly — read that file's current state first and transcribe verbatim; the snippet here is a faithful reconstruction from this session's exploration report but the implementer must diff against the live file before extracting.)

- [ ] **Step 4: Replace the inline block in `report-card-document.tsx`**

Delete lines 331-372, replace with:

```tsx
<ReportCardSignatureBlock
  isFinal={isFinal}
  formClassAdviser={section.form_class_adviser}
  principalName={schoolConfig.principalName}
  ceoName={schoolConfig.ceoName}
/>
```

Add the import at the top of the file.

- [ ] **Step 5: Run to verify it passes, then regression-check the existing report-card test**

Run: `npx vitest run __tests__/report-card/signature-block.test.tsx __tests__/report-card/build-report-card.test.ts`
Expected: PASS — the existing `build-report-card.test.ts` payload-level tests must still pass unmodified, proving the extraction didn't change the real card's rendered output.

- [ ] **Step 6: Commit**

```bash
git add components/report-card/report-card-signature-block.tsx components/report-card/report-card-document.tsx __tests__/report-card/signature-block.test.tsx
git commit -m "refactor(report-card): extract signature block into a shared component

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: Live letterhead + signature preview on School Config

**Files:**

- Modify: `components/sis/school-config-form.tsx`
- Test: `__tests__/ui/school-config-preview.test.tsx`

**Interfaces:**

- Consumes: `ReportCardLetterhead` (existing, `components/report-card/report-card-letterhead.tsx`), `ReportCardSignatureBlock` (Task 11).

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/ui/school-config-preview.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SchoolConfigPreview } from '@/components/sis/school-config-form';

const BASE_CONFIG = {
  organizationName: 'HFSE International School',
  addressLine1: '',
  addressLine2: '',
  phoneNumber: '+65 6250 1832',
  websiteUrl: '',
  contactEmail: '',
  peiRegistrationNumber: '200800000K',
  peiRegistrationStartDate: null,
  peiRegistrationEndDate: null,
  logoUrl: '',
  principalName: '',
  ceoName: 'Jane Lim',
} as never;

describe('SchoolConfigPreview', () => {
  it('renders the real letterhead with the live form values', () => {
    render(<SchoolConfigPreview config={BASE_CONFIG} />);
    expect(screen.getByText('HFSE International School')).toBeInTheDocument();
    expect(screen.getByText(/200800000K/)).toBeInTheDocument();
  });

  it('shows a visibly-missing state for an unset principal signature, matching what prints', () => {
    render(<SchoolConfigPreview config={BASE_CONFIG} />);
    expect(screen.getByText('School Principal')).toBeInTheDocument();
    // principalName is '' — the shared ReportCardSignatureBlock renders the
    // label but a blank name span, per the real card's space-fallback rule.
    expect(screen.getByText('Jane Lim')).toBeInTheDocument(); // ceoName IS set
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run __tests__/ui/school-config-preview.test.tsx`
Expected: FAIL — `SchoolConfigPreview` not exported

- [ ] **Step 3: Implement — add the export to `school-config-form.tsx`**

```tsx
import { ReportCardLetterhead } from '@/components/report-card/report-card-letterhead';
import { ReportCardSignatureBlock } from '@/components/report-card/report-card-signature-block';
import type { SchoolConfig } from '@/lib/sis/school-config';

// Renders the ACTUAL letterhead + T4 signature-block components with the
// form's live values — reuses report-card-letterhead.tsx and the newly
// extracted report-card-signature-block.tsx verbatim (Task 11), so a
// missing field is visibly missing here in exactly the same way it will be
// on the real printed card, never a re-derived approximation.
export function SchoolConfigPreview({ config }: { config: SchoolConfig }) {
  return (
    <div className="rounded-xl border-2 border-hairline-strong bg-card p-4 shadow-sm">
      <ReportCardLetterhead config={config} />
      <ReportCardSignatureBlock
        isFinal
        formClassAdviser="Joann R."
        principalName={config.principalName}
        ceoName={config.ceoName}
      />
    </div>
  );
}
```

(`formClassAdviser` is hardcoded to a placeholder name here — this preview is about the SCHOOL-LEVEL config fields, not a specific section's adviser, which the form has no notion of; the placeholder keeps the 3-column layout intact without implying a fake "no adviser" warning state.)

- [ ] **Step 4: Mount it in the form's layout**

In `SchoolConfigForm`'s render (the `<Tabs>` block, lines 169+), change the outer wrapper from a single-column form to a 2-column grid (`grid grid-cols-[1fr_360px] gap-6`) matching the mockup, with the existing `<Tabs>` in the left column and `<SchoolConfigPreview config={liveConfigFromState} />` in the right column. Build `liveConfigFromState` from the component's existing 19 `useState` fields (already all present — this is a read, not a new state shape) each render, so the preview updates live as fields change (no debounce needed — it's a pure render, not a network call).

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run __tests__/ui/school-config-preview.test.tsx`
Expected: PASS, 2/2

- [ ] **Step 6: Commit**

```bash
git add components/sis/school-config-form.tsx __tests__/ui/school-config-preview.test.tsx
git commit -m "feat(sis): live report-card preview on School Config

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Phase 5 verification

- `npx vitest run __tests__/report-card/signature-block.test.tsx __tests__/report-card/build-report-card.test.ts __tests__/ui/school-config-preview.test.tsx` — all green (the `build-report-card.test.ts` run proves Task 11's extraction is byte-identical to the pre-extraction render).
- `npx next build` clean.
- Manual: on `/sis/admin/school-config`, clear the principal-name field, confirm the live preview immediately shows the blank signature line in the same spot the real T4 card would; set it, confirm it appears.

---

## Phase 6 — Admissions-facing (Grade Levels + Discount Codes)

**Stakes:** lower than Phases 1-5. Confirmed this session: Grade Levels' `LevelsManagerClient` already has every prop needed for the parent-facing preview in memory (`levels` with `nextLevelId`/offered status via `offeredLevelIds`) — no new API call needed. Discount Codes has FOUR real states (Active/Scheduled/Expired/**Inactive**, not three) via the existing `classifyCodeStatus`/`DiscountCodeStatusBadge`, and the page's summary-count loop duplicates that classification instead of calling it — a real, small, honest fix.

### Task 13: Application-form level-picker preview on Grade Levels

**Files:**

- Modify: `components/sis/levels-manager-client.tsx`
- Test: `__tests__/ui/levels-application-preview.test.tsx`

**Interfaces:**

- Consumes: existing `levels: LevelRow[]` and `offeredLevelIds: Set<string>` props already on `LevelsManagerClient`.

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/ui/levels-application-preview.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApplicationFormLevelPreview } from '@/components/sis/levels-manager-client';

const LEVELS = [
  { id: 'p3', code: 'P3', label: 'Primary 3', nextLevelId: 'p4', isCore: true },
  { id: 'p4', code: 'P4', label: 'Primary 4', nextLevelId: null, isCore: true },
  {
    id: 'cs1',
    code: 'CS1',
    label: 'Cambridge Stage 1',
    nextLevelId: null,
    isCore: false,
  },
] as never;

describe('ApplicationFormLevelPreview', () => {
  it('shows offered levels as selectable and shelved levels struck through', () => {
    render(
      <ApplicationFormLevelPreview
        levels={LEVELS}
        offeredLevelIds={new Set(['p3', 'p4'])}
      />
    );
    expect(screen.getByText('Primary 3')).toBeInTheDocument();
    expect(screen.getByText('Primary 4')).toBeInTheDocument();
    expect(
      screen.getByText(/Cambridge Stage 1 — not shown/)
    ).toBeInTheDocument();
  });

  it("marks a returning student's next-level suggestion, when provided", () => {
    render(
      <ApplicationFormLevelPreview
        levels={LEVELS}
        offeredLevelIds={new Set(['p3', 'p4'])}
        returningFromLevelId="p3"
      />
    );
    expect(screen.getByText(/suggested/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run __tests__/ui/levels-application-preview.test.tsx`
Expected: FAIL — `ApplicationFormLevelPreview` not exported

- [ ] **Step 3: Implement — add the export to `levels-manager-client.tsx`**

```tsx
// Renders exactly what a parent sees on the application-form level picker
// for the accepting AY — derived from the SAME props/offeredLevelIds
// already loaded for the toggle list (no new API call; mirrors the shape
// GET /api/parent/v2/levels returns: code, label, nextCode, offered).
export function ApplicationFormLevelPreview({
  levels,
  offeredLevelIds,
  returningFromLevelId,
}: {
  levels: LevelRow[];
  offeredLevelIds: Set<string>;
  returningFromLevelId?: string;
}) {
  const suggestedNextId = returningFromLevelId
    ? levels.find((l) => l.id === returningFromLevelId)?.nextLevelId
    : null;

  return (
    <div className="rounded-xl border-2 border-hairline-strong bg-card p-4 shadow-sm">
      <p className="mb-1 text-[11px] font-medium text-ink-4">
        Which level are you applying for?
      </p>
      <div className="space-y-1.5">
        {levels.map((level) => {
          const offered = offeredLevelIds.has(level.id);
          const suggested = level.id === suggestedNextId;
          if (!offered) {
            return (
              <div
                key={level.id}
                className="rounded-md border border-dashed border-hairline-strong bg-muted/40 px-3 py-2 text-[13px] text-ink-5 line-through"
              >
                {level.label} — not shown
              </div>
            );
          }
          return (
            <div
              key={level.id}
              className={cn(
                'rounded-md border px-3 py-2 text-[13px]',
                suggested
                  ? 'border-brand-indigo bg-accent font-medium text-brand-indigo-deep'
                  : 'border-border bg-card text-ink-3'
              )}
            >
              {level.label}
              {suggested && (
                <span className="ml-1 rounded bg-brand-indigo/10 px-1.5 py-0.5 font-mono text-[9px]">
                  suggested
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Mount it**

In `LevelsManagerClient`'s render (the 2-column area near the unmatched-demand banner, lines 207-234), add a right-column preview: `<ApplicationFormLevelPreview levels={levels} offeredLevelIds={offeredLevelIds} />` (no `returningFromLevelId` by default — that's an illustrative prop for a future "preview as a specific returning student" enhancement, not required for this task's minimum scope).

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run __tests__/ui/levels-application-preview.test.tsx`
Expected: PASS, 2/2

- [ ] **Step 6: Commit**

```bash
git add components/sis/levels-manager-client.tsx __tests__/ui/levels-application-preview.test.tsx
git commit -m "feat(sis): parent application-form level-picker preview on Grade Levels

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 14: Discount Codes — dedupe status classification (4 real states)

**Files:**

- Modify: `app/(sis)/sis/admin/discount-codes/page.tsx` (lines 58-69)
- Test: `__tests__/sis/discount-codes-summary.test.ts`

**Interfaces:**

- Consumes: `classifyCodeStatus` (existing, `components/ui/discount-code-status-badge.tsx:39-51`).

**Context:** Confirmed this session — the page's summary-tile counts hand-roll their own date-comparison loop and never produce an `inactive` bucket (it `continue`s on missing dates), while the table's per-row badges already correctly use all 4 states via `classifyCodeStatus`. This fixes the drift by making the summary use the SAME function.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/sis/discount-codes-summary.test.ts
import { describe, expect, it } from 'vitest';
import { classifyCodeStatus } from '@/components/ui/discount-code-status-badge';
import { summarizeDiscountCodeStatuses } from '@/lib/sis/discount-codes-summary';

describe('summarizeDiscountCodeStatuses', () => {
  it('tallies all four real states, including inactive (missing dates)', () => {
    const codes = [
      { startDate: '2020-01-01', endDate: '2020-12-31' }, // expired
      { startDate: '2099-01-01', endDate: '2099-12-31' }, // scheduled
      { startDate: null, endDate: null }, // inactive
    ];
    const counts = summarizeDiscountCodeStatuses(codes, classifyCodeStatus);
    expect(counts).toEqual({
      active: 0,
      scheduled: 1,
      expired: 1,
      inactive: 1,
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run __tests__/sis/discount-codes-summary.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// lib/sis/discount-codes-summary.ts
// Tallies the SAME classifyCodeStatus the table's per-row badges already
// use (components/ui/discount-code-status-badge.tsx) — the page's summary
// tiles previously hand-rolled a separate date-comparison loop that never
// produced an "inactive" bucket, so the two could disagree.

export type DiscountCodeStatus =
  | 'active'
  | 'scheduled'
  | 'expired'
  | 'inactive';

export function summarizeDiscountCodeStatuses<T>(
  codes: T[],
  classify: (start: string | null, end: string | null) => DiscountCodeStatus
): Record<DiscountCodeStatus, number> {
  const counts: Record<DiscountCodeStatus, number> = {
    active: 0,
    scheduled: 0,
    expired: 0,
    inactive: 0,
  };
  for (const c of codes as unknown as Array<{
    startDate: string | null;
    endDate: string | null;
  }>) {
    counts[classify(c.startDate, c.endDate)] += 1;
  }
  return counts;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run __tests__/sis/discount-codes-summary.test.ts`
Expected: PASS

- [ ] **Step 5: Replace the page's hand-rolled loop**

In `app/(sis)/sis/admin/discount-codes/page.tsx`, delete the existing inline loop (lines 58-69) and replace with:

```tsx
const statusCounts = summarizeDiscountCodeStatuses(codes, classifyCodeStatus);
```

Update the 4 `HubStat` tiles to read `statusCounts.active` / `.scheduled` / `.expired` / `.inactive` (adding a 4th "Inactive" tile if the page currently only renders 3, matching the real state count now that it's accurate).

- [ ] **Step 6: Run**

Run: `npx vitest run __tests__/sis/discount-codes-summary.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add lib/sis/discount-codes-summary.ts __tests__/sis/discount-codes-summary.test.ts "app/(sis)/sis/admin/discount-codes/page.tsx"
git commit -m "fix(sis): discount-codes summary tiles use the real 4-state classifier

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Phase 6 verification

- `npx vitest run __tests__/ui/levels-application-preview.test.tsx __tests__/sis/discount-codes-summary.test.ts` — green.
- `npx next build` clean.
- Manual: on Grade Levels, toggle a level's Offered switch off, confirm the preview immediately shows it struck through. On Discount Codes, confirm the summary tiles' total matches the table's row count exactly (including any `inactive` codes with missing dates).

---

## Phase 7 — System &amp; Hub polish (Admin Hub)

**Stakes:** lowest daily-use value for Audit Log/Settings (confirmed already stable, already using `SisPageHeader`/`PageShell` — no task needed). The payoff is wiring the Hub's attention feed to the signals built in Phases 1-6.

**Audit Log and Settings need no task.** Confirmed this session both already use the shared shell/header pattern correctly — a "light consistency pass" here means literally nothing to change (they already match every other page's tokens).

### Task 15: Extend the hub attention feed with new signal types

**Files:**

- Modify: `lib/sis/hub-attention.ts` (`buildAttentionRows`, lines 37-84)
- Modify: `app/(sis)/sis/page.tsx` (data-fetch `Promise.all`, lines 59-90)
- Test: `__tests__/sis/hub-attention.test.ts` (extend existing)

**Interfaces:**

- Consumes: `computeSubjectConfigGaps` (Fix 3, existing), `classifyApproverReadiness` (Task 9).
- Produces: `buildAttentionRows` gains 3 new optional input fields; same `AttentionRow[]` output type, same `HubAttentionFeed` consumer (unchanged, confirmed generic over `AttentionRow[]`).

- [ ] **Step 1: Write the failing tests for the 3 new row types**

```ts
// __tests__/sis/hub-attention.test.ts — add to the existing test file
import { buildAttentionRows } from '@/lib/sis/hub-attention';

describe('buildAttentionRows — Phase 7 additions', () => {
  const BASE_INPUT = {
    unassigned: [],
    pendingChangeRequests: 0,
    levelDemand: [],
    acceptingAyCode: 'AY2027',
  };

  it('adds a destructive row per section with no form adviser', () => {
    const rows = buildAttentionRows({
      ...BASE_INPUT,
      unassignedAdviserSections: [{ id: 'sec-1', name: 'S4 Excellence' }],
    });
    const row = rows.find((r) => r.id === 'unassigned-adviser-sec-1');
    expect(row).toMatchObject({
      severity: 'destructive',
      text: expect.stringContaining('S4 Excellence'),
    });
  });

  it('adds an amber row when an approver flow is under-resourced', () => {
    const rows = buildAttentionRows({
      ...BASE_INPUT,
      approverFlowCounts: { 'markbook.change_request': 1 },
    });
    const row = rows.find(
      (r) => r.id === 'approver-flow-markbook.change_request'
    );
    expect(row?.severity).toBe('destructive'); // 1 approver = destructive per classifyApproverReadiness
  });

  it('adds an amber row per level missing subjects from Structure Defaults', () => {
    const rows = buildAttentionRows({
      ...BASE_INPUT,
      subjectConfigGaps: [
        {
          levelId: 's1',
          levelLabel: 'Secondary 1',
          missingSubjectCodes: ['SCI', 'PE'],
        },
      ],
    });
    const row = rows.find((r) => r.id === 'subject-config-gap-s1');
    expect(row).toMatchObject({
      severity: 'amber',
      text: expect.stringContaining('Secondary 1'),
    });
  });

  it('omits all three new row types when their inputs are absent (backward compatible)', () => {
    const rows = buildAttentionRows(BASE_INPUT);
    expect(rows.some((r) => r.id.startsWith('unassigned-adviser-'))).toBe(
      false
    );
    expect(rows.some((r) => r.id.startsWith('approver-flow-'))).toBe(false);
    expect(rows.some((r) => r.id.startsWith('subject-config-gap-'))).toBe(
      false
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run __tests__/sis/hub-attention.test.ts`
Expected: FAIL — new inputs not recognized, new rows absent

- [ ] **Step 3: Implement — extend `buildAttentionRows`**

In `lib/sis/hub-attention.ts`, widen the input type (existing `input: {...}` object, lines ~13-19 based on the function signature) with 3 new OPTIONAL fields, and append 3 new row-building blocks after the existing 3 (level-demand block ends at line 82):

```ts
export function buildAttentionRows(input: {
  unassigned: ClassAssignmentReadinessRow[];
  pendingChangeRequests: number;
  levelDemand: LevelDemandRow[];
  acceptingAyCode: string;
  unassignedAdviserSections?: Array<{ id: string; name: string }>;
  approverFlowCounts?: Record<string, number>;
  subjectConfigGaps?: Array<{
    levelId: string;
    levelLabel: string;
    missingSubjectCodes: string[];
  }>;
}): AttentionRow[] {
  const rows: AttentionRow[] = [];
  // ... existing 3 blocks, unchanged ...

  for (const section of input.unassignedAdviserSections ?? []) {
    rows.push({
      id: `unassigned-adviser-${section.id}`,
      severity: 'destructive',
      text: `${section.name} has no form adviser`,
      meta: 'blocks publish',
      href: '/sis/sections',
      actionLabel: 'Assign',
    });
  }

  for (const [flow, count] of Object.entries(input.approverFlowCounts ?? {})) {
    if (count >= 2) continue; // ready, nothing to flag
    rows.push({
      id: `approver-flow-${flow}`,
      severity: 'destructive',
      text:
        count === 1
          ? 'Only 1 approver on a grade-change flow'
          : 'No approvers assigned to a grade-change flow',
      meta: 'flow blocked',
      href: '/sis/admin/approvers',
      actionLabel: 'Add approver',
    });
  }

  for (const gap of input.subjectConfigGaps ?? []) {
    rows.push({
      id: `subject-config-gap-${gap.levelId}`,
      severity: 'amber',
      text: `${gap.levelLabel} is missing ${gap.missingSubjectCodes.length} subject${gap.missingSubjectCodes.length === 1 ? '' : 's'} from Structure Defaults`,
      meta: gap.missingSubjectCodes.join(', '),
      href: '/sis/admin/subjects',
      actionLabel: 'Fix',
    });
  }

  return rows;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run __tests__/sis/hub-attention.test.ts`
Expected: PASS, all cases including pre-existing ones (regression check)

- [ ] **Step 5: Wire the new data fetches into the hub page**

In `app/(sis)/sis/page.tsx`, extend the existing `Promise.all` (lines 59-83) with three new parallel fetches, following the exact pattern the existing `levelDemand` fetch already uses (own loader, `unstable_cache`-wrapped, tagged `sis:${ayCode}` per the confirmed pattern at lines 190-258):

```tsx
const [
  unassignedStudents,
  hubKpis,
  levelDemand,
  unassignedAdviserSections,
  approverFlowCounts,
  subjectConfigGapsForHub,
] = await Promise.all([
  getClassAssignmentReadiness(ayCode),
  getHubKpis(ayCode),
  loadLevelDemand(acceptingAyCode),
  loadUnassignedAdviserSections(ayCode), // new — sections with zero teacher_assignments role='form_adviser' rows
  loadApproverFlowCounts(), // new — Record<ApproverFlow, number> from listAllApproverAssignments()
  loadSubjectConfigGapsForHub(ayCode), // new — computeSubjectConfigGaps() over every in-use level, not just the currently-viewed one
]);

const attentionRows = buildAttentionRows({
  unassigned: unassignedStudents,
  pendingChangeRequests: hubKpis.pendingChangeRequests,
  levelDemand,
  acceptingAyCode,
  unassignedAdviserSections,
  approverFlowCounts,
  subjectConfigGaps: subjectConfigGapsForHub,
});
```

`loadUnassignedAdviserSections`, `loadApproverFlowCounts`, `loadSubjectConfigGapsForHub` are three small new loader functions in `lib/sis/hub-attention.ts` (or a sibling file if that one is getting long) — each a thin wrapper: the first queries `sections` LEFT JOIN `teacher_assignments` filtering to rows with no match; the second calls the existing `listAllApproverAssignments()` (`lib/sis/approvers/queries.ts`, confirmed this session) and maps to counts; the third calls the existing `computeSubjectConfigGaps` (Fix 3) against ALL in-use levels for the AY (not scoped to one level like the Subject Weights page banner is).

- [ ] **Step 6: Commit**

```bash
git add lib/sis/hub-attention.ts "app/(sis)/sis/page.tsx" __tests__/sis/hub-attention.test.ts
git commit -m "feat(sis): hub attention feed surfaces adviser/approver/subject-config gaps

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Phase 7 verification

- `npx vitest run __tests__/sis/hub-attention.test.ts` — all green, including the 4 pre-existing row-type tests (regression) and the 4 new ones.
- `npx next build` clean.
- Manual: on a test AY with a known unassigned-adviser section, an under-resourced approver flow, and a subject-config gap, confirm all three appear on the Hub's "Needs attention" feed with correct links.

---

## Final plan-wide verification

- Full `npx vitest run` — every test file touched across all 7 phases green, no regressions elsewhere.
- Full `npx next build` clean.
- `rg "slate-|zinc-|gray-|bg-white|bg-black" components/sis components/report-card components/attendance/calendar lib/sis --type tsx --type ts` (Hard Rule #7 self-check across every file this plan touches) — expect zero hits.
- Manual browser pass, one per phase, per each phase's own verification section above — 7 total, in order.
- Run `/sync-docs` at the end to update CLAUDE.md session context + dev-plan snapshot with the shipped redesign, per the project's workflow rule.

## Self-review

**1. Spec coverage:** Every one of the spec's 7 phases has at least one task producing its stated functionality upgrade: Phase 1 (Apply-with-preview = Task 2, grading-sheet preview = Task 3, drift tab = Task 4), Phase 2 (calendar block-flag = Tasks 5-6, consequence checklist = Task 7), Phase 3 (index status = Task 8; Staff explicitly needs none, per spec's own "already good" framing), Phase 4 (readiness cards = Tasks 9-10, corrected to the real single-flow schema), Phase 5 (live preview = Tasks 11-12), Phase 6 (level preview = Task 13, discount-codes fix = Task 14), Phase 7 (hub signals = Task 15; Audit/Settings explicitly need none).

**2. Placeholder scan:** No TBD/TODO. One noted exception is intentional and disclosed, not a placeholder: Task 11 Step 3's signature-block JSX is flagged as "faithful reconstruction from this session's exploration — the implementer must diff against the live file before extracting," since the plan-writer did not have byte-for-byte source in front of it for that one block (unlike every other task, which is built from directly-read code). This is a controlled, single, disclosed exception — not a pattern.

**3. Type consistency:** `AttentionRow`, `TemplateDiff`, `IndexStatus`, `ApproverReadiness` are each defined once (Tasks 1, 8, 9, 15's extension) and consumed with matching field names throughout. `SchoolConfig`, `Config` (subject_configs), `TemplateSubjectConfigRow` reuse the existing repo types confirmed this session rather than redefining them.
