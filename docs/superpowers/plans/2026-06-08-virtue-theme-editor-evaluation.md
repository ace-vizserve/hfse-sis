# Virtue-theme editor in Evaluation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the registrar a dedicated `/evaluation/virtue-themes` page to set each term's `terms.virtue_theme`, and remove the field from the AY-Setup wizard (single home in Evaluation).

**Architecture:** A new virtue-only PATCH route updates `terms.virtue_theme` (decoupled from the combined AY-Setup term-dates route); a small Evaluation page + client editor consumes it; AY-Setup stops rendering/sending the virtue field. No schema change — `terms.virtue_theme` already exists.

**Tech Stack:** Next.js 16 (RSC + async params), TypeScript, zod, shadcn/ui, Tailwind v4 tokens (`app/globals.css` only), Supabase service client, `vitest`.

**Spec:** `docs/superpowers/specs/2026-06-08-virtue-theme-editor-evaluation-design.md`

---

## File structure

- **Create** `lib/schemas/virtue-theme.ts` — `VirtueThemeSchema` (`{ termId, virtueTheme }`).
- **Create** `app/api/evaluation/virtue-theme/route.ts` — PATCH, virtue-only.
- **Create** `app/(evaluation)/evaluation/virtue-themes/page.tsx` — RSC loader + page.
- **Create** `components/evaluation/virtue-themes-editor.tsx` — client editor.
- **Modify** `lib/auth/roles.ts` — ROUTE_ACCESS entry + EVALUATION_NAV item.
- **Modify** `lib/sidebar/registry.ts` — evaluation iconByHref entry.
- **Modify** `components/sis/term-dates-editor.tsx` — remove the virtue field + stop sending `virtueTheme`.
- **Test** `__tests__/schemas/virtue-theme.test.ts`.

---

## Task 1: Schema + virtue-only PATCH route

**Files:**

- Create: `lib/schemas/virtue-theme.ts`
- Create: `app/api/evaluation/virtue-theme/route.ts`
- Test: `__tests__/schemas/virtue-theme.test.ts`

- [ ] **Step 1: Write the failing schema test**

`__tests__/schemas/virtue-theme.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { VirtueThemeSchema } from '@/lib/schemas/virtue-theme';

describe('VirtueThemeSchema', () => {
  it('accepts a uuid termId + string theme', () => {
    const r = VirtueThemeSchema.safeParse({
      termId: '11111111-1111-1111-1111-111111111111',
      virtueTheme: 'Diligence',
    });
    expect(r.success).toBe(true);
  });
  it('accepts null/empty theme (clears)', () => {
    expect(
      VirtueThemeSchema.safeParse({
        termId: '11111111-1111-1111-1111-111111111111',
        virtueTheme: null,
      }).success
    ).toBe(true);
    expect(
      VirtueThemeSchema.safeParse({
        termId: '11111111-1111-1111-1111-111111111111',
        virtueTheme: '',
      }).success
    ).toBe(true);
  });
  it('rejects a non-uuid termId', () => {
    expect(
      VirtueThemeSchema.safeParse({ termId: 'nope', virtueTheme: 'x' }).success
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm fail**

Run: `npx vitest run __tests__/schemas/virtue-theme.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the schema**

`lib/schemas/virtue-theme.ts`:

```ts
import { z } from 'zod';

// Virtue-only term update — decoupled from the combined AY-Setup term-dates
// route so it never touches start/end dates. Empty string / null clears.
export const VirtueThemeSchema = z.object({
  termId: z.string().uuid(),
  virtueTheme: z.string().trim().max(200).nullable().optional(),
});

export type VirtueThemeInput = z.infer<typeof VirtueThemeSchema>;
```

- [ ] **Step 4: Run the test to confirm pass**

Run: `npx vitest run __tests__/schemas/virtue-theme.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Create the route**

`app/api/evaluation/virtue-theme/route.ts` — mirrors the audit + service-client pattern of `app/api/sis/ay-setup/terms/[termId]/route.ts`, but virtue-only:

```ts
import { NextResponse, type NextRequest } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { logAction } from '@/lib/audit/log-action';
import { createServiceClient } from '@/lib/supabase/service';
import { VirtueThemeSchema } from '@/lib/schemas/virtue-theme';

