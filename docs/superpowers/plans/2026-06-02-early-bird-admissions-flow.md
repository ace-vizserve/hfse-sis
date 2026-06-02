# Early-Bird AY Selection in Admissions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the act of opening/switching/closing the early-bird (upcoming) academic year out of SIS Admin and into Admissions, enforcing at most one open upcoming AY; SIS Admin keeps AY creation and the current-AY toggle only.

**Architecture:** No schema change — `academic_years.accepting_applications` stays the flag and "upcoming AY" stays `accepting_applications=true AND is_current=false`. A pure helper computes the single-select closures; the existing PATCH route applies them. The existing `/admissions/upcoming/applications` page gains a client control for open/switch/close. SIS Admin trims its early-bird write surfaces.

**Tech Stack:** Next.js 16 (App Router, RSC + client components), Supabase service client, zod, shadcn (`Select`/`Card`/`Button`), `sonner` toasts, vitest.

**Spec:** `docs/superpowers/specs/2026-06-02-early-bird-admissions-flow-design.md`

---

### Task 1: Pure single-select helper

**Files:**

- Create: `lib/sis/early-bird.ts`
- Test: `__tests__/sis/early-bird.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/sis/early-bird.test.ts
import { describe, expect, it } from 'vitest';

import { computeEarlyBirdClosures, type AyFlagRow } from '@/lib/sis/early-bird';

const rows: AyFlagRow[] = [
  { ay_code: 'AY2026', is_current: true, accepting_applications: true },
  { ay_code: 'AY2027', is_current: false, accepting_applications: true },
  { ay_code: 'AY2028', is_current: false, accepting_applications: false },
];

describe('computeEarlyBirdClosures', () => {
  it('opening a different upcoming AY closes the currently-open upcoming AY', () => {
    expect(computeEarlyBirdClosures('AY2028', rows)).toEqual(['AY2027']);
  });

  it('opening the already-open upcoming AY closes nothing', () => {
    expect(computeEarlyBirdClosures('AY2027', rows)).toEqual([]);
  });

  it('never closes the current AY', () => {
    expect(computeEarlyBirdClosures('AY2028', rows)).not.toContain('AY2026');
  });

  it('opening the current AY is not a single-select op (no closures)', () => {
    expect(computeEarlyBirdClosures('AY2026', rows)).toEqual([]);
  });

  it('unknown target closes nothing', () => {
    expect(computeEarlyBirdClosures('AY2099', rows)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/sis/early-bird.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/sis/early-bird"`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/sis/early-bird.ts

// Pure single-select rule for the early-bird AY (KD #77).
// Invariant: at most one upcoming (non-current) AY may accept applications.
// See docs/superpowers/specs/2026-06-02-early-bird-admissions-flow-design.md.

export type AyFlagRow = {
  ay_code: string;
  is_current: boolean;
  accepting_applications: boolean;
};

