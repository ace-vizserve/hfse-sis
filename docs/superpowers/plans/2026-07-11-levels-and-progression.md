# Levels & Grade Progression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make grade levels a first-class managed entity — sort order, `next_level_id` progression chain, core-vs-volatile with per-AY offerings — with a Grade Levels admin page, demand signals from `levelApplied`, and a Bearer-gated portal endpoint.

**Architecture:** One migration (078) extends the global `levels` table + adds `ay_level_offerings`; a cached DB-backed loader supersedes the hardcoded tuple for dynamic consumers; admin CRUD routes mirror the Subjects catalog; the portal route mirrors `app/api/parent/v2/students`. Spec: `docs/superpowers/specs/2026-07-11-levels-and-progression-design.md` (binding).

**Tech Stack:** Next.js 16 RSC + route handlers, Supabase (SQL migration + service client + `unstable_cache`), zod, Vitest.

## Global Constraints

- Design system Hard Rule #7: tokens only; icon+text never color-only; plain-English copy (spec: mental model stated on-page).
- Core levels = exactly P1–P6, S1–S4 (`is_core=true`): never deletable, never deactivatable, always offered. Volatile = YS-L/J/S, CS1, CS2 + future user-created.
- Progression is config-only: `next_level_id` never mutates enrollment anywhere.
- Weight defaults: primary `40/40/20`, secondary `30/50/20` — single source `lib/sis/level-profiles.ts` after Task 3.
- `levelApplied` intake storage/validation unchanged.
- KD #119 discipline: `create_academic_year` re-emitted from its NEWEST live body (`supabase/migrations/074_section_schedule.sql`), never an older copy.
- Every mutation route: `requireRole(['school_admin','superadmin'])`, zod `safeParse`, `logAction`, `revalidateTag('levels', 'max')`.
- Commits: conventional message + footer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Run the focused test while iterating; full `npx vitest run` + `npx tsc --noEmit` once before each phase-end check. `npx next build` only at phase 3/4 checks.
- Phase gates: do not start a phase until the prior phase's check passed (tests + task review).

---

## PHASE 1 — Schema + seed

### Task 1: Migration 078 — levels columns, offerings table, chain seed, RPC re-emit

**Files:**

- Create: `supabase/migrations/078_levels_progression.sql`
- Reference (read, do not modify): `supabase/migrations/074_section_schedule.sql` (newest `create_academic_year` body), `supabase/migrations/029_levels_to_words.sql`, `lib/sis/levels.ts` (LEVEL_CODES order)

**Interfaces:**

- Produces: `levels.sort_order smallint NOT NULL`, `levels.next_level_id uuid NULL`, `levels.is_core boolean NOT NULL`, table `ay_level_offerings(academic_year_id, level_id)`; `create_academic_year` copies source-AY volatile offerings.

- [ ] **Step 1: Write the migration**

```sql
-- 078_levels_progression.sql
-- Levels become a managed entity: display order, progression pointer,
-- core-vs-volatile, and per-AY offerings for volatile levels.
-- Spec: docs/superpowers/specs/2026-07-11-levels-and-progression-design.md

begin;

alter table public.levels add column if not exists sort_order smallint;
alter table public.levels add column if not exists next_level_id uuid references public.levels(id) on delete set null;
alter table public.levels add column if not exists is_core boolean not null default false;

-- Backfill sort_order in the canonical display order (mirrors lib/sis/levels.ts LEVEL_CODES).
with ordered(code, ord) as (
  values ('YS-L',1),('YS-J',2),('YS-S',3),
         ('P1',4),('P2',5),('P3',6),('P4',7),('P5',8),('P6',9),
         ('S1',10),('S2',11),('S3',12),('S4',13),
         ('CS1',14),('CS2',15)
)
update public.levels l set sort_order = o.ord from ordered o where l.code = o.code;
-- Any level not in the canonical list (none expected) sorts last.
update public.levels set sort_order = 99 where sort_order is null;
alter table public.levels alter column sort_order set not null;

-- Core = P1-P6, S1-S4 (permanent; never deactivated/deleted; always offered).
update public.levels set is_core = true
where code in ('P1','P2','P3','P4','P5','P6','S1','S2','S3','S4');

-- Seed the progression chain: YS-L→YS-J→YS-S→P1→…→P6→S1→…→S4(null); CS1→CS2(null).
with chain(code, next_code) as (
  values ('YS-L','YS-J'),('YS-J','YS-S'),('YS-S','P1'),
         ('P1','P2'),('P2','P3'),('P3','P4'),('P4','P5'),('P5','P6'),('P6','S1'),
         ('S1','S2'),('S2','S3'),('S3','S4'),
         ('CS1','CS2')
)
update public.levels l
set next_level_id = n.id
from chain c
join public.levels n on n.code = c.next_code
where l.code = c.code and l.next_level_id is null;

-- Per-AY offerings — VOLATILE levels only (core levels are always offered, no rows).
create table if not exists public.ay_level_offerings (
  id uuid primary key default gen_random_uuid(),
  academic_year_id uuid not null references public.academic_years(id) on delete cascade,
  level_id uuid not null references public.levels(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (academic_year_id, level_id)
);
alter table public.ay_level_offerings enable row level security;
create policy ay_level_offerings_read on public.ay_level_offerings
  for select to authenticated using (true);
-- Writes go through the service role only (same posture as levels itself).

-- Backfill: a volatile level is offered in an AY iff it has sections there.
insert into public.ay_level_offerings (academic_year_id, level_id)
select distinct s.academic_year_id, s.level_id
from public.sections s
join public.levels l on l.id = s.level_id
where l.is_core = false
on conflict (academic_year_id, level_id) do nothing;

commit;
```

