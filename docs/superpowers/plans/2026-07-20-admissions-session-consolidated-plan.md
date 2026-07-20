# Admissions Session Consolidated Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship every request from this session as four independently-shippable, gated phases — admissions touch-tracking + demo-account cleanup, level-name reconciliation, manual section-assignment consolidation, and Structure Defaults (template) removal — in an order where each phase's checks pass before the next phase's tasks begin, so no phase can land half-wired against a codebase state that hasn't been verified.

**Architecture:** Phase 1 is unchanged from the already-written plan at `docs/superpowers/plans/2026-07-17-admissions-touch-tracking-and-account-cleanup.md` (referenced, not duplicated). Phase 2 implements `docs/superpowers/specs/2026-07-18-admissions-level-alias-reconciliation-design.md`. Phase 3 implements `docs/superpowers/specs/2026-07-20-manual-section-assignment-design.md`. Phase ordering for 1-3 is deliberate: Phase 2 makes `class-assignment.ts`'s level lookup correct while its auto-pick still exists; Phase 3 then deletes that auto-pick and carries the (already-correct) level-resolution forward into the new shared candidates function, so there's never a window where level names regress to the old 10-alias-only lookup.

**Phase 4 is independent of Phases 1-3** — implements `docs/superpowers/specs/2026-07-20-remove-structure-defaults-template-design.md`, touches an entirely different subsystem (AY-Setup / Structure Defaults, not admissions/enrollment), and shares no files with Phases 1-3. It has no ordering dependency on them in either direction, but per updated instruction it is implemented on the **same branch** as Phases 1-3, not a separate one — "independent" here describes execution order and file overlap only, not branch/PR isolation.

**Tech Stack:** Postgres/PL-pgSQL (Supabase), Next.js 16 API routes + Server Components, TanStack Query + React Hook Form + Zod, shadcn/Radix UI primitives — all consistent with the rest of this repo, no new dependencies.

## Global Constraints