// PATCH /api/evaluation/virtue-theme
// Body: { termId, virtueTheme } — updates ONLY terms.virtue_theme.
// Audit: ay.term_virtue.update (no-op save emits nothing).
export async function PATCH(request: NextRequest) {
  const auth = await requireRole(['registrar', 'school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = VirtueThemeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { termId } = parsed.data;
  const virtueTheme = parsed.data.virtueTheme ?? null;

  const service = createServiceClient();
  const { data: before, error: loadErr } = await service
    .from('terms')
    .select('id, academic_year_id, term_number, label, virtue_theme')
    .eq('id', termId)
    .maybeSingle();
  if (loadErr)
    return NextResponse.json({ error: loadErr.message }, { status: 500 });
  if (!before)
    return NextResponse.json({ error: 'term not found' }, { status: 404 });

  const changed = (before.virtue_theme ?? null) !== virtueTheme;
  if (changed) {
    const { error: updErr } = await service
      .from('terms')
      .update({ virtue_theme: virtueTheme })
      .eq('id', termId);
    if (updErr)
      return NextResponse.json({ error: updErr.message }, { status: 500 });

    await logAction({
      service,
      actor: { id: auth.user.id, email: auth.user.email ?? null },
      action: 'ay.term_virtue.update',
      entityType: 'term',
      entityId: termId,
      context: {
        academic_year_id: before.academic_year_id,
        term_number: before.term_number,
        label: before.label,
        before: { virtue_theme: before.virtue_theme ?? null },
        after: { virtue_theme: virtueTheme },
      },
    });
  }

  return NextResponse.json({ ok: true, changed });
}
```

(Confirm `requireRole`'s return shape — `'error' in auth` + `auth.user.id`/`auth.user.email` — matches the AY-Setup terms route exactly; it does.)

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit` — clean (ignore only `.next/dev/types/validator.ts` phantom errors).

- [ ] **Step 7: Commit**

```bash
git add lib/schemas/virtue-theme.ts app/api/evaluation/virtue-theme/route.ts __tests__/schemas/virtue-theme.test.ts
git commit -m "feat(evaluation): virtue-only term-theme PATCH route + schema"
```

---

## Task 2: Access — ROUTE_ACCESS + sidebar nav + icon

**Files:**

- Modify: `lib/auth/roles.ts`
- Modify: `lib/sidebar/registry.ts`

- [ ] **Step 1: Add the ROUTE_ACCESS entry**

In `lib/auth/roles.ts`, add a more-specific entry **before** the `{ prefix: '/evaluation', allowed: [...] }` catch-all (the `/evaluation` catch-all includes `teacher`; virtue-themes must exclude teachers):

```ts
  {
    prefix: '/evaluation/virtue-themes',
    allowed: ['registrar', 'school_admin', 'superadmin'],
  },
```

(Place it adjacent to the existing `'/evaluation/audit-log'` entry — same trio, same pattern. Longer-prefix-wins per `isRouteAllowed`, so order among the specific entries doesn't matter, but keep it before the bare `/evaluation`.)

- [ ] **Step 2: Add the EVALUATION_NAV item**

In `EVALUATION_NAV` (roles.ts ~L370), add a new section after the "Write-ups" section:

```ts
  {
    label: 'Setup',
    items: [
      {
        href: '/evaluation/virtue-themes',
        label: 'Virtue themes',
        requiresRoles: ['registrar', 'school_admin', 'superadmin'],
      },
    ],
  },
```

- [ ] **Step 3: Add the sidebar icon**

In `lib/sidebar/registry.ts`, in the `evaluation.iconByHref` map (~L253), add:

```ts
      '/evaluation/virtue-themes': Sparkles,
```

Import `Sparkles` from `lucide-react` at the top of the file if not already imported (check the existing import block; add it alphabetically if missing).

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit && npx next build` — clean; `/evaluation/virtue-themes` need not exist yet for ROUTE_ACCESS/nav to compile (the page lands in Task 3), but the nav item will 404 until then — that's fine mid-plan.

- [ ] **Step 5: Commit**

```bash
git add lib/auth/roles.ts lib/sidebar/registry.ts
git commit -m "feat(evaluation): route-access + sidebar nav for virtue themes"
```

---

## Task 3: The page + editor component

**Files:**

- Create: `app/(evaluation)/evaluation/virtue-themes/page.tsx`
- Create: `components/evaluation/virtue-themes-editor.tsx`

> **UI task** — before JSX: invoke the `ui-ux-pro-max@ui-ux-pro-max-skill` skill + read `docs/context/09-design-system.md` (§8/§9). Tokens only (Hard Rule #7); serif headings, mono eyebrows. Read `app/(evaluation)/evaluation/sections/page.tsx` for the page shell + how it resolves the current AY, and an existing inline-save client pattern (e.g. `components/sis/term-dates-editor.tsx` or a `totals-editor`-style fetch+toast) to mirror.

- [ ] **Step 1: The page (RSC)**

`app/(evaluation)/evaluation/virtue-themes/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { PageShell } from '@/components/ui/page-shell';
import { VirtueThemesEditor } from '@/components/evaluation/virtue-themes-editor';
import { requireCurrentAyCode } from '@/lib/academic-year';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

export default async function VirtueThemesPage() {
  const session = await getSessionUser();
  if (!session) redirect('/login');
  if (
    session.role !== 'registrar' &&
    session.role !== 'school_admin' &&
    session.role !== 'superadmin'
  ) {
    redirect('/evaluation');
  }

  const service = createServiceClient();
  const ayCode = await requireCurrentAyCode(service);
  const { data: ayRow } = await service
    .from('academic_years')
    .select('id, label')
    .eq('ay_code', ayCode)
    .maybeSingle();

  type TermRow = {
    id: string;
    term_number: number;
    label: string;
    start_date: string | null;
    end_date: string | null;
    virtue_theme: string | null;
  };
  let terms: TermRow[] = [];
  if (ayRow) {
    const { data } = await service
      .from('terms')
      .select('id, term_number, label, start_date, end_date, virtue_theme')
      .eq('academic_year_id', (ayRow as { id: string }).id)
      .gte('term_number', 1)
      .lte('term_number', 3) // T1–T3 only — T4 has no FCA comment (KD #49)
      .order('term_number');
    terms = (data ?? []) as TermRow[];
  }

  return (
    <PageShell>
      <header className="space-y-3">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Evaluation · {ayCode}
        </p>
        <h1 className="font-serif text-[32px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[38px]">
          Virtue themes.
        </h1>
        <p className="max-w-3xl text-[15px] leading-relaxed text-muted-foreground">
          The virtue theme for each term prints on the report card as the Form
          Class Adviser&rsquo;s Comments heading (&ldquo;HFSE Virtues:
          &hellip;&rdquo;) and frames the advisers&rsquo; write-ups. Terms
          1&ndash;3 only.
        </p>
      </header>
      {terms.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-10 text-center text-sm text-muted-foreground">
          No terms configured for this academic year yet.
        </div>
      ) : (
        <VirtueThemesEditor
          terms={terms.map((t) => ({
            id: t.id,
            label: t.label,
            termNumber: t.term_number,
            startDate: t.start_date,
            endDate: t.end_date,
            virtueTheme: t.virtue_theme ?? '',
          }))}
        />
      )}
    </PageShell>
  );
}
```

- [ ] **Step 2: The editor component**

`components/evaluation/virtue-themes-editor.tsx` (`'use client'`):

- Props: `terms: { id; label; termNumber; startDate; endDate; virtueTheme }[]`.
- Local state: a per-term controlled value (seed from `virtueTheme`) + per-term saving flag + a "dirty" check (current value !== seeded).
- Render one row per term (a `Card` or bordered row): term label + window (`toLocaleDateString('en-SG')`, read-only context), a labelled text `Input` bound to the value, and a **Save** `Button` (disabled when not dirty / while saving).
- On save: `PATCH /api/evaluation/virtue-theme` with `{ termId: t.id, virtueTheme: value.trim() || null }`; on ok → `toast.success('Virtue theme saved')`, update the seeded baseline, `router.refresh()`; on error → `toast.error(message)`. Use `import { toast } from 'sonner'`.
- One primary `Button` per row is fine (it's the row's only action); tokens only. Mirror the input/label styling used in `term-dates-editor.tsx`.

> Provide the full component when implementing — controlled inputs keyed by term id, a `saving` set, dirty derivation, and the fetch. Keep it ~80–120 lines, single responsibility.

- [ ] **Step 3: Typecheck + build + manual**

Run: `npx tsc --noEmit && npx next build` — `/evaluation/virtue-themes` compiles (dynamic). Load it as registrar → three term rows render with current themes; edit + save persists; teacher is redirected.

- [ ] **Step 4: Commit**

```bash
git add "app/(evaluation)/evaluation/virtue-themes" components/evaluation/virtue-themes-editor.tsx
git commit -m "feat(evaluation): virtue-themes editor page"
```

---

## Task 4: Remove the virtue field from AY-Setup

**Files:**

- Modify: `components/sis/term-dates-editor.tsx`

- [ ] **Step 1: Remove the virtue input + plumbing**

In `components/sis/term-dates-editor.tsx`:

- Remove the **Virtue theme** `<Field>`/`<Input>` block (the "Secondary row: Virtue + Grading lock" virtue half, ~L344–360) — keep the **Grading lock** control in that row.
- Remove `virtue_theme` from the row draft type (~L37), the dirty check (~L89), the save payload (`virtueTheme: d.virtue_theme.trim() || null`, ~L136), and the row initializer (`virtue_theme: t.virtue_theme ?? ''`, ~L412).
- Update the explanatory copy (~L194–196) that mentions virtue themes — point it to Evaluation (e.g. "Virtue themes are set in Evaluation → Virtue themes.") or drop that sentence.
- Leave `lib/schemas/ay-setup.ts::TermDatesSchema.virtueTheme` **as-is** (optional) — the combined route keeps back-compat; the editor simply no longer sends it (`'virtueTheme' in data` becomes false → route doesn't touch the column).

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit && npx next build` — clean. (If `term-dates-editor` had a prop/type referencing virtue elsewhere — e.g. the parent AY-setup page passing `virtue_theme` — adjust those call sites too; grep `virtue` under `app/(sis)/sis/ay-setup` + `components/sis` and clean any now-unused references.)

- [ ] **Step 3: Manual check**

AY-Setup term editor no longer shows a virtue field; term dates + grading-lock still save. Evaluation → Virtue themes is now the sole editor.

- [ ] **Step 4: Commit**

```bash
git add components/sis/term-dates-editor.tsx
git commit -m "feat(sis): remove virtue-theme field from AY-Setup (moved to Evaluation)"
```

---

## Task 5: Final verification

- [ ] **Step 1:** `npx tsc --noEmit` → clean.
- [ ] **Step 2:** `npx vitest run` → all pass (incl. the new schema test).
- [ ] **Step 3:** `npx next build` → clean; `/evaluation/virtue-themes` present.
- [ ] **Step 4:** End-to-end as registrar: open via the Evaluation "Virtue themes" sidebar item → edit T1–T3 → save → reopen shows persisted values; audit log shows `ay.term_virtue.update`. Confirm a teacher is redirected off the page. Confirm AY-Setup no longer shows the field but still saves dates.
- [ ] **Step 5:** Dispatch `feature-dev:code-reviewer` over the branch diff; address findings.

---

## Self-review notes (author)

- **Spec coverage:** dedicated page (T3) · virtue-only route + audit (T1) · ROUTE_ACCESS + nav + icon (T2) · remove from AY-Setup (T4) · current-AY/T1–T3 scope (T3 loader). All covered.
- **No schema change** (terms.virtue_theme exists) — confirmed.
- **Audit reuse:** `ay.term_virtue.update` already exists (used by the AY-Setup route) — no new AuditAction needed.
- **Type consistency:** `VirtueThemeSchema`/`VirtueThemeInput`, page→editor prop shape (`{ id, label, termNumber, startDate, endDate, virtueTheme }`) consistent across tasks.
- **Risk:** the only non-trivial edit is the AY-Setup field removal (woven through draft/dirty/save/init) — Task 4 enumerates each site + a grep sweep for stragglers.