- [ ] **Step 2: Append the `create_academic_year` re-emit.** Open `supabase/migrations/074_section_schedule.sql`, copy its FULL `create or replace function public.create_academic_year(...)` body VERBATIM into 078 (below the block above, inside the same file after the `commit;` — use a second `begin/commit` block), then add ONE new statement inside the function where the other copy-forward inserts live (after the sections copy branch):

```sql
  -- Copy volatile-level offerings from the source AY (levels & progression, spec 2026-07-11).
  insert into public.ay_level_offerings (academic_year_id, level_id)
  select v_new_ay_id, o.level_id
  from public.ay_level_offerings o
  where o.academic_year_id = v_source_ay_id
  on conflict (academic_year_id, level_id) do nothing;
```

Adapt the two variable names to the ones the 074 body actually uses for the new/source AY ids — read the body, do not guess. If the body has no source-AY variable in some branch (template-driven branch), add the offerings copy only to the branch(es) that have a source AY; the template branch inserts nothing (new AY starts with core levels only).

- [ ] **Step 3: Apply to the dev DB** (the user applies migrations via Supabase SQL editor / CLI per repo practice — surface the file and ask; do NOT invent a psql connection). Confirm with a quick PostgREST read that `levels` now returns `sort_order/next_level_id/is_core`.

- [ ] **Step 4: Run the existing suite** — `npx vitest run` (expect all green; nothing consumes the new columns yet) and `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/078_levels_progression.sql
git commit -m "feat(sis): migration 078 - levels sort/progression/core + ay_level_offerings"
```

**PHASE 1 CHECK:** migration applied to dev DB (user-confirmed), suite green, tsc clean, task review passed.

---

## PHASE 2 — Data layer

### Task 2: `lib/sis/level-profiles.ts` — single source for weight defaults

**Files:**

- Create: `lib/sis/level-profiles.ts`
- Modify: `lib/sis/seeder/structural.ts` (~165-167), `lib/sis/seeder/populated.ts`, `lib/sis/seeder/edge-cases.ts`, `lib/sis/seeder/admissions-minimal.ts` (the `primary ? 0.4 : 0.3` sites), `components/sis/subject-config-edit-dialog.tsx:49-54` (prefill), `components/sis/weight-profile.tsx:21-30` (classifier reads the map)
- Test: `__tests__/sis/level-profiles.test.ts`

**Interfaces:**

- Produces: `LEVEL_WEIGHT_PROFILES: Record<'primary'|'secondary', { ww: number; pt: number; qa: number }>` (fractions: `{ww:0.4,pt:0.4,qa:0.2}` / `{ww:0.3,pt:0.5,qa:0.2}`) and `weightProfileFor(levelType: string): { ww: number; pt: number; qa: number } | null` (preschool/unknown → null).

- [ ] **Step 1: Failing test**