// Given the AY being opened for early-bird (accepting=true) and the full AY
// list, return the ay_codes of the OTHER non-current AYs that are currently
// accepting and must be closed to keep at most one upcoming AY open.
//
// Returns [] when the target is the current AY (the current AY is never part
// of the single-select pool), when the target is unknown, or when no other
// upcoming AY is open.
export function computeEarlyBirdClosures(
  targetAyCode: string,
  allAys: AyFlagRow[]
): string[] {
  const target = allAys.find((a) => a.ay_code === targetAyCode);
  if (!target || target.is_current) return [];
  return allAys
    .filter(
      (a) =>
        a.ay_code !== targetAyCode && !a.is_current && a.accepting_applications
    )
    .map((a) => a.ay_code);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/sis/early-bird.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/sis/early-bird.ts __tests__/sis/early-bird.test.ts
git commit -m "feat(admissions): pure single-select rule for early-bird AY"
```

---

### Task 2: Enforce single-select in the accepting-applications route

**Files:**

- Modify: `app/api/sis/ay-setup/accepting-applications/route.ts` (full PATCH rewrite)

- [ ] **Step 1: Replace the route body**

Replace the entire contents of `app/api/sis/ay-setup/accepting-applications/route.ts` with:

```ts
import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { ToggleAcceptingApplicationsSchema } from '@/lib/schemas/ay-setup';
import { computeEarlyBirdClosures } from '@/lib/sis/early-bird';
import { createServiceClient } from '@/lib/supabase/service';

// PATCH /api/sis/ay-setup/accepting-applications
//
// Open / close the early-bird application gate (KD #77) on an AY.
//
// Opening a non-current AY enforces the single-select invariant: at most one
// upcoming AY may accept applications at a time, so any other open upcoming AY
// is closed first. Closing, or flipping the current AY, is a plain single-row
// flip (the current AY is never part of the single-select pool).
//
// Role: school_admin + superadmin.
export async function PATCH(request: Request) {
  const auth = await requireRole(['school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = ToggleAcceptingApplicationsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { ay_code: ayCode, accepting } = parsed.data;
  const supabase = createServiceClient();

  // Load every AY's flags once — needed for the target lookup and the
  // single-select closure computation.
  const { data: allRows, error: listErr } = await supabase
    .from('academic_years')
    .select('id, ay_code, is_current, accepting_applications');
  if (listErr) {
    console.error(
      '[ay-setup accepting-applications] list failed:',
      listErr.message
    );
    return NextResponse.json({ error: listErr.message }, { status: 500 });
  }
  const all = (allRows ?? []) as Array<{
    id: string;
    ay_code: string;
    is_current: boolean;
    accepting_applications: boolean;
  }>;

  const target = all.find((a) => a.ay_code === ayCode);
  if (!target) {
    return NextResponse.json(
      { error: `AY ${ayCode} not found` },
      {
        status: 404,
      }
    );
  }

  const actor = { id: auth.user.id, email: auth.user.email ?? null };

  // ── Close: plain single-row flip ──────────────────────────────────────────
  if (!accepting) {
    if (!target.accepting_applications) {
      return NextResponse.json({ ok: true, unchanged: true, accepting });
    }
    const { error } = await supabase
      .from('academic_years')
      .update({ accepting_applications: false })
      .eq('ay_code', ayCode);
    if (error) {
      console.error(
        '[ay-setup accepting-applications] close failed:',
        error.message
      );
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    await logAction({
      service: supabase,
      actor,
      action: 'ay.accepting_applications.toggle',
      entityType: 'academic_year',
      entityId: target.id,
      context: { ay_code: ayCode, before: true, after: false },
    });
    revalidateTag(`sis:${ayCode}`, 'max');
    return NextResponse.json({ ok: true, accepting: false });
  }

  // ── Open: enforce single-select among non-current AYs ─────────────────────
  const toClose = computeEarlyBirdClosures(ayCode, all);
  for (const closeCode of toClose) {
    const closed = all.find((a) => a.ay_code === closeCode);
    const { error } = await supabase
      .from('academic_years')
      .update({ accepting_applications: false })
      .eq('ay_code', closeCode);
    if (error) {
      console.error(
        '[ay-setup accepting-applications] auto-close failed:',
        error.message
      );
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    await logAction({
      service: supabase,
      actor,
      action: 'ay.accepting_applications.toggle',
      entityType: 'academic_year',
      entityId: closed?.id ?? null,
      context: {
        ay_code: closeCode,
        before: true,
        after: false,
        autoClosedBy: ayCode,
      },
    });
    revalidateTag(`sis:${closeCode}`, 'max');
  }

  if (!target.accepting_applications) {
    const { error } = await supabase
      .from('academic_years')
      .update({ accepting_applications: true })
      .eq('ay_code', ayCode);
    if (error) {
      console.error(
        '[ay-setup accepting-applications] open failed:',
        error.message
      );
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  await logAction({
    service: supabase,
    actor,
    action: 'ay.accepting_applications.toggle',
    entityType: 'academic_year',
    entityId: target.id,
    context: {
      ay_code: ayCode,
      before: target.accepting_applications,
      after: true,
      ...(toClose.length ? { autoClosedPrevious: toClose } : {}),
    },
  });
  revalidateTag(`sis:${ayCode}`, 'max');

  return NextResponse.json({ ok: true, accepting: true, autoClosed: toClose });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add app/api/sis/ay-setup/accepting-applications/route.ts
git commit -m "feat(admissions): single-select enforcement on early-bird toggle route"
```

---

### Task 3: AY-list helper for the Admissions picker

**Files:**

- Modify: `lib/academic-year.ts` (append a helper at end of file)

- [ ] **Step 1: Add the helper**

Append to the end of `lib/academic-year.ts`:

```ts
// All AYs with their flags, newest first — for the Admissions early-bird
// picker, which filters to non-current candidates. Cheap single query; NOT
// cached because the picker must reflect a just-flipped value after
// router.refresh().
export type SelectableAcademicYear = {
  id: string;
  ay_code: string;
  label: string;
  is_current: boolean;
  accepting_applications: boolean;
};

export async function listSelectableAcademicYears(): Promise<
  SelectableAcademicYear[]
> {
  const client = await createServerClient();
  const { data, error } = await client
    .from('academic_years')
    .select('id, ay_code, label, is_current, accepting_applications')
    .order('ay_code', { ascending: false });
  if (error) {
    console.error(
      '[academic-year] listSelectableAcademicYears failed:',
      error.message
    );
    return [];
  }
  return (data ?? []) as SelectableAcademicYear[];
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add lib/academic-year.ts
git commit -m "feat(admissions): listSelectableAcademicYears for early-bird picker"
```

---

### Task 4: `<EarlyBirdAyControl>` client component

**Files:**

- Create: `components/admissions/early-bird-ay-control.tsx`

Verify `components/ui/select.tsx` exists (it's used widely). If missing, install via shadcn MCP before continuing — do not substitute another primitive.

- [ ] **Step 1: Create the component**

```tsx
// components/admissions/early-bird-ay-control.tsx
'use client';

import { Loader2, Mail, MailX } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// Admissions early-bird control (KD #77). Opens / switches / closes the single
// upcoming AY that accepts applications. The flip itself is school_admin+ only
// (canManage); other roles see a read-only state. When no future AY exists,
// the only pointer to SIS Admin (for AY creation) is shown.

export type EarlyBirdCandidate = { ayCode: string; label: string };

export function EarlyBirdAyControl({
  candidates,
  openAyCode,
  canManage,
}: {
  candidates: EarlyBirdCandidate[];
  openAyCode: string | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<string>(openAyCode ?? '');

  async function flip(ayCode: string, accepting: boolean) {
    setBusy(true);
    try {
      const res = await fetch('/api/sis/ay-setup/accepting-applications', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ay_code: ayCode, accepting }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? 'Update failed');
      toast.success(
        accepting
          ? `Early-bird applications open for ${ayCode}.`
          : `Early-bird applications closed for ${ayCode}.`
      );
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  const eyebrow = (
    <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
      Early-bird applications
    </CardDescription>
  );

  // No future AY exists → the only pointer to SIS Admin (for creation).
  if (candidates.length === 0) {
    return (
      <Card>
        <CardHeader>
          {eyebrow}
          <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
            No future academic year yet
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Create the upcoming year first, then come back here to open
          early-bird.{' '}
          <Link
            href="/sis/ay-setup"
            className="font-medium text-primary underline underline-offset-2"
          >
            Go to AY Setup →
          </Link>
        </CardContent>
      </Card>
    );
  }

  // Read-only for non-managers (admissions / registrar).
  if (!canManage) {
    return (
      <Card>
        <CardHeader>
          {eyebrow}
          <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
            {openAyCode ? `Open for ${openAyCode}` : 'No upcoming year is open'}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Ask an administrator to open or change the early-bird year.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        {eyebrow}
        <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
          {openAyCode ? `Open for ${openAyCode}` : 'No upcoming year is open'}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        <Select value={picked} onValueChange={setPicked} disabled={busy}>
          <SelectTrigger className="w-[240px]">
            <SelectValue placeholder="Pick a future year" />
          </SelectTrigger>
          <SelectContent>
            {candidates.map((c) => (
              <SelectItem key={c.ayCode} value={c.ayCode}>
                {c.label} ({c.ayCode})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          disabled={busy || !picked || picked === openAyCode}
          onClick={() => flip(picked, true)}
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Mail className="size-4" />
          )}
          {openAyCode ? 'Switch to this year' : 'Open early-bird'}
        </Button>
        {openAyCode && (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => flip(openAyCode, false)}
          >
            <MailX className="size-4" />
            Close early-bird
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add components/admissions/early-bird-ay-control.tsx
git commit -m "feat(admissions): EarlyBirdAyControl open/switch/close component"
```

---

### Task 5: Rework `/admissions/upcoming/applications` to mount the control

**Files:**

- Modify: `app/(admissions)/admissions/upcoming/applications/page.tsx` (full rewrite)

- [ ] **Step 1: Replace the page**

Replace the entire contents of `app/(admissions)/admissions/upcoming/applications/page.tsx` with:

```tsx
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  ArrowLeft,
  ClipboardList,
  FileStack,
  Hourglass,
  Mail,
} from 'lucide-react';

import { EarlyBirdAyControl } from '@/components/admissions/early-bird-ay-control';
import {
  StudentDataTable,
  type StatusBucketDef,
} from '@/components/sis/student-data-table';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import {
  getUpcomingAcademicYear,
  listSelectableAcademicYears,
} from '@/lib/academic-year';
import { listStudents } from '@/lib/sis/queries';
import { getSessionUser } from '@/lib/supabase/server';

// /admissions/upcoming/applications — early-bird pipeline + selection (KD #77).
//
// The open/switch/close control lives here (Admissions), not in SIS Admin.
// SIS Admin only CREATES academic years; choosing which upcoming AY accepts
// early-bird applications happens on this page. At most one upcoming AY is open
// (enforced by the PATCH route). When one is open, its application pipeline is
// listed below the control.

const ACTIVE_FUNNEL_STAGES = new Set([
  'Submitted',
  'Ongoing Verification',
  'Processing',
]);

const STAGES: Array<{
  key: string;
  status: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { key: 'submitted', status: 'Submitted', label: 'Submitted', icon: Mail },
  {
    key: 'ongoing-verification',
    status: 'Ongoing Verification',
    label: 'Ongoing Verification',
    icon: ClipboardList,
  },
  {
    key: 'processing',
    status: 'Processing',
    label: 'Processing',
    icon: Hourglass,
  },
];

const APPLICATIONS_STATUS_BUCKETS: StatusBucketDef[] = [
  { key: 'all', label: 'All' },
  { key: 'submitted', label: 'Submitted', statuses: ['Submitted'] },
  {
    key: 'ongoing-verification',
    label: 'Ongoing Verification',
    statuses: ['Ongoing Verification'],
  },
  { key: 'processing', label: 'Processing', statuses: ['Processing'] },
];

export default async function UpcomingAdmissionsApplicationsPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (
    sessionUser.role !== 'admissions' &&
    sessionUser.role !== 'registrar' &&
    sessionUser.role !== 'school_admin' &&
    sessionUser.role !== 'superadmin'
  ) {
    redirect('/');
  }

  const canManage =
    sessionUser.role === 'school_admin' || sessionUser.role === 'superadmin';

  const [upcomingAy, allAys] = await Promise.all([
    getUpcomingAcademicYear(),
    listSelectableAcademicYears(),
  ]);
  const candidates = allAys
    .filter((a) => !a.is_current)
    .map((a) => ({ ayCode: a.ay_code, label: a.label }));

  const header = (
    <>
      <Link
        href="/admissions"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Admissions dashboard
      </Link>
      <header className="space-y-3">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Admissions · Upcoming AY
        </p>
        <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
          Early-bird applications.
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Open one upcoming academic year for early applications. The parent
          portal accepts submissions for the open year, and they appear here
          until that year becomes the operational AY at rollover.
        </p>
      </header>
    </>
  );

  // No upcoming AY open → the control card carries the picker / empty state.
  if (!upcomingAy) {
    return (
      <PageShell>
        {header}
        <EarlyBirdAyControl
          candidates={candidates}
          openAyCode={null}
          canManage={canManage}
        />
      </PageShell>
    );
  }

  const allStudents = await listStudents(upcomingAy.ay_code, 'created_at_desc');
  const applications = allStudents.filter((s) =>
    ACTIVE_FUNNEL_STAGES.has((s.applicationStatus ?? '').trim())
  );

  const stageCounts: Record<string, number> = {
    submitted: 0,
    'ongoing-verification': 0,
    processing: 0,
  };
  for (const row of applications) {
    const s = (row.applicationStatus ?? '').trim();
    const stage = STAGES.find((x) => x.status === s)?.key;
    if (stage) stageCounts[stage] = (stageCounts[stage] ?? 0) + 1;
  }

  return (
    <PageShell>
      {header}

      <EarlyBirdAyControl
        candidates={candidates}
        openAyCode={upcomingAy.ay_code}
        canManage={canManage}
      />

      {/* Stage breakdown */}
      <section className="@container/main">
        <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-3">
          {STAGES.map((stage) => (
            <StageStat
              key={stage.key}
              label={stage.label}
              value={stageCounts[stage.key] ?? 0}
              icon={stage.icon}
              total={applications.length}
            />
          ))}
        </div>
      </section>

      {/* Applications table */}
      <Card className="overflow-hidden p-0">
        <CardHeader className="border-b border-border px-6 py-5">
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Pre-enrolment · {upcomingAy.ay_code} (early-bird)
          </CardDescription>
          <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
            Applications ({applications.length.toLocaleString('en-SG')})
          </CardTitle>
          <CardAction>
            <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <FileStack className="size-4" />
            </div>
          </CardAction>
        </CardHeader>
        <CardContent className="p-0">
          <StudentDataTable
            data={applications}
            linkBase="/admissions/applications"
            linkQuery={{ ay: upcomingAy.ay_code }}
            showSubmittedColumn
            defaultSorting={[{ id: 'submitted', desc: true }]}
            statusBuckets={APPLICATIONS_STATUS_BUCKETS}
          />
        </CardContent>
      </Card>
    </PageShell>
  );
}

function StageStat({
  label,
  value,
  icon: Icon,
  total,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  total: number;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {label}
        </CardDescription>
        <CardTitle className="font-serif text-3xl font-semibold tabular-nums tracking-tight text-foreground">
          {value.toLocaleString('en-SG')}
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Icon className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {pct}% of in-flight applications
        </p>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit && npx next build`
Expected: exit 0; route `/admissions/upcoming/applications` compiles.

- [ ] **Step 3: Commit**

```bash
git add app/(admissions)/admissions/upcoming/applications/page.tsx
git commit -m "feat(admissions): early-bird open/switch/close on upcoming applications page"
```

---

### Task 6: Trim SIS Admin AY creation (remove early-bird from wizard)

**Files:**

- Modify: `lib/schemas/ay-setup.ts`
- Modify: `app/api/sis/ay-setup/route.ts`
- Modify: `components/sis/ay-setup-wizard.tsx`

- [ ] **Step 1: Drop `accepting_applications` from the create schema**

In `lib/schemas/ay-setup.ts`, change `CreateAySchema` from:

```ts
export const CreateAySchema = z.object({
  ay_code: AyCode,
  label: z
    .string()
    .trim()
    .min(1, 'Label required')
    .max(120, 'Label too long (120 char max)'),
  // KD #77: when true, the new AY immediately accepts applications via the
  // parent portal AND surfaces in the admissions sidebar's "Upcoming AY
  // applications" entry. The wizard's initial form state defaults this to
  // false so the registrar can stage an AY weeks ahead of opening early-bird.
  accepting_applications: z.boolean(),
});
```

to:

```ts
export const CreateAySchema = z.object({
  ay_code: AyCode,
  label: z
    .string()
    .trim()
    .min(1, 'Label required')
    .max(120, 'Label too long (120 char max)'),
});
```

- [ ] **Step 2: Drop the early-bird write from the POST route**

In `app/api/sis/ay-setup/route.ts`, change the destructure from:

```ts
const {
  ay_code: ayCode,
  label,
  accepting_applications: acceptingApplications,
} = parsed.data;
```

to:

```ts
const { ay_code: ayCode, label } = parsed.data;
```

Then delete this entire block (the `if (acceptingApplications) { ... }` and its preceding comment):

```ts
// KD #77: apply the early-bird gate after the RPC commits. The RPC itself
// doesn't know about `accepting_applications` (added in migration 038)
// and we don't want to wedge that into the RPC contract — a focused
// UPDATE here is simpler and re-running is safe (idempotent overwrite).
if (acceptingApplications) {
  const { error: gateErr } = await supabase
    .from('academic_years')
    .update({ accepting_applications: true })
    .eq('ay_code', ayCode);
  if (gateErr) {
    // Non-fatal: the AY exists; the registrar can flip the switch from
    // the AY list. Log and surface so the toast tells them why.
    console.error(
      '[ay-setup POST] accepting_applications flip failed:',
      gateErr.message
    );
  }
}
```

- [ ] **Step 3: Remove the wizard checkbox, default, and review row**

In `components/sis/ay-setup-wizard.tsx`:

(a) Change `BLANK` from:

```ts
const BLANK: CreateAyInput = {
  ay_code: '',
  label: '',
  accepting_applications: false,
};
```

to:

```ts
const BLANK: CreateAyInput = {
  ay_code: '',
  label: '',
};
```

(b) Delete the entire `<FormField name="accepting_applications" ...>` block (the one rendering the "Open this AY for early-bird applications now" Checkbox, ~lines 229-254).

(c) Delete the early-bird `<ReviewRow>` block in the review step:

```tsx
<ReviewRow
  label="Early-bird"
  value={
    form.watch('accepting_applications')
      ? 'Open — appears in Admissions sidebar as "Upcoming AY applications"; parent portal can submit'
      : 'Closed — applications gated until you flip the switch from the AY list'
  }
/>
```

(d) Remove the now-unused `Checkbox` import (the deleted FormField was its only use — confirm with a search for `Checkbox` in this file first; remove the import line only if no other usage remains).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0 (no reference to `accepting_applications` remains in the wizard/route/schema create path).

- [ ] **Step 5: Commit**

```bash
git add lib/schemas/ay-setup.ts app/api/sis/ay-setup/route.ts components/sis/ay-setup-wizard.tsx
git commit -m "refactor(sis): AY creation no longer sets early-bird (moved to Admissions)"
```

---

### Task 7: SIS AY-list — current-AY-only toggle

**Files:**

- Modify: `components/sis/ay-setup-data-table.tsx`

The per-row `<AyAcceptingApplicationsToggle>` must render only for the current AY. The read-only "Early-bird open" badge for non-current rows (the `ay.accepting_applications && !ay.is_current` block in the status column) stays unchanged.

- [ ] **Step 1: Gate the toggle on `is_current`**

In `components/sis/ay-setup-data-table.tsx`, change:

```tsx
{
  /* Inline: Early-bird applications Switch (state toggle, not an action) */
}
<AyAcceptingApplicationsToggle
  ayCode={row.ay_code}
  current={row.accepting_applications}
  isCurrentAy={row.is_current}
/>;
```

to:

```tsx
{
  /* Inline: current-AY application toggle only. Early-bird selection for
          upcoming AYs now lives in Admissions (/admissions/upcoming/applications). */
}
{
  row.is_current && (
    <AyAcceptingApplicationsToggle
      ayCode={row.ay_code}
      current={row.accepting_applications}
      isCurrentAy={row.is_current}
    />
  );
}
```

(`AyAcceptingApplicationsToggle` in `components/sis/ay-accepting-applications-toggle.tsx` already handles the current-AY case correctly — its `isCurrentAy && current` guard copy is now its only path. Leave the component as-is; no behavioural change needed.)

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit && npx next build`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add components/sis/ay-setup-data-table.tsx
git commit -m "refactor(sis): AY-list toggle now current-AY only; upcoming moves to Admissions"
```

---

### Task 8: Full verification + manual happy path

- [ ] **Step 1: Run the full CI-mirror gate**

Run: `npm run format && npx tsc --noEmit && npm run test && npm run build`
Expected: prettier clean, tsc exit 0, vitest all pass (includes the 5 new `early-bird` tests), build exit 0.

- [ ] **Step 2: Manual happy path** (dev server, signed in as superadmin or school_admin on a test AY)

1. Ensure ≥2 non-current AYs exist (e.g. AY2027, AY2028) — create via SIS Admin → AY Setup if needed. Confirm the wizard no longer shows an early-bird checkbox.
2. Go to `/admissions/upcoming/applications`. With none open, the control card shows the picker. Pick AY2027 → **Open early-bird** → toast + the pipeline section appears for AY2027.
3. In the control, pick AY2028 → **Switch to this year** → AY2027 auto-closes, AY2028 becomes the open year (verify only one is open: SIS Admin AY list shows the "Early-bird open" badge on AY2028 only).
4. **Close early-bird** → pipeline disappears, picker returns; SIS Admin AY list shows no "Early-bird open" badge on any non-current row.
5. Sign in as a plain `admissions` role user → the page renders read-only (no Open/Switch/Close buttons).
6. SIS Admin AY list: the application toggle button appears only on the current AY's row.

- [ ] **Step 3: Final commit (if any tidy-ups)**

```bash
git add -A
git commit -m "test(admissions): verify early-bird single-select flow"
```

---

## Self-review notes

- **Spec coverage:** §1 write API → Task 2 (+ Task 1 helper); §2 page rework → Task 5 (+ Task 4 control, Task 3 query); §3 dashboard card → intentionally untouched (matches spec); §4 SIS trims → Tasks 6 (wizard/schema/route) + 7 (AY-list toggle). Testing → Task 1 unit + Task 8 manual.
- **Deviation from spec:** the spec mentioned simplifying `<AyAcceptingApplicationsToggle>`'s branching. It already behaves correctly for the current-AY-only case, so Task 7 leaves the component untouched to avoid churn — only its call site is gated. No functional gap.
- **Type consistency:** `AyFlagRow` (Task 1) is consumed by Task 2; `EarlyBirdCandidate` / `openAyCode` / `canManage` (Task 4) match the props passed in Task 5; `listSelectableAcademicYears` (Task 3) is imported in Task 5.