- Single shared Supabase project (KD #1) — each phase's migration apply covers every AY table (test + prod) in one shot.
- **Deploy ordering applies within each phase** (see each phase's own note) — never applies _across_ phases; each phase is independently deployable once its own gate passes.
- Design system (Hard Rule #7): every new UI element reuses existing tokens/primitives already in the files being touched — no new colors, no new component patterns.
- Column identifiers on `ay{YYYY}_enrolment_status` are inconsistently cased in the frozen upstream DDL — copy every identifier byte-for-byte from this plan.
- No `git push`/destructive git ops in this plan — migrations are applied by the user to the Supabase project directly, matching every prior migration in this repo.
- **Phase gates are hard stops.** Do not begin a phase's tasks until the prior phase's gate criteria are all met (Phase 4 excepted — see above, it has no ordering dependency on 1-3).

---

## Phase 1 — Admissions touch-tracking + demo-account cleanup

**Status:** Already fully specified, unchanged. Full task detail (exact migration SQL, exact route code, exact component code) lives in `docs/superpowers/plans/2026-07-17-admissions-touch-tracking-and-account-cleanup.md` — follow that document's 5 tasks verbatim:

1. **Task 1** — Migration 087: auto-stamp `applicationUpdatedDate` + the 8 per-stage `*UpdatedDate` columns via a new `BEFORE UPDATE` trigger on `ay{YYYY}_enrolment_status`; restores a `attach_doc_revision_trigger` call silently dropped from `create_ay_admissions_tables` since migration 050 (found during that plan's research — a live KD #119-class regression, not hypothetical).
2. **Task 2** — Remove the now-unnecessary `?? a.created_at` staleness fallback in `lib/admissions/dashboard.ts`; reword the "Stages not updated in >7 days" insight copy in `lib/dashboard/insights.ts` to "No activity recorded in >7 days"; fix a false "verified" claim in `__tests__/admissions/staleness.test.ts`.
3. **Task 3** — Add `'environment.demo_accounts_removed'` to the `AuditAction` union + humanizer label.
4. **Task 4** — New `GET`/`DELETE /api/sis/admin/environment/demo-accounts` route: previews and removes seeded demo/test staff accounts (identified via `user_metadata.seeded_teacher`/`seeded_for_enrolee` or an `@demo.com` fallback).
5. **Task 5** — "Remove demo accounts" button + confirm dialog on `components/sis/environment-card.tsx`, modeled on the existing "Reset Test environment" panel in the same file.

**Phase 1 gate (must pass before Phase 2 begins):**

- [ ] Migration 087 applied to the Supabase project; `information_schema.triggers` verification query (Task 1 Step 3 of the referenced plan) confirms both triggers exist on every AY table.
- [ ] `npm run test -- staleness` and `npm run test -- humanize` pass.
- [ ] `npx next build` compiles clean.
- [ ] Manual verification: `/sis/admin/settings` → "Remove demo accounts" dialog shows real accounts (or "none found"), removal works, audit log shows the entry.

---

## Phase 2 — Admissions level-name reconciliation

Implements `docs/superpowers/specs/2026-07-18-admissions-level-alias-reconciliation-design.md`. **Deploy ordering within this phase:** Task 2.1's migration must be applied before Task 2.3/2.4's code ships (those query the new table).

### Task 2.1: Migration — `level_aliases` table + seed the known GEP variants

**Files:**

- Create: `supabase/migrations/088_level_aliases.sql`

**Interfaces:**

- Produces: table `public.level_aliases (id, raw_label unique, level_id, created_by, created_at)`.

- [ ] **Step 1: Write the migration**

```sql
-- 088_level_aliases.sql
--
-- class-assignment.ts::pickSectionForApplicant resolves an applicant's
-- level by looking up `application.levelApplied` (free text carried on the
-- admissions tables, KD #53) against `public.levels.label`. The only
-- normalization is `canonicalizeLevelLabel` (lib/sis/levels.ts) — a fixed
-- 10-entry digit-form -> word-form map. Anything else fails the lookup
-- outright, and the student's classLevel/classSection never get written —
-- exactly the gap `/records/unsynced` (KD #90) already detects, so these
-- students become one-off manual fixes with no institutional memory of
-- what the raw string meant.
--
-- Real source: HFSE's parent-portal admissions layer carries a parallel
-- "HFSE Global Education Programme" (GEP) naming track alongside the plain
-- Primary/Secondary names, confirmed against the portal's own
-- GRADE_PROGRESSIONS map. This table is the durable, staff-editable memory
-- that makes a portal naming change (which happens periodically) cost one
-- registrar click instead of a code deploy.
--
-- Idempotent + safe to re-run (ON CONFLICT DO NOTHING on the seed inserts).
-- Apply after 087.

create table if not exists public.level_aliases (
  id uuid primary key default gen_random_uuid(),
  raw_label text not null,
  level_id uuid not null references public.levels(id) on delete cascade,
  created_by uuid null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint level_aliases_raw_label_unique unique (raw_label)
);

comment on table public.level_aliases is
  'Staff-editable memory mapping an observed admissions levelApplied string to a canonical public.levels row. Populated via /records/level-mismatches. See docs/superpowers/specs/2026-07-18-admissions-level-alias-reconciliation-design.md.';

-- Seed the known GEP-track variants against the current levels catalog.
-- The 7 preschool/K2-equivalent values ("Youngstarters | ...", "GEP -
-- Year 1 (equivalent to K2)") are deliberately NOT seeded — no SIS level
-- exists for them (migration 086 removed preschool levels entirely; real
-- data confirmed HFSE never operationally used them). They will correctly
-- keep surfacing in the reconciliation queue as unresolved until a future,
-- separate project re-adds preschool-tier levels.
do $$
declare
  v_p1 uuid; v_p2 uuid; v_p3 uuid; v_p4 uuid; v_p5 uuid; v_p6 uuid;
  v_s1 uuid; v_s2 uuid; v_s3 uuid;
begin
  select id into v_p1 from public.levels where label = 'Primary One';
  select id into v_p2 from public.levels where label = 'Primary Two';
  select id into v_p3 from public.levels where label = 'Primary Three';
  select id into v_p4 from public.levels where label = 'Primary Four';
  select id into v_p5 from public.levels where label = 'Primary Five';
  select id into v_p6 from public.levels where label = 'Primary Six';
  select id into v_s1 from public.levels where label = 'Secondary One';
  select id into v_s2 from public.levels where label = 'Secondary Two';
  select id into v_s3 from public.levels where label = 'Secondary Three';

  if v_p1 is null or v_p2 is null or v_p3 is null or v_p4 is null
     or v_p5 is null or v_p6 is null or v_s1 is null or v_s2 is null
     or v_s3 is null then
    raise exception 'level_aliases seed: one or more canonical levels missing from public.levels — check migration 086 landed correctly before re-running this seed.';
  end if;

  insert into public.level_aliases (raw_label, level_id) values
    ('HFSE Global Education Programme – Year 2 (equivalent to Primary One)', v_p1),
    ('HFSE Global Education Programme - Primary 2', v_p2),
    ('HFSE Global Education Programme - Primary 3', v_p3),
    ('HFSE Global Education Programme - Primary 4', v_p4),
    ('HFSE Global Education Programme - Primary 5', v_p5),
    ('HFSE Global Education Programme - Primary 6', v_p6),
    ('HFSE Global Education Programme – Year 8', v_s1),
    ('HFSE Global Education Programme – Year 9', v_s2),
    ('HFSE Global Education Programme – Year 10', v_s3)
  on conflict (raw_label) do nothing;
end $$;
```

- [ ] **Step 2: Apply the migration to the Supabase project**

Apply via the Supabase SQL editor/CLI, after Phase 1's migration 087.

- [ ] **Step 3: Verify the seed landed**

```sql
select raw_label, l.label as maps_to
from public.level_aliases la
join public.levels l on l.id = la.level_id
order by raw_label;
```

Expected: exactly the 9 rows from the seed block, each `maps_to` matching the table in the spec.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/088_level_aliases.sql
git commit -m "feat(sis): add level_aliases table, seed known GEP-track naming variants"
```

### Task 2.2: `resolveLevelIdFromCatalog` + `resolveLevelId`

**Files:**

- Modify: `lib/sis/levels.ts`
- Test: `__tests__/sis/levels.test.ts` (create if it doesn't already exist — check first; if it does, add to it)

**Interfaces:**

- Produces: `resolveLevelIdFromCatalog(rawLabel, knownLevels, aliases): string | null` (pure), `resolveLevelId(service, rawLabel): Promise<string | null>` (async, DB-backed).
- Consumes: `LEVEL_LABELS`, `canonicalizeLevelLabel`, `getLevelRows`, `LevelRow` (all already exported from this file).

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, expect, it } from 'vitest';
import { resolveLevelIdFromCatalog, type LevelRow } from '@/lib/sis/levels';

const LEVELS: LevelRow[] = [
  {
    id: 'p1',
    code: 'P1',
    label: 'Primary One',
    levelType: 'primary',
    sortOrder: 1,
    nextLevelId: null,
    isCore: true,
  },
  {
    id: 's2',
    code: 'S2',
    label: 'Secondary Two',
    levelType: 'secondary',
    sortOrder: 8,
    nextLevelId: null,
    isCore: true,
  },
];
const ALIASES = [
  { raw_label: 'HFSE Global Education Programme – Year 9', level_id: 's2' },
];

describe('resolveLevelIdFromCatalog', () => {
  it('resolves an exact canonical label match', () => {
    expect(resolveLevelIdFromCatalog('Primary One', LEVELS, ALIASES)).toBe(
      'p1'
    );
  });

  it('resolves via the legacy digit-form fallback', () => {
    expect(resolveLevelIdFromCatalog('Primary 1', LEVELS, ALIASES)).toBe('p1');
  });

  it('resolves via an alias when no direct/legacy match exists', () => {
    expect(
      resolveLevelIdFromCatalog(
        'HFSE Global Education Programme – Year 9',
        LEVELS,
        ALIASES
      )
    ).toBe('s2');
  });

  it('returns null when nothing matches', () => {
    expect(
      resolveLevelIdFromCatalog('Youngstarters', LEVELS, ALIASES)
    ).toBeNull();
  });

  it('returns null for null/empty input', () => {
    expect(resolveLevelIdFromCatalog(null, LEVELS, ALIASES)).toBeNull();
    expect(resolveLevelIdFromCatalog('', LEVELS, ALIASES)).toBeNull();
  });

  it('trims whitespace before matching', () => {
    expect(resolveLevelIdFromCatalog('  Primary One  ', LEVELS, ALIASES)).toBe(
      'p1'
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- levels`
Expected: FAIL — `resolveLevelIdFromCatalog` is not exported yet.

- [ ] **Step 3: Implement**

Add to `lib/sis/levels.ts`, after `compareLevelLabels` and before the "DB-backed level rows" section header:

```typescript
export type LevelAliasRow = { raw_label: string; level_id: string };

/**
 * Resolves a raw observed level label to a `levels.id`. Pure — no DB
 * access, unit-testable directly. Order: (1) exact match against
 * `knownLevels[].label`, (2) `canonicalizeLevelLabel`'s legacy digit-form
 * fallback re-checked against `knownLevels[].label`, (3) exact match
 * against `aliases[].raw_label`. Returns null when nothing matches —
 * callers treat that as "needs reconciliation," never guess.
 */
export function resolveLevelIdFromCatalog(
  rawLabel: string | null | undefined,
  knownLevels: LevelRow[],
  aliases: LevelAliasRow[]
): string | null {
  if (rawLabel == null) return null;
  const trimmed = rawLabel.trim();
  if (!trimmed) return null;

  const direct = knownLevels.find((l) => l.label === trimmed);
  if (direct) return direct.id;

  const canonical = canonicalizeLevelLabel(trimmed);
  if (canonical && canonical !== trimmed) {
    const viaLegacy = knownLevels.find((l) => l.label === canonical);
    if (viaLegacy) return viaLegacy.id;
  }

  const viaAlias = aliases.find((a) => a.raw_label === trimmed);
  return viaAlias ? viaAlias.level_id : null;
}

/**
 * DB-backed wrapper around `resolveLevelIdFromCatalog`. Fetches the
 * current levels catalog + the full alias table and resolves once.
 */
export async function resolveLevelId(
  service: SupabaseClient,
  rawLabel: string | null | undefined
): Promise<string | null> {
  if (rawLabel == null || !rawLabel.trim()) return null;

  const [levels, aliasRes] = await Promise.all([
    getLevelRows(service),
    service.from('level_aliases').select('raw_label, level_id'),
  ]);
  if (aliasRes.error) throw aliasRes.error;

  return resolveLevelIdFromCatalog(
    rawLabel,
    levels,
    (aliasRes.data ?? []) as LevelAliasRow[]
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- levels`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/sis/levels.ts __tests__/sis/levels.test.ts
git commit -m "feat(sis): add resolveLevelId — alias-aware level resolution"
```

### Task 2.3: Swap into `pickSectionForApplicant`'s level lookup

**Files:**

- Modify: `lib/sis/class-assignment.ts:72-86`

**Interfaces:**

- Consumes: `resolveLevelId` from Task 2.2.

Note: this function is deleted wholesale in Phase 3 (Task 3.1) — this task exists so that between Phase 2 and Phase 3 landing, auto-assignment correctly resolves GEP-named levels rather than regressing. Small, temporary, but required for phase-independence (Phase 2 must be correct on its own before Phase 3 exists).

- [ ] **Step 1: Replace the lookup**

Replace:

```typescript
// `application.levelApplied` is the word-form label after migration 029
// ("Primary One", not "P1"). The `levels` table stores both the short
// `code` (FK identifier — 'P1') and the `label` (display string — 'Primary
// One'). Look up by label, defending against any legacy digit-form rows
// ("Primary 1") via `canonicalizeLevelLabel`.
const labelLookup = canonicalizeLevelLabel(application.levelApplied);
const { data: levelRow, error: levelErr } = await service
  .from('levels')
  .select('id, code, label')
  .eq('label', labelLookup ?? application.levelApplied)
  .maybeSingle();
if (levelErr || !levelRow) {
  return { error: `Level ${application.levelApplied} has no section` };
}
const level = levelRow as { id: string; code: string; label: string };
```

with:

```typescript
// Resolves canonical labels, the legacy digit-form fallback, AND any
// staff-defined alias for a portal naming variant (migration 088, KD
// level-alias reconciliation). A null here means genuinely unresolved —
// the applicant surfaces in /records/level-mismatches for a registrar to
// map once, which then resolves every future application with the same
// raw string automatically.
const levelId = await resolveLevelId(service, application.levelApplied);
if (!levelId) {
  return { error: `Level ${application.levelApplied} has no section` };
}
const { data: levelRow, error: levelErr } = await service
  .from('levels')
  .select('id, code, label')
  .eq('id', levelId)
  .maybeSingle();
if (levelErr || !levelRow) {
  return { error: `Level ${application.levelApplied} has no section` };
}
const level = levelRow as { id: string; code: string; label: string };
```

- [ ] **Step 2: Update the import**

Replace `import { canonicalizeLevelLabel } from '@/lib/sis/levels';` with `import { resolveLevelId } from '@/lib/sis/levels';`.

- [ ] **Step 3: Run the existing test + build**

Run: `npm run test -- class-assignment && npx next build`
Expected: PASS / clean compile (this only touches level resolution; `scoreSection`, the only tested export, is untouched).

- [ ] **Step 4: Commit**

```bash
git add lib/sis/class-assignment.ts
git commit -m "fix(sis): resolve GEP-track level names in auto-assignment via level_aliases"
```

### Task 2.4: `POST /api/sis/level-aliases` — save a mapping

**Files:**

- Create: `app/api/sis/level-aliases/route.ts`
- Modify: `lib/audit/log-action.ts` (AuditAction union)
- Modify: `lib/audit/humanize.ts` (label map)

**Interfaces:**

- Consumes: `LevelRemapSchema` (already exists, `lib/schemas/level.ts`), `requireRole`, `createServiceClient`, `logAction`, `invalidateAllOperationalDrills`.
- Produces: `POST` → `{ ok: true }` or `{ error: string }`.

- [ ] **Step 1: Add the audit action**

In `lib/audit/log-action.ts`, find the `level.*` entries (kept dormant per KD #153's superseded note) and add a new sibling directly after them:

```typescript
  | 'level.alias.create'
```

- [ ] **Step 2: Add the humanized label**

In `lib/audit/humanize.ts`, add alongside the existing dormant `level.*` entries:

```typescript
  'level.alias.create': 'Level naming variant mapped',
```

- [ ] **Step 3: Write the route**

```typescript
import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { logAction } from '@/lib/audit/log-action';
import { LevelRemapSchema } from '@/lib/schemas/level';
import { createServiceClient } from '@/lib/supabase/service';
import { invalidateAllOperationalDrills } from '@/lib/cache/invalidate-drill-tags';
import { getCurrentAcademicYear } from '@/lib/academic-year';

// POST /api/sis/level-aliases
// Body: { fromLabel: string, toLevelId: uuid }
//
// Saves (or corrects, via upsert) a mapping from an observed admissions
// `levelApplied` string to a canonical `public.levels` row. See
// docs/superpowers/specs/2026-07-18-admissions-level-alias-reconciliation-design.md.
// No retry/auto-assignment side effect here — per
// docs/superpowers/specs/2026-07-20-manual-section-assignment-design.md,
// section assignment is always registrar-manual, so this route only needs
// to make the label resolvable. Affected applications simply become
// normal "level known, section not yet assigned" rows in /records/unsynced.
export async function POST(request: Request) {
  const auth = await requireRole(['registrar', 'school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = LevelRemapSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { fromLabel, toLevelId } = parsed.data;

  const service = createServiceClient();

  const { data: levelRow, error: levelErr } = await service
    .from('levels')
    .select('id, label')
    .eq('id', toLevelId)
    .maybeSingle();
  if (levelErr || !levelRow) {
    return NextResponse.json({ error: 'Level not found' }, { status: 404 });
  }

  const { error: upsertErr } = await service.from('level_aliases').upsert(
    {
      raw_label: fromLabel,
      level_id: toLevelId,
      created_by: auth.user.id,
    },
    { onConflict: 'raw_label' }
  );
  if (upsertErr) {
    return NextResponse.json({ error: upsertErr.message }, { status: 500 });
  }

  const current = await getCurrentAcademicYear();
  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'level.alias.create',
    entityType: 'level',
    entityId: toLevelId,
    context: {
      raw_label: fromLabel,
      mapped_to_label: (levelRow as { label: string }).label,
    },
  });

  if (current) {
    await invalidateAllOperationalDrills(current.ay_code);
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Manual verification**

No live-DB test harness in this repo (consistent with every other DB-backed route) — verify manually: `POST` a body with a real unmatched label (query `level_aliases`/`levels` for a valid target id first) and confirm the row appears via the Step 3 verification query from Task 2.1.

- [ ] **Step 5: Run the build**

Run: `npx next build`
Expected: clean compile.

- [ ] **Step 6: Commit**

```bash
git add app/api/sis/level-aliases/route.ts lib/audit/log-action.ts lib/audit/humanize.ts
git commit -m "feat(sis): add POST /api/sis/level-aliases to save level naming mappings"
```

### Task 2.5: `/records/level-mismatches` — the reconciliation queue

**Files:**

- Create: `app/(records)/records/level-mismatches/page.tsx`
- Create: `components/sis/level-mismatches-table.tsx`
- Modify: `lib/auth/roles.ts` (nav entry + `SidebarBadgeKey`)
- Modify: `lib/sidebar/registry.ts` (icon)
- Modify: `app/(records)/layout.tsx` (badge count wiring)

**Interfaces:**

- Consumes: `loadUnmatchedLevelLabels`, `countUnmatchedLevelLabels` (both already exist, `lib/sis/level-review.ts`), `getLevelRows` (`lib/sis/levels.ts`), the route from Task 2.4.

- [ ] **Step 1: Extend `SidebarBadgeKey`**

In `lib/auth/roles.ts`, find:

```typescript
export type SidebarBadgeKey =
  | 'changeRequests'
  | 'pendingDocValidation'
  | 'unsyncedStudents'
  | 'pfileAwaitingVerification';
```

and add:

```typescript
export type SidebarBadgeKey =
  | 'changeRequests'
  | 'pendingDocValidation'
  | 'unsyncedStudents'
  | 'pfileAwaitingVerification'
  | 'levelMismatches';
```

- [ ] **Step 2: Add the nav entry**

In `lib/auth/roles.ts`, in `RECORDS_NAV`'s `'Operations'` section, immediately after the `/records/unsynced` entry:

```typescript
    {
      href: '/records/unsynced',
      label: 'Students needing setup',
      badgeKey: 'unsyncedStudents',
    },
    {
      href: '/records/level-mismatches',
      label: 'Level naming to review',
      badgeKey: 'levelMismatches',
    },
```

- [ ] **Step 3: Add the sidebar icon**

In `lib/sidebar/registry.ts`, in `SIDEBAR_REGISTRY.records.iconByHref`, add alongside `'/records/unsynced': UserX,`:

```typescript
    '/records/level-mismatches': FileQuestion,
```

Add `FileQuestion` to the existing `lucide-react` import at the top of the file.

- [ ] **Step 4: Wire the badge count in the layout**

In `app/(records)/layout.tsx`, add the import:

```typescript
import { countUnmatchedLevelLabels } from '@/lib/sis/level-review';
```

and extend the existing badges block:

```typescript
const levelMismatchCount = await countUnmatchedLevelLabels();
const badges: SidebarBadges = {
  unsyncedStudents: unsyncedCount > 0 ? unsyncedCount : undefined,
  levelMismatches: levelMismatchCount > 0 ? levelMismatchCount : undefined,
};
```

(Merge into the existing `badges` object build — don't create a second one.)

- [ ] **Step 5: Write the picker table component**

```typescript
// components/sis/level-mismatches-table.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Save } from 'lucide-react';

import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { UnmatchedLevelLabel } from '@/lib/sis/level-review';

type LevelOption = { id: string; code: string; label: string };

export function LevelMismatchesTable({
  rows,
  levels,
}: {
  rows: UnmatchedLevelLabel[];
  levels: LevelOption[];
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        No unresolved level names right now.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <LevelMismatchRow key={row.rawLabel} row={row} levels={levels} />
      ))}
    </div>
  );
}

function LevelMismatchRow({
  row,
  levels,
}: {
  row: UnmatchedLevelLabel;
  levels: LevelOption[];
}) {
  const router = useRouter();
  const [selectedLevelId, setSelectedLevelId] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: true }>(
        '/api/sis/level-aliases',
        jsonInit('POST', { fromLabel: row.rawLabel, toLevelId: selectedLevelId })
      ),
    onSuccess: () => {
      toast.success(`Mapped "${row.rawLabel}" — this label now resolves automatically.`);
      router.refresh();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Could not save mapping');
    },
  });
  const saving = saveMutation.isPending;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-hairline bg-card p-4 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="font-mono text-sm font-medium text-foreground">
          {row.rawLabel}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">
            {row.appsCount + row.statusCount} row{row.appsCount + row.statusCount === 1 ? '' : 's'}
          </Badge>
          <span>{row.ayCodes.join(', ')}</span>
          {row.sampleEnrolees.length > 0 && (
            <span>e.g. {row.sampleEnrolees.slice(0, 3).join(', ')}</span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Select
          value={selectedLevelId ?? undefined}
          onValueChange={setSelectedLevelId}
          disabled={saving}
        >
          <SelectTrigger className="h-9 w-48">
            <SelectValue placeholder="Maps to…" />
          </SelectTrigger>
          <SelectContent>
            {levels.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                <span className="font-mono text-xs">{l.code}</span>
                <span className="ml-2 text-muted-foreground">{l.label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          disabled={!selectedLevelId || saving}
          onClick={() => saveMutation.mutate()}
        >
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          Save
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Write the page**

```typescript
// app/(records)/records/level-mismatches/page.tsx
import { redirect } from 'next/navigation';

import { getSessionUser } from '@/lib/auth/session';
import { loadUnmatchedLevelLabels } from '@/lib/sis/level-review';
import { getLevelRows } from '@/lib/sis/levels';
import { createServiceClient } from '@/lib/supabase/service';
import { LevelMismatchesTable } from '@/components/sis/level-mismatches-table';
import { PageShell } from '@/components/ui/page-shell';

export default async function LevelMismatchesPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!['registrar', 'school_admin', 'superadmin'].includes(user.role ?? '')) {
    redirect('/');
  }

  const service = createServiceClient();
  const [rows, levels] = await Promise.all([
    loadUnmatchedLevelLabels(),
    getLevelRows(service),
  ]);

  return (
    <PageShell>
      <div className="space-y-1">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Records · Operations
        </p>
        <h1 className="font-serif text-2xl font-semibold tracking-tight text-foreground">
          Level names to review
        </h1>
        <p className="text-sm text-muted-foreground">
          {rows.length === 0
            ? 'Every observed level name currently resolves to a known level.'
            : `${rows.length} level name${rows.length === 1 ? '' : 's'} from admissions data don't match a known level yet — map each one once and it resolves automatically from then on.`}
        </p>
      </div>
      <LevelMismatchesTable
        rows={rows}
        levels={levels.map((l) => ({ id: l.id, code: l.code, label: l.label }))}
      />
    </PageShell>
  );
}
```

Adjust the exact `getSessionUser`/`PageShell` import paths if they differ from `/records/unsynced`'s actual imports — verify against that file before finalizing (Task 2.5 Step 6 depends on matching its established pattern exactly; if `page.tsx` for `/records/unsynced` uses different helper names, mirror those instead of the above).

- [ ] **Step 7: Run the build**

Run: `npx next build`
Expected: clean compile.

- [ ] **Step 8: Commit**

```bash
git add app/\(records\)/records/level-mismatches/ components/sis/level-mismatches-table.tsx lib/auth/roles.ts lib/sidebar/registry.ts app/\(records\)/layout.tsx
git commit -m "feat(records): add level-mismatches reconciliation queue"
```

### Phase 2 gate (must pass before Phase 3 begins)

- [ ] Migration 088 applied; seed verification query returns the 9 expected rows.
- [ ] `npm run test -- levels class-assignment` passes.
- [ ] `npx next build` compiles clean.
- [ ] Manual verification: `/records/level-mismatches` lists at least the 7 preschool/K2 labels (expected — they're unresolved by design) plus any other real unmatched labels found live; saving a mapping removes that row from the queue and the sidebar badge count decrements.
- [ ] Manual verification: an application whose `levelApplied` is one of the 9 seeded GEP variants successfully auto-assigns on the Enrolled flip (still using the pre-Phase-3 auto-pick at this point) instead of erroring.

---

## Phase 3 — Manual section-assignment consolidation

Implements `docs/superpowers/specs/2026-07-20-manual-section-assignment-design.md`. This is the most invasive phase — it deletes working auto-assignment code and changes an established UI flow. Each task is ordered so the codebase keeps compiling between commits, but the **phase as a whole should be reviewed as one unit before considering it "shippable"**, since a partial landing (e.g., Task 3.1 without 3.5/3.6) would leave the Enrolled-flip still calling deleted code.

### Task 3.1: Extract shared candidates + validation, delete auto-pick

**Files:**

- Modify: `lib/sis/class-assignment.ts` (near-total rewrite)
- Delete: `__tests__/sis/class-assignment.test.ts` (tests `scoreSection`, which is deleted)
- Create: `__tests__/sis/class-assignment.test.ts` (new content, testing what remains)

**Interfaces:**

- Removes: `pickSectionForApplicant`, `scoreSection`, `ClassAssignment`, `ClassAssignmentError`, `ApplicationLite`.
- Produces: `MAX_ACTIVE_PER_SECTION` (exported constant, single source of truth — replaces 3 independent hardcoded copies), `AssignableSection` type (`{id, name, activeCount}` — moved here from `components/sis/assign-section-dialog.tsx`, that file re-exports it for backward compat), `AssignableLevel` type (`{id, code, label, levelType}`), `listAssignableSections(service, ayCode, levelApplied): Promise<{level: AssignableLevel | null; sections: AssignableSection[]}>`, `validateSectionChoice(service, sectionId, ayCode): Promise<{section: {id, name, level_id, ay_code}} | {error: string}>` (extracted from `assign-section` route's inline validation, reused by both that route and the new stage-route Enrolled-flip check).
- Consumes: `resolveLevelId` (Task 2.2).

- [ ] **Step 1: Write the new file**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveLevelId } from '@/lib/sis/levels';

// Section-assignment support — level/section lookups shared by every place
// a section gets assigned to a student. Per
// docs/superpowers/specs/2026-07-20-manual-section-assignment-design.md,
// there is deliberately no auto-pick anywhere in the system: this module
// only surfaces state (which sections exist, how full each is); a
// registrar always makes the actual choice. Consolidates what used to be
// three independent implementations (this file's old auto-pick,
// records-lite-page.tsx's private loadAvailableSections, and three
// separate hardcoded copies of the 50-student cap).

export const MAX_ACTIVE_PER_SECTION = 50;

export type AssignableSection = {
  id: string;
  name: string;
  activeCount: number;
};

export type AssignableLevel = {
  id: string;
  code: string;
  label: string;
  levelType: 'primary' | 'secondary';
};

/**
 * Every section at the applicant's level, with live active headcounts.
 * Returns every section regardless of capacity — callers (the picker UI)
 * show full sections as disabled rather than hiding them, so the registrar
 * has full visibility into state before deciding. `level` is null when the
 * raw label doesn't resolve (canonical, legacy digit-form, or alias) —
 * callers should point the registrar at /records/level-mismatches in that
 * case rather than showing an empty section list.
 */
export async function listAssignableSections(
  service: SupabaseClient,
  ayCode: string,
  levelApplied: string | null
): Promise<{ level: AssignableLevel | null; sections: AssignableSection[] }> {
  if (!levelApplied) return { level: null, sections: [] };

  const { data: ayRow } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode)
    .maybeSingle();
  if (!ayRow) return { level: null, sections: [] };
  const ayId = (ayRow as { id: string }).id;

  const levelId = await resolveLevelId(service, levelApplied);
  if (!levelId) return { level: null, sections: [] };

  const { data: levelRow } = await service
    .from('levels')
    .select('id, code, label, level_type')
    .eq('id', levelId)
    .maybeSingle();
  if (!levelRow) return { level: null, sections: [] };
  const level: AssignableLevel = {
    id: (levelRow as { id: string }).id,
    code: (levelRow as { code: string }).code,
    label: (levelRow as { label: string }).label,
    levelType: (levelRow as { level_type: 'primary' | 'secondary' }).level_type,
  };

  const { data: sectionRows } = await service
    .from('sections')
    .select('id, name')
    .eq('academic_year_id', ayId)
    .eq('level_id', levelId);
  const sections = (sectionRows ?? []) as Array<{ id: string; name: string }>;
  if (sections.length === 0) return { level, sections: [] };

  const sectionIds = sections.map((s) => s.id);
  const { data: activeRows } = await service
    .from('section_students')
    .select('section_id')
    .eq('enrollment_status', 'active')
    .in('section_id', sectionIds);
  const activeCountById = new Map<string, number>();
  for (const r of (activeRows ?? []) as Array<{ section_id: string }>) {
    activeCountById.set(
      r.section_id,
      (activeCountById.get(r.section_id) ?? 0) + 1
    );
  }

  return {
    level,
    sections: sections
      .map((s) => ({
        id: s.id,
        name: s.name,
        activeCount: activeCountById.get(s.id) ?? 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/**
 * Server-side validation for a registrar-chosen section — shared by the
 * assign-section route and the stage route's Enrolled-flip. Confirms the
 * section exists, belongs to the given AY, and isn't at capacity at write
 * time (a second student could fill it between page-load and confirm).
 */
export async function validateSectionChoice(
  service: SupabaseClient,
  sectionId: string,
  ayCode: string
): Promise<
  | {
      section: {
        id: string;
        name: string;
        levelId: string;
        levelLabel: string;
      };
    }
  | { error: string }
> {
  const { data: sectionRow, error: sectionErr } = await service
    .from('sections')
    .select(
      'id, name, level_id, levels!inner(label), academic_years!inner(ay_code)'
    )
    .eq('id', sectionId)
    .maybeSingle();
  if (sectionErr)
    return { error: `Section lookup failed: ${sectionErr.message}` };
  if (!sectionRow) return { error: 'Section not found' };

  const row = sectionRow as unknown as {
    id: string;
    name: string;
    level_id: string;
    levels: { label: string } | null;
    academic_years: { ay_code: string } | null;
  };
  if (row.academic_years?.ay_code !== ayCode) {
    return { error: 'Section does not belong to this academic year' };
  }
  if (!row.levels?.label) {
    return { error: 'Section has no level label' };
  }

  const { count, error: countErr } = await service
    .from('section_students')
    .select('*', { count: 'exact', head: true })
    .eq('section_id', sectionId)
    .eq('enrollment_status', 'active');
  if (countErr) return { error: `Capacity check failed: ${countErr.message}` };
  if ((count ?? 0) >= MAX_ACTIVE_PER_SECTION) {
    return { error: 'This section is at capacity (50 students)' };
  }

  return {
    section: {
      id: row.id,
      name: row.name,
      levelId: row.level_id,
      levelLabel: row.levels.label,
    },
  };
}
```

- [ ] **Step 2: Replace the old test file**

Delete `__tests__/sis/class-assignment.test.ts`'s content (it only tested `scoreSection`, now removed) and replace with:

```typescript
import { describe, expect, it } from 'vitest';
import { MAX_ACTIVE_PER_SECTION } from '@/lib/sis/class-assignment';

// listAssignableSections/validateSectionChoice are DB-backed — manual
// verification only, consistent with every other DB-backed function in
// this repo (no live-DB test harness exists here). This suite covers what
// is pure/testable: the shared capacity constant.
describe('class-assignment constants', () => {
  it('MAX_ACTIVE_PER_SECTION matches Hard Rule #5', () => {
    expect(MAX_ACTIVE_PER_SECTION).toBe(50);
  });
});
```

- [ ] **Step 3: Run the build**

Run: `npx next build`
Expected: **FAILS** at this point — every consumer of the deleted `pickSectionForApplicant`/`ClassAssignment`/`ClassAssignmentError` exports (the stage route, Task 3.5/3.6) is still referencing them. This is expected; Tasks 3.4-3.6 fix every call site. Do not attempt to make the build pass within this task alone — proceed to the remaining tasks, then verify the build at the phase gate.

- [ ] **Step 4: Commit**

```bash
git add lib/sis/class-assignment.ts __tests__/sis/class-assignment.test.ts
git commit -m "refactor(sis): replace auto-pick class-assignment with shared listAssignableSections/validateSectionChoice"
```

### Task 3.2: `NewSectionButton` gains an inline-create mode

**Files:**

- Modify: `components/markbook/new-section-button.tsx`

**Interfaces:**

- Adds optional prop `onCreated?: (section: { id: string; name: string }) => void`.

The existing component always navigates to `/sis/sections/${id}` on success — correct for its current callers (the SIS Admin sections page, the level-scoped "add section" card), wrong for an inline picker where navigating away would abandon the assignment flow. This is additive: existing callers that don't pass `onCreated` keep today's exact behavior.

- [ ] **Step 1: Add the prop + branch the success handler**

In `components/markbook/new-section-button.tsx`, add `onCreated` to the destructured props:

```typescript
export function NewSectionButton({
  levels,
  ayCode,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  initialLevelId,
  onCreated,
}: {
  levels: LevelOption[];
  ayCode: string | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  initialLevelId?: string;
  /** When provided, a successful create calls this instead of navigating
   *  to the new section's admin page — used when this button is mounted
   *  inside another flow (e.g. the section-assignment picker) that must
   *  not be abandoned on section creation. */
  onCreated?: (section: { id: string; name: string }) => void;
}) {
```

Replace the `onSubmit` success branch:

```typescript
try {
  const body = await createMutation.mutateAsync(values);
  toast.success(`Created ${values.name}`);
  setOpen(false);
  form.reset(blankValues());
  // Section setup lives in SIS Admin now (2026-04-22).
  router.push(`/sis/sections/${body.id}`);
  router.refresh();
} catch (e) {
  toast.error(e instanceof Error ? e.message : 'create failed');
}
```

with:

```typescript
try {
  const body = await createMutation.mutateAsync(values);
  toast.success(`Created ${values.name}`);
  setOpen(false);
  form.reset(blankValues());
  if (onCreated) {
    onCreated({ id: body.id, name: values.name.trim() });
    router.refresh();
  } else {
    // Section setup lives in SIS Admin now (2026-04-22).
    router.push(`/sis/sections/${body.id}`);
    router.refresh();
  }
} catch (e) {
  toast.error(e instanceof Error ? e.message : 'create failed');
}
```

- [ ] **Step 2: Run the build**

Run: `npx next build`
Expected: clean compile (additive optional prop, no existing caller affected).

- [ ] **Step 3: Commit**

```bash
git add components/markbook/new-section-button.tsx
git commit -m "feat(markbook): NewSectionButton supports inline-create via onCreated callback"
```

### Task 3.3: `AssignSectionDialog` gains inline section creation + level metadata

**Files:**

- Modify: `components/sis/assign-section-dialog.tsx`

**Interfaces:**

- `AssignSectionDialogProps` gains `level: AssignableLevel | null` (replaces the current bare `levelApplied: string | null` — callers now pass the full resolved level object from `listAssignableSections`, so the dialog doesn't need to re-derive display text or level metadata separately).
- Re-exports `AssignableSection` from `@/lib/sis/class-assignment` instead of defining it locally (Task 3.1 moved the canonical definition there).

- [ ] **Step 1: Update the type import + props**

Replace:

```typescript
export type AssignableSection = {
  id: string;
  name: string;
  activeCount: number;
};

export type AssignSectionDialogProps = {
  enroleeNumber: string;
  studentName: string;
  ayCode: string;
  levelApplied: string | null;
  availableSections: AssignableSection[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};
```

with:

```typescript
import type {
  AssignableLevel,
  AssignableSection,
} from '@/lib/sis/class-assignment';

export type { AssignableSection };

export type AssignSectionDialogProps = {
  enroleeNumber: string;
  studentName: string;
  ayCode: string;
  level: AssignableLevel | null;
  availableSections: AssignableSection[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};
```

- [ ] **Step 2: Update the component body's `levelApplied` references + add the create-section affordance**

Replace the function signature:

```typescript
export function AssignSectionDialog({
  enroleeNumber,
  studentName,
  ayCode,
  levelApplied,
  availableSections,
  open,
  onOpenChange,
}: AssignSectionDialogProps) {
```

with:

```typescript
export function AssignSectionDialog({
  enroleeNumber,
  studentName,
  ayCode,
  level,
  availableSections,
  open,
  onOpenChange,
}: AssignSectionDialogProps) {
  const [localSections, setLocalSections] = React.useState(availableSections);
  React.useEffect(() => {
    setLocalSections(availableSections);
  }, [availableSections]);
```

Replace every remaining `levelApplied` reference in the render body:

- `DialogDescription`'s `{levelApplied ? (...) : (...)}` ternary → use `level?.label` in place of `levelApplied` in both branches, and the `strong` tag content.
- The empty-state string `No sections available for {levelApplied ?? 'this level'} in {ayCode}.` → `No sections available for {level?.label ?? 'this level'} in {ayCode}.`
- Change `sorted` to derive from `localSections` instead of `availableSections`:

```typescript
const sorted = React.useMemo(
  () =>
    [...localSections]
      .map((s) => ({ ...s, isAtCapacity: s.activeCount >= MAX_PER_SECTION }))
      .sort(
        (a, b) =>
          Number(a.isAtCapacity) - Number(b.isAtCapacity) ||
          a.activeCount - b.activeCount ||
          a.name.localeCompare(b.name)
      ),
  [localSections]
);
```

- [ ] **Step 3: Add the inline "Create new section" affordance**

Add the import:

```typescript
import { NewSectionButton } from '@/components/markbook/new-section-button';
```

Add local state for the create-dialog's open flag, near `selectedId`:

```typescript
const [createOpen, setCreateOpen] = React.useState(false);
```

In the JSX, immediately after the `<div className="space-y-2 py-2">...</div>` candidates block and before `<DialogFooter>`, add:

```tsx
{
  level && (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setCreateOpen(true)}
        disabled={submitting}
        className="w-full"
      >
        <Plus className="size-3.5" />
        Create a new section for {level.label}
      </Button>
      <NewSectionButton
        levels={[
          {
            id: level.id,
            code: level.code,
            label: level.label,
            level_type: level.levelType,
          },
        ]}
        ayCode={ayCode}
        open={createOpen}
        onOpenChange={setCreateOpen}
        initialLevelId={level.id}
        onCreated={(section) => {
          setLocalSections((prev) => [
            ...prev,
            { id: section.id, name: section.name, activeCount: 0 },
          ]);
          setSelectedId(section.id);
        }}
      />
    </>
  );
}
```

Add `Plus` to the existing `lucide-react` import line.

- [ ] **Step 4: Run the build**

Run: `npx next build`
Expected: **still fails** — Task 3.4 updates this component's remaining callers (`UnsyncedActionCard`) to pass `level` instead of `levelApplied`. Expected at this stage.

- [ ] **Step 5: Commit**

```bash
git add components/sis/assign-section-dialog.tsx
git commit -m "feat(sis): AssignSectionDialog supports inline section creation, takes resolved level"
```

### Task 3.4: Wire `records-lite-page.tsx` onto the shared candidates function

**Files:**

- Modify: `components/sis/records-lite-page.tsx`
- Modify: `components/sis/unsynced-action-card.tsx`

**Interfaces:**

- Consumes: `listAssignableSections` (Task 3.1).

- [ ] **Step 1: Delete the private `loadAvailableSections` and its call site**

Delete the entire `loadAvailableSections` function (the "Section lookup" block, currently lines ~488-548 of `records-lite-page.tsx`) and its `canonicalizeLevelLabel` import if unused elsewhere in the file (check first — grep the file for other uses before removing the import).

Replace the call site:

```typescript
const availableSections = await loadAvailableSections(
  currentEntry.ayCode,
  levelLabel
);
```

with:

```typescript
const service = createServiceClient();
const { level, sections: availableSections } = await listAssignableSections(
  service,
  currentEntry.ayCode,
  levelLabel
);
```

(If `records-lite-page.tsx` doesn't already have a `createServiceClient()` instance in scope at this point in the file, add the import: `import { createServiceClient } from '@/lib/supabase/service';` — check first, since the file may already construct one earlier for other queries; reuse that instance rather than creating a second one if so.)

- [ ] **Step 2: Update the `UnsyncedActionCard` call site**

Replace:

```tsx
<UnsyncedActionCard
  enroleeNumber={currentEntry.enroleeNumber}
  ayCode={currentEntry.ayCode}
  levelApplied={levelLabel}
  studentName={studentName}
  availableSections={availableSections}
/>
```

with:

```tsx
<UnsyncedActionCard
  enroleeNumber={currentEntry.enroleeNumber}
  ayCode={currentEntry.ayCode}
  level={level}
  studentName={studentName}
  availableSections={availableSections}
/>
```

Update the import: `import { listAssignableSections } from '@/lib/sis/class-assignment';` alongside the existing imports.

- [ ] **Step 3: Update `UnsyncedActionCard`'s props + pass-through**

In `components/sis/unsynced-action-card.tsx`, replace:

```typescript
import {
  AssignSectionDialog,
  type AssignableSection,
} from '@/components/sis/assign-section-dialog';
```

```typescript
type Props = {
  enroleeNumber: string;
  ayCode: string;
  levelApplied: string | null;
  studentName: string;
  availableSections: AssignableSection[];
};

export function UnsyncedActionCard({
  enroleeNumber,
  ayCode,
  levelApplied,
  studentName,
  availableSections,
}: Props) {
```

with:

```typescript
import { AssignSectionDialog } from '@/components/sis/assign-section-dialog';
import type {
  AssignableLevel,
  AssignableSection,
} from '@/lib/sis/class-assignment';
```

```typescript
type Props = {
  enroleeNumber: string;
  ayCode: string;
  level: AssignableLevel | null;
  studentName: string;
  availableSections: AssignableSection[];
};

export function UnsyncedActionCard({
  enroleeNumber,
  ayCode,
  level,
  studentName,
  availableSections,
}: Props) {
```

and update the `<AssignSectionDialog>` invocation's `levelApplied={levelApplied}` prop to `level={level}`.

- [ ] **Step 2 (continued): fix the `loadSectionsForLevels` page-local helper**

`records-lite-page.tsx`'s page-level `loadSectionsForLevels(ayCode, uniqueLevels)` helper (referenced in the earlier research as pre-populating the dialog's per-level section list) needs the same treatment if it independently duplicates section-querying logic — read that function in full before editing (it wasn't captured verbatim in this plan's research) and, if it duplicates `listAssignableSections`' query, replace its body with calls to `listAssignableSections` per level instead; if it's structurally different (e.g., batches multiple levels in one query for a performance reason `listAssignableSections` doesn't need to replicate), leave it as-is and note the divergence in the commit message rather than force a merge that changes its performance characteristics.

- [ ] **Step 3: Run the build**

Run: `npx next build`
Expected: clean compile.

- [ ] **Step 4: Manual verification**

`/records/unsynced` → open "Assign to a section" on a real unsynced student → confirm the dialog shows sections with counts (unchanged from before) AND the new "Create a new section" button works inline without navigating away.

- [ ] **Step 5: Commit**

```bash
git add components/sis/records-lite-page.tsx components/sis/unsynced-action-card.tsx
git commit -m "refactor(sis): records-lite-page uses shared listAssignableSections"
```

### Task 3.5: Require a client-supplied section on the Enrolled flip

**Files:**

- Modify: `lib/schemas/sis.ts` (`StageUpdateSchema`)
- Modify: `app/api/sis/students/[enroleeNumber]/stage/[stageKey]/route.ts`
- Modify: `app/api/sis/students/[enroleeNumber]/assign-section/route.ts` (adopt the shared constant/helper — DRY cleanup, same behavior)

**Interfaces:**

- Consumes: `validateSectionChoice`, `MAX_ACTIVE_PER_SECTION` (Task 3.1).
- `StageUpdateSchema` gains optional `section_id: z.string().uuid().optional()`.

- [ ] **Step 1: Add `section_id` to the schema**

In `lib/schemas/sis.ts`, replace:

```typescript
export const StageUpdateSchema = z.object({
  status: optionalText(120),
  remarks: optionalText(4000),
  extras: z.record(z.string(), z.union([z.string(), z.null()])).optional(),
});
```

with:

```typescript
export const StageUpdateSchema = z.object({
  status: optionalText(120),
  remarks: optionalText(4000),
  extras: z.record(z.string(), z.union([z.string(), z.null()])).optional(),
  /** Registrar-chosen section id — required only when flipping the
   *  `application` stage to `Enrolled` (validated in the route, not here,
   *  since the requirement is conditional on stageKey + status). */
  section_id: z.string().uuid().optional(),
});
```

- [ ] **Step 2: Replace the auto-pick branch in the stage route**

Replace the entire "2b) Enrolled-prereq gate + auto class assignment" block in `app/api/sis/students/[enroleeNumber]/stage/[stageKey]/route.ts` (lines ~426-539, from `let classAutoAssigned = false;` through the closing `}` of the `if (stageKey === 'application' && status === 'Enrolled')` block) with:

```typescript
let classAutoAssigned = false;
if (stageKey === 'application' && status === 'Enrolled') {
  // Re-fetch the status row with every prereq column for the gate check.
  const prereqSelect = ENROLLED_PREREQ_STAGES.map(
    (k) => STAGE_COLUMN_MAP[k].statusCol
  ).join(', ');
  const { data: prereqRow, error: prereqErr } = await supabase
    .from(statusTable)
    .select(prereqSelect)
    .eq('enroleeNumber', enroleeNumber)
    .maybeSingle();
  if (prereqErr || !prereqRow) {
    console.error('[sis stage PATCH] prereq fetch failed:', prereqErr?.message);
    return NextResponse.json(
      { error: 'Prereq lookup failed' },
      { status: 500 }
    );
  }
  const prereqCurrent = prereqRow as unknown as Record<string, string | null>;
  const blockers: Array<{
    stage: string;
    current: string | null;
    expected: string;
  }> = [];
  for (const stage of ENROLLED_PREREQ_STAGES) {
    const col = STAGE_COLUMN_MAP[stage].statusCol;
    const expected = STAGE_TERMINAL_STATUS[stage]!;
    const current = prereqCurrent[col] ?? null;
    if (current !== expected) {
      blockers.push({ stage: STAGE_LABELS[stage], current, expected });
    }
  }
  if (blockers.length > 0) {
    return NextResponse.json(
      { error: 'Prerequisite stages incomplete', blockers },
      { status: 422 }
    );
  }

  // Per docs/superpowers/specs/2026-07-20-manual-section-assignment-design.md:
  // no auto-pick anywhere. The registrar must have already chosen a
  // section via the picker before this PATCH is submitted (wired into
  // EditStageDialog, Task 3.6) — section_id is a required input here,
  // not computed server-side.
  if (!parsed.data.section_id) {
    return NextResponse.json(
      { error: 'Pick a section before enrolling this student.' },
      { status: 422 }
    );
  }
  const validated = await validateSectionChoice(
    supabase,
    parsed.data.section_id,
    ayCode
  );
  if ('error' in validated) {
    return NextResponse.json(
      { error: `Cannot enroll: ${validated.error}` },
      { status: 422 }
    );
  }

  const admissionsClient = createAdmissionsClient();
  const appsTable = `${prefix}_enrolment_applications`;
  const { data: appRow, error: appErr } = await admissionsClient
    .from(appsTable)
    .select('studentNumber')
    .eq('enroleeNumber', enroleeNumber)
    .maybeSingle();
  if (appErr || !appRow) {
    console.error(
      '[sis stage PATCH] application row fetch failed:',
      appErr?.message
    );
    return NextResponse.json(
      { error: 'Cannot enroll: application row missing' },
      { status: 422 }
    );
  }
  const appLite = appRow as unknown as { studentNumber: string | null };
  if (!appLite.studentNumber) {
    return NextResponse.json(
      {
        error:
          'Cannot enroll: this applicant has no Student Number on file. Student numbers are normally generated at parent-portal submission alongside the enrolee number — contact admissions support to assign one before enrolling.',
      },
      { status: 422 }
    );
  }

  const classCols = STAGE_COLUMN_MAP.class;
  const todayIso = new Date().toISOString();
  update[classCols.statusCol] = 'Finished';
  update['classLevel'] = validated.section.levelLabel;
  update['classSection'] = validated.section.name;
  update[classCols.updatedDateCol] = todayIso;
  update[classCols.updatedByCol] = auth.user.email ?? '(unknown)';
  classAutoAssigned = true;
}
```

Note: `classAutoAssigned` is kept as the variable name deliberately — it drives downstream `shouldSync`/toast logic elsewhere in the same file that this plan doesn't otherwise touch, and renaming it would require updating every reference for no behavioral benefit. It now means "class was assigned as part of this Enrolled flip" (registrar-chosen), not "auto-picked" — the client-side toast copy is updated in Task 3.6 to stop implying automation.

- [ ] **Step 3: Update imports**

Replace `import { pickSectionForApplicant } from '@/lib/sis/class-assignment';` with `import { validateSectionChoice } from '@/lib/sis/class-assignment';`.

- [ ] **Step 4: Adopt the shared constant + validation in `assign-section` route (DRY cleanup)**

In `app/api/sis/students/[enroleeNumber]/assign-section/route.ts`, replace the local `const MAX_ACTIVE_PER_SECTION = 50;` and the "Resolve target section" block's manual capacity/AY-match logic with a call to `validateSectionChoice(service, sectionId, ayCode)` from `@/lib/sis/class-assignment`, adapting the surrounding code to use `validated.section.name`/`validated.section.levelLabel` in place of its current locally-fetched `section.name`/`targetLevelLabel`. Keep every other step (Step A/B/C/D, the resync-only branch, rollback logic) unchanged — this task only removes the duplicated validation, not the route's broader behavior.

- [ ] **Step 5: Run the build**

Run: `npx next build`
Expected: clean compile (Task 3.6 still needs to update the client that calls this route with the new `section_id` field, but the route itself is now internally consistent).

- [ ] **Step 6: Commit**

```bash
git add lib/schemas/sis.ts app/api/sis/students/\[enroleeNumber\]/stage/\[stageKey\]/route.ts app/api/sis/students/\[enroleeNumber\]/assign-section/route.ts
git commit -m "feat(sis): require a client-chosen section on the Enrolled flip, share validation with assign-section"
```

### Task 3.6: Wire the picker into `EditStageDialog` + update `enrollment-tab.tsx`

**Files:**

- Modify: `components/sis/edit-stage-dialog.tsx`
- Modify: `components/sis/enrollment-tab.tsx`
- Create: `app/api/sis/students/[enroleeNumber]/assignable-sections/route.ts`

**Interfaces:**

- Produces: `GET /api/sis/students/[enroleeNumber]/assignable-sections?ay=` → `{ level: AssignableLevel | null; sections: AssignableSection[] }`, resolving the student's current `levelApplied` server-side (mirrors how `assign-section` already resolves things from `enroleeNumber` alone — no new required prop on `EditStageDialog`).

- [ ] **Step 1: Write the new GET route**

```typescript
import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { listAssignableSections } from '@/lib/sis/class-assignment';
import { createServiceClient } from '@/lib/supabase/service';
import { createAdmissionsClient } from '@/lib/supabase/admissions';

// GET /api/sis/students/[enroleeNumber]/assignable-sections?ay=AY2026
//
// Feeds the section picker rendered inline in EditStageDialog when a
// registrar is about to flip the application stage to Enrolled. Resolves
// the applicant's current levelApplied server-side so the client only
// needs enroleeNumber + ay, matching the same lookup shape as
// assign-section's existing route.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ enroleeNumber: string }> }
) {
  const auth = await requireRole(['admissions', 'registrar', 'superadmin']);
  if ('error' in auth) return auth.error;

  const { enroleeNumber } = await params;
  const url = new URL(request.url);
  const ayCode = (url.searchParams.get('ay') ?? '').trim();
  if (!/^AY\d{4}$/i.test(ayCode)) {
    return NextResponse.json(
      { error: 'Invalid or missing ay query param' },
      { status: 400 }
    );
  }

  const admissions = createAdmissionsClient();
  const prefix = `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
  const { data: appRow, error: appErr } = await admissions
    .from(`${prefix}_enrolment_applications`)
    .select('levelApplied')
    .eq('enroleeNumber', enroleeNumber)
    .maybeSingle();
  if (appErr) {
    return NextResponse.json({ error: appErr.message }, { status: 500 });
  }
  const levelApplied =
    (appRow as { levelApplied: string | null } | null)?.levelApplied ?? null;

  const service = createServiceClient();
  const result = await listAssignableSections(service, ayCode, levelApplied);
  return NextResponse.json(result);
}
```

- [ ] **Step 2: Wire the picker into `EditStageDialog`**

Add the imports to `components/sis/edit-stage-dialog.tsx`:

```typescript
import { useQuery } from '@tanstack/react-query';
```

Render the picker **inline within the existing form**, not as a nested dialog (this codebase's convention avoids nesting `Dialog`s — `AssignSectionDialog` is itself a full dialog with its own open/close state, not the right shape to embed here). Add state + the query right after the existing `prereqRows`/`incompleteCount` derivation:

```typescript
const requiresSectionPick =
  stageKey === 'application' &&
  effectiveStatus === 'Enrolled' &&
  incompleteCount === 0;

const [sectionId, setSectionId] = useState<string | null>(null);

const sectionsQuery = useQuery({
  queryKey: ['assignable-sections', enroleeNumber, ayCode],
  queryFn: () =>
    apiFetch<{
      level: {
        id: string;
        code: string;
        label: string;
        levelType: 'primary' | 'secondary';
      } | null;
      sections: { id: string; name: string; activeCount: number }[];
    }>(
      `/api/sis/students/${encodeURIComponent(enroleeNumber)}/assignable-sections?ay=${encodeURIComponent(ayCode)}`
    ),
  enabled: requiresSectionPick,
});

useEffect(() => {
  if (!requiresSectionPick) setSectionId(null);
}, [requiresSectionPick]);
```

- [ ] **Step 3: Render the inline picker + gate submit on it**

Add, immediately after the existing `showPrereqChecklist && (...)` block (before the `<FormItem>` for Status), a new block:

```tsx
{
  requiresSectionPick && (
    <div className="space-y-2.5 rounded-md border border-hairline bg-muted/30 p-3">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Pick a section
      </p>
      {sectionsQuery.isLoading ? (
        <p className="text-xs text-muted-foreground">Loading sections…</p>
      ) : !sectionsQuery.data?.level ? (
        <p className="text-xs text-destructive">
          This applicant&apos;s level name doesn&apos;t match a known level yet
          — resolve it at{' '}
          <span className="font-mono">/records/level-mismatches</span> before
          enrolling.
        </p>
      ) : sectionsQuery.data.sections.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No sections exist yet for {sectionsQuery.data.level.label}.
        </p>
      ) : (
        <div className="space-y-1.5">
          {[...sectionsQuery.data.sections]
            .sort((a, b) => a.activeCount - b.activeCount)
            .map((s) => {
              const full = s.activeCount >= 50;
              return (
                <button
                  key={s.id}
                  type="button"
                  disabled={full}
                  onClick={() => setSectionId(s.id)}
                  aria-pressed={sectionId === s.id}
                  className={
                    'flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition-colors ' +
                    (sectionId === s.id
                      ? 'border-brand-indigo bg-accent'
                      : full
                        ? 'cursor-not-allowed border-border/60 bg-muted/30 opacity-60'
                        : 'border-border hover:bg-accent/40')
                  }
                >
                  <span className="font-medium text-foreground">{s.name}</span>
                  <span className="font-mono tabular-nums text-muted-foreground">
                    {s.activeCount}/50{full ? ' · Full' : ''}
                  </span>
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}
```

Add `apiFetch` to the existing `@/lib/query/fetcher` import (it's already imported for `jsonInit`/`ApiError` — just add `apiFetch` if not already present; check the current import line first since it may already include it via the mutation setup).

- [ ] **Step 4: Include `section_id` in the submit payload + gate the Save button**

Update `onSubmit`:

```typescript
async function onSubmit(values: StageUpdateInput) {
  if (frozen) return;
  if (requiresSectionPick && !sectionId) return;
  const extrasPayload = {
    ...values.extras,
    ...(stageKey === 'application' &&
      isTerminalStatus && {
        terminalReason: terminalReason || undefined,
        terminalNotes: terminalNotes.trim() || undefined,
      }),
  };
  await saveMutation
    .mutateAsync({
      ...values,
      extras: extrasPayload,
      ...(requiresSectionPick && sectionId ? { section_id: sectionId } : {}),
    })
    .catch(() => {});
}
```

Update the Save button's `disabled` expression:

```tsx
                  <Button
                    type="submit"
                    size="sm"
                    disabled={
                      busy ||
                      (requiresSectionPick && !sectionId) ||
                      (stageKey === 'application' &&
                        isTerminalStatus &&
                        (!terminalReason ||
                          (terminalReason === 'other' &&
                            !terminalNotes.trim())))
                    }
                  >
```

- [ ] **Step 5: Update the success toast copy**

In the `saveMutation`'s `onSuccess`, replace the `classAutoAssigned` branches' copy (which currently says "auto-assigned") since the assignment is now registrar-chosen:

```typescript
      } else if (autoSyncFailed) {
        toast.warning(
          classAutoAssigned
            ? 'Enrolled · section assigned, but roster sync was skipped'
            : 'Enrolled (Conditional) · section roster sync was skipped',
          {
            description:
              autoSync?.reason ??
              autoSync?.error ??
              'Check /records/unsynced to assign a section and complete the sync.',
          }
        );
      } else if (classAutoAssigned) {
        toast.success('Enrolled · section assigned · synced to roster');
```

(Replaces the two lines containing "auto-assigned" — every other branch in that block is unchanged.)

- [ ] **Step 6: Stop hiding `EditStageDialog` for the `class` stage in `enrollment-tab.tsx`**

In `components/sis/enrollment-tab.tsx`, the `autoManaged` treatment stays conceptually correct — the class stage still shouldn't have its own independent Edit button, since it's now set as part of the `application` stage's Enrolled flip (Task 3.5/3.6), not edited standalone. **No change needed here** — verify this by re-reading the `autoManaged` block's copy ("Class assignment is auto-populated by pickSectionForApplicant when applicationStatus flips to Enrolled") and update only the comment + the "Auto" badge label if it still reads as misleading:

Replace:

```typescript
// Class assignment is auto-populated by pickSectionForApplicant when
// applicationStatus flips to Enrolled. Post-Enrolled changes route
// through the dedicated section-transfer endpoint (KD #67), not the
// stage edit dialog. Hide the edit button here and label as auto.
const autoManaged = stage.key === 'class';
```

with:

```typescript
// Class assignment is set as part of the application stage's Enrolled
// flip (the registrar picks a section inline in that dialog, Task 3.6) —
// it has no independent edit control of its own. Post-Enrolled changes
// route through the dedicated section-transfer endpoint (KD #67), not
// here. Hide the edit button and label as tied-to-enrollment.
const autoManaged = stage.key === 'class';
```

and the badge:

```tsx
        {autoManaged ? (
          <Badge variant="muted" className="shrink-0 gap-1">
            <Sparkles className="size-3" />
            Auto
          </Badge>
        ) : (
```

to:

```tsx
        {autoManaged ? (
          <Badge variant="muted" className="shrink-0 gap-1">
            Set via Enrolled
          </Badge>
        ) : (
```

(`Sparkles` import may become unused after this — check the rest of the file before removing the import.)

Also update the sibling copy a few lines down:

```tsx
      ) : autoManaged ? (
        <span className="pl-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Auto-assigned when Enrolled
        </span>
```

to:

```tsx
      ) : autoManaged ? (
        <span className="pl-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Set when Enrolled
        </span>
```

- [ ] **Step 7: Run the build**

Run: `npx next build`
Expected: clean compile.

- [ ] **Step 8: Commit**

```bash
git add components/sis/edit-stage-dialog.tsx components/sis/enrollment-tab.tsx app/api/sis/students/\[enroleeNumber\]/assignable-sections/route.ts
git commit -m "feat(sis): wire manual section picker into the Enrolled-flip dialog"
```

### Phase 3 gate (final for Phases 1-3 — see Phase 4 below for the independent branch)

- [ ] `npm run test` (full suite) passes.
- [ ] `npx next build` compiles clean.
- [ ] Manual E2E across all three mount points:
  1. **Enrolled-flip**: open an eligible applicant's Application stage editor, pick "Enrolled" — confirm the section picker appears inline, Save is disabled until a section is chosen, and submitting writes `classSection`/`classLevel` correctly and syncs to the roster.
  2. **Unsynced recovery**: `/records/unsynced` → "Assign to a section" still works, including the new inline "Create a new section" button.
  3. **Post-alias resolution**: after Phase 2's queue resolves a previously-unmatched level, confirm that student's application now shows real sections (not an error) when attempting the Enrolled flip.
- [ ] Confirm no remaining references to the deleted `pickSectionForApplicant`/`scoreSection`/`ClassAssignment`/`ClassAssignmentError` exports anywhere in the codebase (`rg "pickSectionForApplicant|scoreSection|ClassAssignmentError" --type ts --type tsx`).
- [ ] Confirm the three previously-independent copies of the 50-cap constant are down to one (`rg "MAX_ACTIVE_PER_SECTION|MAX_PER_SECTION" --type ts --type tsx` — every hit should import from `lib/sis/class-assignment`, none should redeclare it).

---

## Phase 4 — Remove Structure Defaults (template)

Implements `docs/superpowers/specs/2026-07-20-remove-structure-defaults-template-design.md`. **Independent of Phases 1-3** in scope and ordering — no shared files, no dependency in either direction — but implemented on the **same branch** as Phases 1-3 (updated from an earlier separate-branch instruction). This phase can still be started, gated, and committed on its own schedule within that branch; it just doesn't need its own PR.

### Task 4.1: Migration — delete the template layer, make copy-forward unconditional, add confirm columns

**Files:**

- Create: `supabase/migrations/089_remove_structure_defaults_template.sql`

**Interfaces:**

- Drops: `public.template_sections`, `public.template_subject_configs`, `public.template_subject_level_offerings`, `public.apply_template_to_ay(text)`.
- Produces: `public.academic_years.structure_confirmed_at timestamptz null`, `public.academic_years.structure_confirmed_by uuid null`; a re-emitted `public.create_academic_year(text, text)` with the template branch removed and the "most recent non-test AY" copy source made unconditional.

- [ ] **Step 1: Write the migration**

```sql
-- 089_remove_structure_defaults_template.sql
--
-- Removes the Structure Defaults (template) layer entirely. Verified
-- during design: create_academic_year (migration 080) already contains
-- the exact copy-forward mechanism this replaces it with, as a DORMANT
-- fallback — "Legacy fallback: most recent non-test AY (preserves
-- migration 030's behaviour for empty-template installs)" — gated on
-- v_use_template = false. It only activates today when the template
-- tables happen to be empty. This migration makes that fallback the ONLY
-- path: a new AY's sections/subject_configs/subject_level_offerings are
-- always copied from the most recently created non-test AY, unconditionally.
--
-- Adds the one genuinely new piece: an explicit, audit-logged confirmation
-- gate (structure_confirmed_at/by on academic_years) so a registrar must
-- acknowledge the carried-forward starting setup before the AY-readiness
-- checklist counts it done.
--
-- Idempotent + safe to re-run (DROP ... IF EXISTS, ADD COLUMN IF NOT
-- EXISTS, CREATE OR REPLACE). Apply on its own branch/timeline — no
-- ordering dependency on migrations 087/088.

-- =====================================================================
-- 1. Confirmation-gate columns.
-- =====================================================================

alter table public.academic_years
  add column if not exists structure_confirmed_at timestamptz null,
  add column if not exists structure_confirmed_by uuid null references auth.users(id);

comment on column public.academic_years.structure_confirmed_at is
  'When a registrar confirmed this AY''s carried-forward starting sections/subjects/weights. Null = not yet confirmed. See docs/superpowers/specs/2026-07-20-remove-structure-defaults-template-design.md.';

-- =====================================================================
-- 2. Drop the template layer.
-- =====================================================================

drop function if exists public.apply_template_to_ay(text);
drop table if exists public.template_subject_level_offerings;
drop table if exists public.template_subject_configs;
drop table if exists public.template_sections;

-- =====================================================================
-- 3. Re-emit create_academic_year — migration 086 body (the newest live
--    definition as of this migration's authoring, KD #119 hazard —
--    corrected during Phase 4 execution from an earlier draft of this
--    migration that mistakenly assumed migration 080 was newest; 086
--    (applied before this plan was written) already re-emitted the
--    function to drop step "4b" (the ay_level_offerings insert — that
--    table no longer exists, dropped by 086 alongside the volatile-level
--    catalog, KD #153's SUPERSEDED note) and to drop the
--    v_template_sections_count/v_template_configs_count/v_use_template
--    decision variables' *table existence*, though 086 itself still had
--    the v_use_template branch logic — THIS migration is what finally
--    removes that decision + every "if v_use_template ... elsif
--    v_source_ay_id ..." template branch, making the v_source_ay_id
--    ("most recent non-test AY") resolution unconditional. Every other
--    step (terms, sync_section_subjects_for_ay, admissions DDL, return
--    shape) is byte-identical to 086.
-- =====================================================================

create or replace function public.create_academic_year(
  p_ay_code text,
  p_label   text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code             text := upper(trim(p_ay_code));
  v_label            text := trim(p_label);
  v_slug             text;
  v_ay_id            uuid;
  v_existing_ay_id   uuid;
  v_existed          boolean;
  v_source_ay_id     uuid;
  v_terms_inserted   int := 0;
  v_sections_copied  int := 0;
  v_configs_copied   int := 0;
  v_source           text := null;
begin
  if v_code !~ '^AY[0-9]{4}$' then
    raise exception 'Invalid AY code: %. Expected format AY2027.', p_ay_code;
  end if;
  if v_label is null or v_label = '' then
    raise exception 'AY label is required.';
  end if;

  v_slug := 'ay' || substring(v_code from 3);

  -- 1. academic_years — reuse if present, otherwise insert.
  select id into v_existing_ay_id
  from public.academic_years
  where ay_code = v_code;

  if v_existing_ay_id is not null then
    v_ay_id   := v_existing_ay_id;
    v_existed := true;
  else
    insert into public.academic_years (ay_code, label, is_current)
    values (v_code, v_label, false)
    returning id into v_ay_id;
    v_existed := false;
  end if;

  -- 2. terms (T1–T4) — insert only the missing term_numbers.
  insert into public.terms (academic_year_id, term_number, label, is_current)
  select v_ay_id, n, 'Term ' || n || ' — ' || v_code, false
  from generate_series(1, 4) as g(n)
  where not exists (
    select 1 from public.terms
    where academic_year_id = v_ay_id and term_number = n
  );
  get diagnostics v_terms_inserted = row_count;

  -- 3. Resolve copy source: most recent non-test AY. Unconditional —
  --    Structure Defaults / template removed, this is now the only path
  --    (previously a fallback only reached when the template was empty).
  select id into v_source_ay_id
  from public.academic_years
  where id <> v_ay_id
    and ay_code !~ '^AY9'
  order by ay_code desc
  limit 1;

  -- 4. sections — copied from the source AY when one exists. Empty when
  --    none (bootstrap case — acceptable, effectively unreachable for
  --    HFSE now that AY2025/2026/2027 already exist).
  if not exists (select 1 from public.sections where academic_year_id = v_ay_id) then
    if v_source_ay_id is not null then
      insert into public.sections (academic_year_id, level_id, name, class_type, schedule, form_class_adviser)
      select v_ay_id, level_id, name, class_type, schedule, null
      from public.sections
      where academic_year_id = v_source_ay_id;
      get diagnostics v_sections_copied = row_count;
      select ay_code into v_source
      from public.academic_years
      where id = v_source_ay_id;
    end if;
  end if;

  -- (No 4b: the ay_level_offerings insert that used to live here was
  --  already removed by migration 086, which dropped the table entirely
  --  — KD #153's SUPERSEDED note. Nothing to re-emit.)

  -- 5. subject_configs (weights, one row per subject) + subject_level_
  --    offerings (which subjects apply to which levels this AY) — copied
  --    from the source AY when one exists.
  if not exists (select 1 from public.subject_configs where academic_year_id = v_ay_id) then
    if v_source_ay_id is not null then
      insert into public.subject_configs (
        academic_year_id, subject_id,
        ww_weight, pt_weight, qa_weight,
        ww_max_slots, pt_max_slots, qa_max
      )
      select v_ay_id, subject_id,
             ww_weight, pt_weight, qa_weight,
             ww_max_slots, pt_max_slots, qa_max
      from public.subject_configs
      where academic_year_id = v_source_ay_id;
      get diagnostics v_configs_copied = row_count;
      if v_source is null then
        select ay_code into v_source
        from public.academic_years
        where id = v_source_ay_id;
      end if;

      insert into public.subject_level_offerings (academic_year_id, subject_id, level_id)
      select v_ay_id, subject_id, level_id
      from public.subject_level_offerings
      where academic_year_id = v_source_ay_id
      on conflict (subject_id, level_id, academic_year_id) do nothing;
    end if;
  end if;

  -- 5b. Section-subjects defaults — branch-agnostic, resolves via
  --     subject_level_offerings (migration 086 body).
  perform public.sync_section_subjects_for_ay(v_code);

  -- 6. Admissions DDL — already idempotent.
  perform public.create_ay_admissions_tables(v_slug);

  return jsonb_build_object(
    'ay_id',                  v_ay_id,
    'ay_code',                v_code,
    'ay_slug',                v_slug,
    'ay_existed',              v_existed,
    'terms_inserted',         v_terms_inserted,
    'sections_copied',        v_sections_copied,
    'subject_configs_copied', v_configs_copied,
    'source',                 v_source,
    'tables_created', jsonb_build_array(
      v_slug || '_enrolment_applications',
      v_slug || '_enrolment_status',
      v_slug || '_enrolment_documents',
      v_slug || '_discount_codes'
    )
  );
end;
$$;

revoke all on function public.create_academic_year(text, text) from public;
grant execute on function public.create_academic_year(text, text) to service_role;
```

- [ ] **Step 2: Apply the migration to the Supabase project**

Apply via the Supabase SQL editor/CLI. No ordering dependency on migrations 087/088 (Phases 1-2) — this can be applied independently, on this phase's own branch/timeline.

- [ ] **Step 3: Verify the template tables + function are gone, columns exist**

```sql
select table_name from information_schema.tables
where table_schema = 'public'
  and table_name in ('template_sections', 'template_subject_configs', 'template_subject_level_offerings');
-- Expect: 0 rows.

select routine_name from information_schema.routines
where routine_schema = 'public' and routine_name = 'apply_template_to_ay';
-- Expect: 0 rows.

select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'academic_years'
  and column_name in ('structure_confirmed_at', 'structure_confirmed_by');
-- Expect: 2 rows.
```

- [ ] **Step 4: Functional check — copy-forward on a real test AY**

Create a throwaway test AY (`ay_code` matching `^AY9`, e.g. via the existing "Switch to Test" flow or a direct `select public.create_academic_year('AY9998', 'Test 9998');` if AY9998 doesn't already exist as the environment's standing test AY — pick an unused `AY9xxx` code to avoid colliding with it) and confirm:

```sql
-- Before: note the current AY's section/config counts to compare against.
select count(*) from public.sections where academic_year_id = (select id from public.academic_years where ay_code = 'AY2026');
select count(*) from public.subject_configs where academic_year_id = (select id from public.academic_years where ay_code = 'AY2026');

-- After creating the test AY, confirm it copied from the most recent
-- non-test AY (should be AY2026 or AY2027 if AY2027 exists and is newer):
select sections_copied, subject_configs_copied, source
from (select public.create_academic_year('AY9998', 'Test copy-forward check')) x;
```

Expected: `sections_copied`/`subject_configs_copied` roughly match the source AY's counts (allowing for any sections/configs that pre-existed on the target if it wasn't brand new), and `source` names the correct AY code.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/089_remove_structure_defaults_template.sql
git commit -m "feat(sis): remove Structure Defaults template, make AY copy-forward unconditional"
```

### Task 4.2: Confirm-structure route + audit action

**Files:**

- Create: `app/api/sis/ay-setup/confirm-structure/route.ts`
- Modify: `lib/audit/log-action.ts` (AuditAction union)
- Modify: `lib/audit/humanize.ts` (label map)

**Interfaces:**

- Produces: `POST /api/sis/ay-setup/confirm-structure` → `{ ok: true, confirmedAt: string }` or `{ error: string }`. Sets `academic_years.structure_confirmed_at`/`structure_confirmed_by`.

- [ ] **Step 1: Add the audit action**

In `lib/audit/log-action.ts`, add a new union member (near other `ay.*` actions if a cluster exists — otherwise anywhere in the union):

```typescript
  | 'ay.structure.confirm'
```

- [ ] **Step 2: Add the humanized label**

In `lib/audit/humanize.ts`:

```typescript
  'ay.structure.confirm': 'AY starting setup confirmed',
```

- [ ] **Step 3: Write the route**

Role gate mirrors the visibility rule already established for the AY-readiness pill (KD #109: "visible to `school_admin | superadmin` only") — this action gates that same checklist, so the same two roles.

```typescript
import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { logAction } from '@/lib/audit/log-action';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/sis/ay-setup/confirm-structure
// Body: { ay_code: string }
//
// Registrar-facing confirmation that a new AY's carried-forward starting
// sections/subjects/weights (auto-copied from the most recent prior AY by
// create_academic_year, migration 089) have been reviewed. Idempotent —
// re-confirming after making adjustments just updates the timestamp/actor
// and logs again; not an error. See
// docs/superpowers/specs/2026-07-20-remove-structure-defaults-template-design.md.
export async function POST(request: Request) {
  const auth = await requireRole(['school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const ayCode = (body?.ay_code ?? '').trim();
  if (!/^AY\d{4}$/i.test(ayCode)) {
    return NextResponse.json(
      { error: 'Invalid or missing ay_code' },
      { status: 400 }
    );
  }

  const service = createServiceClient();
  const nowIso = new Date().toISOString();

  const { data: ayRow, error: ayErr } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode.toUpperCase())
    .maybeSingle();
  if (ayErr || !ayRow) {
    return NextResponse.json(
      { error: 'Academic year not found' },
      { status: 404 }
    );
  }
  const ayId = (ayRow as { id: string }).id;

  const [{ count: sectionsCount }, { count: configsCount }] = await Promise.all(
    [
      service
        .from('sections')
        .select('*', { count: 'exact', head: true })
        .eq('academic_year_id', ayId),
      service
        .from('subject_configs')
        .select('*', { count: 'exact', head: true })
        .eq('academic_year_id', ayId),
    ]
  );

  const { error: updateErr } = await service
    .from('academic_years')
    .update({
      structure_confirmed_at: nowIso,
      structure_confirmed_by: auth.user.id,
    })
    .eq('id', ayId);
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'ay.structure.confirm',
    entityType: 'academic_year',
    entityId: ayId,
    context: {
      ay_code: ayCode.toUpperCase(),
      sections_count: sectionsCount ?? 0,
      subject_configs_count: configsCount ?? 0,
    },
  });

  return NextResponse.json({ ok: true, confirmedAt: nowIso });
}
```

- [ ] **Step 4: Manual verification**

`POST` against a real AY code with a `school_admin`/`superadmin` session, confirm `academic_years.structure_confirmed_at`/`structure_confirmed_by` are set, and confirm an `ay.structure.confirm` row appears in the audit log with the right counts.

- [ ] **Step 5: Run the build**

Run: `npx next build`
Expected: clean compile.

- [ ] **Step 6: Commit**

```bash
git add app/api/sis/ay-setup/confirm-structure/route.ts lib/audit/log-action.ts lib/audit/humanize.ts
git commit -m "feat(sis): add AY starting-setup confirmation route"
```

### Task 4.3: Readiness checklist — new `structure-confirmed` step

**Files:**

- Modify: `lib/sis/readiness.ts`
- Modify: `components/sis/year-setup-checklist.tsx` (or wherever `year-setup-checklist.tsx` actually lives — verify path first; referenced by KD #109's 2026-07-08 update as the checklist-dashboard component)

**Interfaces:**

- `ReadinessStepId` gains `'structure-confirmed'`.
- Produces: `resolveStructureConfirmedStep(input: { confirmedAt: string | null }): ReadinessStep`.

- [ ] **Step 1: Extend `ReadinessStepId` + `STEP_META`**

In `lib/sis/readiness.ts`, replace:

```typescript
export type ReadinessStepId =
  | 'ay-setup'
  | 'calendar'
  | 'sections'
  | 'subject-weights'
  | 'advisers'
  | 'section-subjects'
  | 'grading-sheets'
  | 'virtue-themes'
  | 'letterhead'
  | 'app-window';
```

with:

```typescript
export type ReadinessStepId =
  | 'ay-setup'
  | 'calendar'
  | 'structure-confirmed'
  | 'sections'
  | 'subject-weights'
  | 'advisers'
  | 'section-subjects'
  | 'grading-sheets'
  | 'virtue-themes'
  | 'letterhead'
  | 'app-window';
```

In `STEP_META`, insert a new entry between `calendar` and `sections` (renumbering the `step` field for every entry from `sections` onward by +1, since `step` is a display-order integer):

```typescript
  'structure-confirmed': {
    id: 'structure-confirmed',
    step: 3,
    label: 'Confirm starting setup',
    description:
      'Review the sections, subjects, and weights carried forward from last year, then confirm',
    href: '/sis/ay-setup',
    required: true,
  },
```

Bump `sections.step` from `3` to `4`, `subject-weights.step` from `4` to `5`, `advisers.step` from `5` to `6`, `section-subjects.step` from `6` to `7`, `grading-sheets.step` from `7` to `8`, `virtue-themes.step` from `8` to `9`, `letterhead.step` from `9` to `10`, `app-window.step` from `10` to `11`.

- [ ] **Step 2: Write the resolver**

Add alongside `resolveSectionsStep` (mirrors the existing pure-resolver pattern exactly — no fraction needed, this is a plain done/not_started boolean):

```typescript
export function resolveStructureConfirmedStep(input: {
  confirmedAt: string | null;
}): ReadinessStep {
  return {
    ...STEP_META['structure-confirmed'],
    status: input.confirmedAt ? 'done' : 'not_started',
  };
}
```

- [ ] **Step 3: Wire it into the aggregating function**

Find where `resolveSectionsStep`/`resolveCalendarStep` etc. are called and composed into the final `AyReadiness.steps` array (the aggregator function — verify its exact name/location first, it wasn't captured verbatim during this plan's research). Add a call to `resolveStructureConfirmedStep({ confirmedAt: academicYearRow.structure_confirmed_at })` in the steps array, positioned between the calendar and sections steps to match `STEP_META`'s order — the aggregator will need `structure_confirmed_at` added to whatever `academic_years` select it already does to build the other steps' inputs.

- [ ] **Step 4: Surface the "Confirm" action on the checklist UI**

Verify the exact file (`year-setup-checklist.tsx`'s real path — check `app/(sis)/sis/ay-setup/` for the actual component tree before editing) and add a "Confirm" button on the `structure-confirmed` row when `status !== 'done'`, calling `POST /api/sis/ay-setup/confirm-structure` with `{ ay_code: currentAyCode }` via the same `useMutation`/`apiFetch` pattern every other action button on that page already uses — mirror an existing row's action button code exactly rather than inventing a new interaction pattern.

- [ ] **Step 5: Run the build**

Run: `npx next build`
Expected: clean compile.

- [ ] **Step 6: Manual verification**

`/sis/ay-setup` → confirm the new "Confirm starting setup" row appears in the right position, shows not-done for an unconfirmed AY, and flips to done after clicking Confirm (page refresh or optimistic update, matching the existing rows' behavior).

- [ ] **Step 7: Commit**

```bash
git add lib/sis/readiness.ts components/sis/year-setup-checklist.tsx
git commit -m "feat(sis): add structure-confirmed AY readiness step"
```

### Task 4.4: Delete the template UI/routes/lib files

**Files:**

- Delete: `app/(sis)/sis/admin/template/` (page + client component)
- Delete: `app/api/sis/admin/template/sections/`, `app/api/sis/admin/template/subject-configs/`, `app/api/sis/admin/template/subject-level-offerings/`, `app/api/sis/admin/template/diff/`, `app/api/sis/admin/template/apply/`
- Delete: `lib/sis/template/queries.ts`, `lib/sis/template-diff.ts`
- Delete: `__tests__/sis/template-diff.test.ts`, `__tests__/sis/template-diff-route.test.ts`
- Modify: `lib/auth/roles.ts` (remove the "Structure Defaults" nav entry + its `ROUTE_ACCESS` row)
- Modify: `lib/sis/seeder/structural.ts` (comment-only fix)

- [ ] **Step 1: Grep sweep before deleting**

Run: `rg "template_sections|template_subject_configs|template_subject_level_offerings|apply_template_to_ay" --type ts --type tsx -l`
Expected: only hits inside the files listed for deletion above, plus the comment-only reference in `lib/sis/seeder/structural.ts` (Step 4 below) and possibly `lib/sis/subject-config-gaps.ts` — read that file's actual reference before deciding whether it's functional (needs a real fix) or comment-only (no functional change needed) before proceeding; do not delete anything this grep flags without confirming which category it falls into.

- [ ] **Step 2: Delete the files**

```bash
git rm -r app/\(sis\)/sis/admin/template
git rm -r app/api/sis/admin/template
git rm lib/sis/template/queries.ts lib/sis/template-diff.ts
git rm __tests__/sis/template-diff.test.ts __tests__/sis/template-diff-route.test.ts
```

- [ ] **Step 3: Remove the nav entry + route access row**

In `lib/auth/roles.ts`, remove the "Structure Defaults" (or "Class Template" — verify the exact current label per KD #154's rename) entry from the SIS Admin nav array, and remove its corresponding `ROUTE_ACCESS` row for `/sis/admin/template`.

- [ ] **Step 4: Fix the stale seeder comment**

In `lib/sis/seeder/structural.ts`, around lines 245-256, the comment references `template_sections` as historical context for why `sync_section_subjects_for_ay` is re-run defensively. Verified during design: this file does not actually query any template table — its own section upsert (step 3) is a raw insert unrelated to `create_academic_year`'s (now-removed) template branch. Update the comment to remove the now-inaccurate reference:

Replace:

```typescript
// ---- 4b. section_subjects sync ----
// `create_academic_year` already syncs section_subjects for whatever
// sections it creates from the template — but this seeder's own section
// upsert above (step 3) is a raw upsert straight into `sections`, not
// routed through that RPC, so it isn't guaranteed to be covered (e.g. if
// this file's SECTIONS fixture ever diverges from template_sections).
```

with:

```typescript
// ---- 4b. section_subjects sync ----
// `create_academic_year` already syncs section_subjects for whatever
// sections it copies forward from the prior AY (migration 089) — but
// this seeder's own section upsert above (step 3) is a raw upsert
// straight into `sections`, not routed through that RPC, so it isn't
// guaranteed to be covered (e.g. if this file's SECTIONS fixture ever
// diverges from what a real prior AY would have had).
```

- [ ] **Step 5: Run the build + full test suite**

Run: `npx next build && npm run test`
Expected: clean compile, no failures from the deleted files (the two deleted template-diff test files should simply no longer be collected — confirm the test runner doesn't error on their absence).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(sis): delete Structure Defaults template UI/routes/lib files"
```

### Phase 4 gate

- [ ] `npm run test` (full suite) passes.
- [ ] `npx next build` compiles clean.
- [ ] Manual verification: `/sis/admin/template` 404s (route fully removed); `/sis/ay-setup` no longer shows a "Structure Defaults" nav entry anywhere.
- [ ] Manual verification: creating a new test AY copies sections/subjects/weights from the most recent real AY (Task 4.1 Step 4's check), the new "Confirm starting setup" readiness step shows not-done, and clicking Confirm flips it to done with a correct audit-log entry.
- [ ] Confirm no remaining references to the deleted template tables/function anywhere in the codebase (re-run Task 4.4 Step 1's grep — should now return zero results).

---

## Self-Review Notes

- **Spec coverage:** Phase 1 covers the trigger + the KD #119-class regression fix + demo-account cleanup (already-written plan, referenced). Phase 2 covers level-alias reconciliation end to end. Phase 3 covers the manual section-assignment consolidation end to end, including the DRY cleanup of the three independent 50-cap constants the research surfaced. Phase 4 covers the Structure Defaults removal end to end, including the confirmation gate and readiness-checklist integration. No open item from the conversation is unaddressed.
- **Deploy ordering:** within Phase 1 (Task 2 after Task 1's migration), within Phase 2 (Task 2.3/2.4 after Task 2.1's migration), within Phase 3 (the deliberate build-broken window in Task 3.1, resolved by Task 3.6), and within Phase 4 (Task 4.2/4.3 after Task 4.1's migration + columns). No cross-phase ordering exists except 2→3 (Phase 2 makes level resolution correct before Phase 3 deletes the auto-pick that used it) — Phase 4 has no dependency on any other phase in either direction.
- **Placeholder scan:** the only bracketed placeholders are inside manual SQL/verification steps that inherently require live data or a still-to-be-confirmed exact file path (Task 2.5 Step 6's page imports, Task 3.4's `loadSectionsForLevels` helper, Task 4.3's aggregator function name and checklist component path) — each is explicitly flagged as "verify against the real file before finalizing" rather than presented as a deliverable to blindly copy, consistent with how this plan has handled every such case throughout.