```ts
// __tests__/sis/level-profiles.test.ts
import { describe, expect, it } from 'vitest';
import {
  LEVEL_WEIGHT_PROFILES,
  weightProfileFor,
} from '@/lib/sis/level-profiles';

describe('level weight profiles', () => {
  it('primary is 40/40/20', () => {
    expect(LEVEL_WEIGHT_PROFILES.primary).toEqual({
      ww: 0.4,
      pt: 0.4,
      qa: 0.2,
    });
  });
  it('secondary is 30/50/20', () => {
    expect(LEVEL_WEIGHT_PROFILES.secondary).toEqual({
      ww: 0.3,
      pt: 0.5,
      qa: 0.2,
    });
  });
  it('each profile sums to 1', () => {
    for (const p of Object.values(LEVEL_WEIGHT_PROFILES))
      expect(p.ww + p.pt + p.qa).toBeCloseTo(1);
  });
  it('preschool and unknown types have no profile', () => {
    expect(weightProfileFor('preschool')).toBeNull();
    expect(weightProfileFor('nonsense')).toBeNull();
  });
});
```

- [ ] **Step 2: Run** `npx vitest run __tests__/sis/level-profiles.test.ts` — expect FAIL (module not found).
- [ ] **Step 3: Implement** the module (pure, no imports beyond types), then re-run — PASS.
- [ ] **Step 4: Re-point the consumers.** Each seeder's inline ternary becomes `weightProfileFor(levelType)` (keep behavior identical); the dialog prefill derives its default strings from the map for the level's type when a level is in context, else keeps `40/40/20`; `weight-profile.tsx`'s `classifyProfile` compares against the map's values instead of magic numbers. NO behavior change — verify with the existing suites.
- [ ] **Step 5: Full check + commit** — `npx vitest run` green, `npx tsc --noEmit` clean.

```bash
git add lib/sis/level-profiles.ts __tests__/sis/level-profiles.test.ts lib/sis/seeder components/sis/subject-config-edit-dialog.tsx components/sis/weight-profile.tsx
git commit -m "refactor(sis): centralize level weight profiles in lib/sis/level-profiles.ts"
```

### Task 3: DB-backed level loader + demand-signal helper

**Files:**

- Modify: `lib/sis/levels.ts` (add loader + types; keep every existing export byte-compatible)
- Create: `lib/sis/level-demand.ts`
- Test: `__tests__/sis/level-demand.test.ts`

**Interfaces:**

- Produces: `type LevelRow = { id: string; code: string; label: string; levelType: 'preschool'|'primary'|'secondary'; sortOrder: number; nextLevelId: string | null; isCore: boolean }`; `getLevelRows(service): Promise<LevelRow[]>` (ordered by sort_order, `unstable_cache` 60s, tag `'levels'`); `getOfferedLevelIds(service, academicYearId): Promise<Set<string>>` (core ids always included + volatile ids with offering rows); pure `computeLevelDemand(applications: Array<{ levelApplied: string | null }>, levels: LevelRow[], offeredIds: Set<string>): Array<{ label: string; levelId: string | null; count: number; offered: boolean }>`.

- [ ] **Step 1: Failing tests for the pure helper** (`computeLevelDemand` — canonicalizes labels via existing `canonicalizeLevelLabel`, counts per label, marks `offered` false for volatile-unoffered and for unknown labels with `levelId: null`; skips null/empty `levelApplied`):

```ts
// __tests__/sis/level-demand.test.ts — core cases
it('counts applicants per canonical label and flags un-offered levels', () => {
  const levels = [
    lvl('P3', 'Primary Three', true),
    lvl('CS1', 'Cambridge Stage 1', false),
  ];
  const offered = new Set([levels[0].id]); // CS1 not offered
  const rows = computeLevelDemand(
    [
      { levelApplied: 'Primary 3' },
      { levelApplied: 'Cambridge Stage 1' },
      { levelApplied: 'Cambridge Stage 1' },
      { levelApplied: null },
    ],
    levels,
    offered
  );
  expect(rows).toContainEqual({
    label: 'Primary Three',
    levelId: levels[0].id,
    count: 1,
    offered: true,
  });
  expect(rows).toContainEqual({
    label: 'Cambridge Stage 1',
    levelId: levels[1].id,
    count: 2,
    offered: false,
  });
});
it('unknown labels surface with levelId null and offered false', () => {
  /* 'Grade 99' → {levelId:null, offered:false, count:1} */
});
```

(Write `lvl()` as a local factory. Also test: empty input → `[]`; legacy digit label canonicalization.)

- [ ] **Step 2: RED → implement `lib/sis/level-demand.ts` → GREEN.**
- [ ] **Step 3: Add the loader to `lib/sis/levels.ts`** — follow the repo's hoisted-uncached + per-call `unstable_cache` pattern (KD #46; see `lib/sis/readiness.ts` for the idiom). Select `id, code, label, level_type, sort_order, next_level_id, is_core` ordered by `sort_order`. `getOfferedLevelIds` = all core ids + `ay_level_offerings` rows for the AY. Do NOT remove/alter any existing export.
- [ ] **Step 4: Full check + commit** (`feat(sis): DB-backed level rows loader + level demand helper`).

### Task 4: Admin levels API routes

**Files:**

- Create: `app/api/sis/admin/levels/route.ts` (POST create volatile), `app/api/sis/admin/levels/[id]/route.ts` (PATCH label/sort_order/next_level_id; DELETE volatile), `app/api/sis/admin/levels/[id]/offering/route.ts` (PUT `{ academicYearId, offered }`)
- Create: `lib/schemas/level.ts` (zod: `LevelCreateSchema` `{ code: /^[A-Z0-9-]{1,8}$/, label: 1-80, levelType: enum['primary','secondary','preschool'], sortOrder: int 1-99, nextLevelId: uuid|null }`, `LevelUpdateSchema` partial of label/sortOrder/nextLevelId)
- Modify: `lib/audit/log-action.ts` AuditAction union + `lib/audit/humanize.ts` (labels for `level.create|update|delete|offering.toggle`)
- Test: `__tests__/sis/level-schemas.test.ts` (schema accept/reject cases incl. code regex + label bounds)

**Interfaces:**

- Consumes: Task 3's `getLevelRows` (for cycle detection), `revalidateTag('levels','max')`.
- Produces: the four route contracts above; all mirror `app/api/sis/admin/subjects/catalog/route.ts` structurally (requireRole school_admin+superadmin, zod safeParse → 400, duplicate code → 409, audit, service client).

Rules the routes enforce (each a test case in the schema/route logic where pure):

- PATCH `nextLevelId`: reject self-reference (422) and any cycle — walk `next_level_id` from the proposed target via the loaded rows; if the walk returns to the edited level → 422 `progression_cycle`.
- DELETE: only `is_core=false`; FK restrict surfaces as a plain-English 409 ("This level has classes or subject settings on record — it can't be deleted."). Also delete its offering rows first (cascade covers it).
- Offering PUT: core level → 422 `core_always_offered`; idempotent (insert on-conflict-nothing / delete-if-exists).

- [ ] Steps: schema tests RED → `lib/schemas/level.ts` GREEN → routes (model line-by-line on the subjects catalog route) → audit enum + humanizer labels ("Grade level added" / "Grade level updated" / "Grade level removed" / "Level offering changed — {label}") → full suite + tsc → commit `feat(sis): grade-level admin API routes`.

### Task 5: Portal endpoint `GET /api/parent/v2/levels`

**Files:**

- Create: `app/api/parent/v2/levels/route.ts`
- Reference (mirror EXACTLY, do not modify): `app/api/parent/v2/students/route.ts` (OPTIONS handler, corsHeaders spread, IP + per-user rate limits, Bearer via `service.auth.getUser`)

**Interfaces:**

- Consumes: `getLevelRows`, `getOfferedLevelIds`, `getUpcomingAcademicYear` + `getCurrentAcademicYear` (`lib/academic-year.ts`).
- Produces: `{ ayCode: string, levels: Array<{ code, label, type, sortOrder, nextCode: string|null, offered: boolean }> }` — target AY = `getUpcomingAcademicYear() ?? getCurrentAcademicYear()`; `nextCode` resolved from `next_level_id` via the same rows; ordered by sortOrder. Preschool levels included (portal decides display).

- [ ] Steps: implement (structure copied from the students route: OPTIONS → 204+cors; GET → ipRateLimit → bearer → userRateLimit → payload+cors) → manual curl-shaped check via the existing test env is deferred to Phase 4's E2E → full suite + tsc → commit `feat(parent-api): levels & progression read endpoint`.

**PHASE 2 CHECK:** all new unit tests green, full `npx vitest run` + `npx tsc --noEmit` clean, task reviews passed for Tasks 2–5.

---

## PHASE 3 — UI

### Task 6: `/sis/admin/levels` — Grade Levels page

**Files:**

- Create: `app/(sis)/sis/admin/levels/page.tsx` (RSC: role gate + data load), `components/sis/levels-manager-client.tsx` (list + dialogs), `app/(sis)/sis/admin/levels/loading.tsx`
- Modify: `lib/auth/roles.ts` (ROUTE_ACCESS entry `/sis/admin/levels` → `['school_admin','superadmin']` BEFORE the `/sis` catch-all; SIS_NAV "Grade Levels" under Organisation, requiresRoles school_admin+superadmin), `lib/sidebar/registry.ts` (icon map entry), `components/sis/command-palette.tsx` (Admin-group jump)

**Interfaces:**

- Consumes: `getLevelRows`, `getOfferedLevelIds`, `computeLevelDemand` (+ the accepting-AY applications' `levelApplied` — load via the admissions apps table for `getUpcomingAcademicYear() ?? current`, select `levelApplied` only), Task 4's routes via TanStack `useMutation` + `apiFetch` (KD #24), AY list via `listAyCodes` for the offerings switcher.
- Model the page's RSC structure, role gate, hero, and card layout on `app/(sis)/sis/admin/subjects/page.tsx`; the client's mutation/dialog patterns on the subjects catalog tab in `components/sis/template-manager-client.tsx` and `components/sis/subject-config-edit-dialog.tsx`.

Page prescription (design system 09/09a binding; reuse existing primitives — no new CSS):

- Hero (`DashboardHero` idiom as on subjects page): eyebrow "SIS Admin · Organisation", title "Grade levels.", body = the mental-model line: "Primary 1 to Secondary 4 are permanent. Other levels can be offered or shelved per school year. 'Next level' only suggests what a returning student applies for — it never moves anyone."
- One Card: ordered rows (sort_order) — code `Badge` · label · type chip · weight-profile chip (`weight-profile.tsx` vocabulary) · **Next level** `Select` (options = all levels minus self, plus "None — final level"; on change → PATCH; cycle 422 surfaces as the route's plain-English toast) · right side: `Core` badge (muted, with tooltip "Permanent — always offered") OR offered `Switch` for volatile levels bound to the AY selected in a small AY switcher above the list (same switcher idiom as the subjects page) · demand chip (amber, icon+text: "4 applicants — not offered") when `computeLevelDemand` flags it.
- "Add level" `Button` (the page's one primary) → dialog (RHF+zod mirror of `LevelCreateSchema`): code, label, type, position, next level. Delete via row `⋯` menu, `AlertDialog` confirm, disabled-with-reason when core.
- Empty/degenerate states per 09 §10 (no blank regions); all numerics `tabular-nums`.

- [ ] Steps: build page RSC → client list (read-only first) → wire mutations one at a time (PATCH next-level, offering toggle, create, delete) → nav/palette/ROUTE_ACCESS wiring → `npx vitest run` + `npx tsc --noEmit` + `npx next build` → commit `feat(sis): grade levels admin page` (split commits welcome per wiring step).

**PHASE 3 CHECK:** build clean, task review passed (incl. design-system §7 craft + §9 semantic-color pass), manual smoke on `/sis/admin/levels` in the seeded env.

---

## PHASE 4 — Integration + docs

### Task 7: E2E verification + docs

**Files:**

- Modify: `.claude/rules/key-decisions/records.md` (append KD #153 under Records+SIS scope), `.claude/rules/key-decisions.md` (index row + quick-lookup `153 records`), `docs/sprints/development-plan.md` (snapshot sentence), `CLAUDE.md` session context (one line), `.claude/rules/project-layout.md` (levels route + libs, one-line additions)

- [ ] **Step 1: E2E on the test env (AY9999 current):** create a volatile level (e.g. `CS3`), set CS2→CS3, toggle CS3 offered for the test AY; verify it appears in the section-creation level choices and the subjects matrix level axis; hit `GET /api/parent/v2/levels` with a valid bearer (reuse the parent-API test approach) and confirm `nextCode` chain + `offered` flags; seed/find an application whose `levelApplied` names an un-offered level and confirm the demand chip renders.
- [ ] **Step 2: `create_academic_year` regression:** create a throwaway test AY via the wizard; confirm volatile offerings copied from the source AY; KD #119 grep — the 078 function body diffs against 074's only by the offerings insert.
- [ ] **Step 3: KD #153** — concise entry: levels as managed entity (sort/next/is_core + ay_level_offerings, volatile-only rows), profiles centralized, portal levels endpoint, demand signals, cycle guard; cross-ref KD #4 (weights unchanged per subject×level×AY), KD #119 (re-emit discipline), KD #127 (config-only), umbrella spec path.
- [ ] **Step 4: Full suite + build + whole-branch review** (superpowers:requesting-code-review template, most capable model) over the sub-project's commit range; fix findings via one fix subagent; re-review.
- [ ] **Step 5: sync-docs + commit.**

**PHASE 4 CHECK:** E2E paths verified live, final review verdict ready-to-merge, docs synced.
