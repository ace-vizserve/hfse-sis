# AY Application Window — SIS-Owned, Admissions Read-Only — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Relocate the early-bird application-window control from Admissions back to SIS Admin (per KD #48), make Admissions read-only, add rollover auto-open/close of the window, a descriptive Switch UI, and a soft sections-readiness warning on activation.

**Architecture:** Reuse the engine already merged today (`computeEarlyBirdClosures` + `PATCH /api/sis/ay-setup/accepting-applications` single-select). Drive it from a per-row Switch in the SIS AY table instead of an Admissions control. The switch-active route gains accepting-window flips. Admissions loses its control component and becomes a read-only viewer.

**Tech Stack:** Next.js 16 (App Router, RSC + client), Supabase service client, shadcn (`Switch`, `Alert`, `AlertDialog`, `Badge`, `Card`), `sonner`, vitest.

**Spec:** `docs/superpowers/specs/2026-06-02-ay-application-window-design.md`

---

### Task 1: Switch-active rollover opens new window, closes old

**Files:**

- Modify: `app/api/sis/ay-setup/route.ts` (PATCH handler only)

The PATCH handler already flips `is_current` (sets all false, then target true) and captures `prevAy`. Add the window flips after the `setErr` check and before `logAction`, and extend the audit context.

- [ ] **Step 1: Insert the window flips**

In `app/api/sis/ay-setup/route.ts`, find this block in the PATCH handler:

```ts
  const { error: setErr } = await supabase
    .from('academic_years')
    .update({ is_current: true })
    .eq('ay_code', targetAy);
  if (setErr) {
    console.error(
      '[ay-setup PATCH] setting is_current failed:',
      setErr.message
    );
    return NextResponse.json({ error: setErr.message }, { status: 500 });
  }

  await logAction({
```

Insert, between the `setErr` `if` block and the `await logAction({` line:

```ts
// The application window follows the active flag: the new current AY accepts
// applications by default, and the outgoing AY's window closes. Closing the
// old one is a correctness requirement — otherwise it still satisfies
// accepting=true AND is_current=false and would be mistaken for the early-bird
// upcoming AY by getUpcomingAcademicYear(). Best-effort, non-transactional;
// re-running the switch converges.
const { error: openErr } = await supabase
  .from('academic_years')
  .update({ accepting_applications: true })
  .eq('ay_code', targetAy);
if (openErr) {
  console.error(
    '[ay-setup PATCH] opening new-current window failed:',
    openErr.message
  );
}
if (prevAy && prevAy !== targetAy) {
  const { error: closeErr } = await supabase
    .from('academic_years')
    .update({ accepting_applications: false })
    .eq('ay_code', prevAy);
  if (closeErr) {
    console.error(
      '[ay-setup PATCH] closing old window failed:',
      closeErr.message
    );
  }
}
```

- [ ] **Step 2: Extend the audit context**

In the same handler, change the `logAction` context from:

```ts
    context: {
      from_ay: prevAy,
      to_ay: targetAy,
    },
```

to:

```ts
    context: {
      from_ay: prevAy,
      to_ay: targetAy,
      accepting_opened: targetAy,
      accepting_closed: prevAy && prevAy !== targetAy ? prevAy : null,
    },
```

(The existing `revalidateTag` calls already cover `targetAy` and `prevAy` — no change there.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add app/api/sis/ay-setup/route.ts
git commit -m "feat(sis): switching active AY opens its window + closes the outgoing one"
```

---

### Task 2: Rebuild the accepting toggle as a descriptive Switch

**Files:**

- Modify: `components/sis/ay-accepting-applications-toggle.tsx` (full rewrite)

Confirm `components/ui/switch.tsx` exists (it does — installed for KD #83). Replace the icon-button with a labeled shadcn `Switch`.

- [ ] **Step 1: Replace the component**

Replace the entire contents of `components/sis/ay-accepting-applications-toggle.tsx` with:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { Switch } from '@/components/ui/switch';

// Per-row "Accepting applications" Switch on the SIS AY-setup table (KD #77).
// Current AY → its live application window; non-current AY → early-bird, which
// the PATCH route enforces as single-select (opening one closes any other open
// upcoming AY). Same endpoint either way; the server decides the semantics.
export function AyAcceptingApplicationsToggle({
  ayCode,
  current,
  isCurrentAy,
}: {
  ayCode: string;
  current: boolean;
  isCurrentAy: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function flip(next: boolean) {
    setBusy(true);
    try {
      const res = await fetch('/api/sis/ay-setup/accepting-applications', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ay_code: ayCode, accepting: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? 'Update failed');
      toast.success(
        next
          ? `${ayCode} is now accepting applications.`
          : `${ayCode} is no longer accepting applications.`
      );
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  const stateHint = current
    ? isCurrentAy
      ? 'Active year — parents can apply.'
      : 'Open for early-bird applications.'
    : 'Closed to new applications.';

  return (
    <div className="flex items-center gap-2" title={stateHint}>
      <Switch
        checked={current}
        disabled={busy}
        onCheckedChange={(v) => flip(Boolean(v))}
        aria-label={`Accepting applications for ${ayCode}`}
      />
      <span className="whitespace-nowrap text-[13px] font-medium text-foreground">
        Accepting applications
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add components/sis/ay-accepting-applications-toggle.tsx
git commit -m "feat(sis): accepting-applications toggle is now a descriptive Switch"
```

---

### Task 3: Render the Switch on all AY rows + feed sections count to the switch dialog

**Files:**

- Modify: `components/sis/ay-setup-data-table.tsx`

Reverse today's current-AY-only restriction (the Switch now appears on every row; the route enforces single-select for non-current rows). Also pass the target's section count into the switch-active dialog for Task 4's warning.

- [ ] **Step 1: Render the toggle on all rows**

In `components/sis/ay-setup-data-table.tsx`, find:

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

Replace with:

```tsx
{
  /* Inline: accepting-applications Switch on every row. Current AY = its
          live window; non-current AY = early-bird (single-select, enforced
          server-side by the accepting-applications route). */
}
<AyAcceptingApplicationsToggle
  ayCode={row.ay_code}
  current={row.accepting_applications}
  isCurrentAy={row.is_current}
/>;
```

(The switch-active dialog is left unchanged — the readiness signal is handled by Task 4's pill treatment, not a per-switch warning.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0 (self-contained — the toggle's props are unchanged).

- [ ] **Step 3: Commit**

```bash
git add components/sis/ay-setup-data-table.tsx
git commit -m "feat(sis): accepting Switch on every AY row (single-select for upcoming)"
```

---

### Task 4: Make the AY Readiness pill obviously signal "setup needed"

**Files:**

- Modify: `components/sis/ay-readiness-pill.tsx`

Reuse the existing readiness pill (KD #109) instead of a switch-dialog warning. When the current AY's setup is incomplete (`complete < total`), give the floating trigger an amber attention treatment + a "Setup needed" headline. The complete state stays calm/mint. Pure styling; no `lib/sis/readiness.ts` change. (`done` is already computed in the component as `readiness.complete === readiness.total`.)

- [ ] **Step 1: Amber icon tile when incomplete**

In `components/sis/ay-readiness-pill.tsx`, find the trigger's icon-tile div:

```tsx
<div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
  <ClipboardCheck className="size-4" />
</div>
```

Replace with:

```tsx
<div
  className={[
    'flex size-10 shrink-0 items-center justify-center rounded-xl text-white',
    done
      ? 'bg-gradient-to-br from-brand-indigo to-brand-navy shadow-brand-tile'
      : 'bg-gradient-to-br from-brand-amber to-brand-amber/80 shadow-brand-tile-amber',
  ].join(' ')}
>
  <ClipboardCheck className="size-4" />
</div>
```

- [ ] **Step 2: "Setup needed" headline when incomplete**

In the same trigger, find the headline block:

```tsx
{
  done ? (
    <p className="mt-0.5 font-serif text-sm font-semibold leading-tight text-brand-mint">
      All steps complete
    </p>
  ) : (
    <p className="mt-0.5 font-serif text-sm font-semibold leading-tight text-foreground">
      {readiness.complete}{' '}
      <span className="font-sans text-[13px] font-normal text-muted-foreground">
        of {readiness.total} complete
      </span>
    </p>
  );
}
```

Replace with:

```tsx
{
  done ? (
    <p className="mt-0.5 font-serif text-sm font-semibold leading-tight text-brand-mint">
      All steps complete
    </p>
  ) : (
    <>
      <p className="mt-0.5 font-serif text-sm font-semibold leading-tight text-brand-amber">
        Setup needed
      </p>
      <p className="font-mono text-[10px] font-medium tabular-nums text-muted-foreground">
        {readiness.complete} of {readiness.total} steps done
      </p>
    </>
  );
}
```

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && npx next build`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add components/sis/ay-readiness-pill.tsx
git commit -m "feat(sis): readiness pill turns amber 'Setup needed' when incomplete"
```

---

### Task 5: Make Admissions read-only; delete the control + unused helper

**Files:**

- Modify: `app/(admissions)/admissions/upcoming/applications/page.tsx` (full rewrite)
- Delete: `components/admissions/early-bird-ay-control.tsx`
- Modify: `lib/academic-year.ts` (remove `listSelectableAcademicYears` + `SelectableAcademicYear` if now unused)

- [ ] **Step 1: Rewrite the page as read-only**

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
  Sparkles,
} from 'lucide-react';

import {
  StudentDataTable,
  type StatusBucketDef,
} from '@/components/sis/student-data-table';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { getUpcomingAcademicYear } from '@/lib/academic-year';
import { listStudents } from '@/lib/sis/queries';
import { getSessionUser } from '@/lib/supabase/server';

// /admissions/upcoming/applications — early-bird pipeline, READ-ONLY (KD #77).
//
// SIS Admin owns which AY is open for applications (KD #48); this page only
// reflects that state. When an upcoming AY is open it shows that year's
// pipeline; otherwise an empty state points to SIS Admin. No open/switch/close
// control lives here.

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

  const upcomingAy = await getUpcomingAcademicYear();

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
          Applications for the upcoming academic year, when one is open for
          early-bird. Which year is open is managed in SIS Admin.
        </p>
      </header>
    </>
  );

  // No upcoming AY open → read-only empty state.
  if (!upcomingAy) {
    return (
      <PageShell>
        {header}
        <Card className="items-center py-12 text-center">
          <CardContent className="flex flex-col items-center gap-4">
            <div className="flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <Sparkles className="size-5" />
            </div>
            <div className="space-y-1">
              <div className="font-serif text-lg font-semibold text-foreground">
                No early-bird year is open
              </div>
              <p className="text-[13px] text-muted-foreground">
                An administrator can open one in SIS Admin → AY Setup. Once a
                year is accepting early applications, they&apos;ll appear here.
              </p>
            </div>
          </CardContent>
        </Card>
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

      {/* Read-only status indicator — control lives in SIS Admin */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant="success"
          className="h-7 gap-1 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em]"
        >
          <Sparkles className="size-3" />
          Early-bird open
        </Badge>
        <span className="text-[13px] text-muted-foreground">
          {upcomingAy.label} ({upcomingAy.ay_code}) · managed in SIS Admin
        </span>
      </div>

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

- [ ] **Step 2: Delete the now-orphaned control component**

```bash
git rm components/admissions/early-bird-ay-control.tsx
```

- [ ] **Step 3: Remove the now-unused query helper**

First confirm nothing else imports it:

Run: `grep -rn "listSelectableAcademicYears\|SelectableAcademicYear" app components lib --include=*.ts --include=*.tsx | grep -v worktrees`
Expected: matches ONLY inside `lib/academic-year.ts` itself (the page no longer imports it). If any other file imports it, STOP and report.

Then, in `lib/academic-year.ts`, delete the appended block (the `SelectableAcademicYear` type + `listSelectableAcademicYears` function added earlier today) — the comment begins `// All AYs with their flags, newest first — for the Admissions early-bird` and runs through the end of that function.

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit && npx next build`
Expected: exit 0; no unresolved import of `EarlyBirdAyControl` or `listSelectableAcademicYears`; route `/admissions/upcoming/applications` compiles.

- [ ] **Step 5: Commit**

```bash
git add app/(admissions)/admissions/upcoming/applications/page.tsx lib/academic-year.ts
git commit -m "refactor(admissions): early-bird page is read-only; control moves to SIS Admin"
```

---

### Task 6: Full verification + manual happy path

- [ ] **Step 1: Run the CI-mirror gate**

Run: `npm run format && npx tsc --noEmit && npm run test && npm run build`
Expected: prettier clean, tsc exit 0, vitest all pass (the existing 5 `early-bird` tests still pass — the helper is unchanged), build exit 0.

- [ ] **Step 2: Manual happy path** (dev server; signed in as superadmin/school_admin; ≥2 non-current AYs exist)

1. SIS Admin → AY Setup: every AY row shows an "Accepting applications" Switch (descriptive label, on/off state).
2. Toggle AY2027's Switch on → it becomes the early-bird year. Toggle AY2028 on → AY2027's Switch flips off (single-select).
3. Admissions → Early-bird applications: shows "Early-bird open · AY2028 · managed in SIS Admin" + the pipeline, with NO open/switch/close control. A plain `admissions`-role user sees the same read-only view.
4. SIS Admin: switch active to AY2028 → its Switch is on (window opened), the previously-current AY's Switch is now off. Admissions early-bird page now shows the empty state (the open year became current, so there's no upcoming open year) unless another upcoming AY is open.
5. Switch active to an under-configured AY → the AY Readiness pill (bottom-right, school_admin+) turns amber with a "Setup needed" headline. Activation is never blocked.

- [ ] **Step 3: Final commit (any tidy-ups)**

```bash
git add -A
git commit -m "test(sis): verify SIS-owned AY application window flow"
```

---

## Self-review notes

- **Spec coverage:** §1 rollover → Task 1; §2 per-row Switch → Tasks 2+3; §3 readiness-pill "setup needed" treatment → Task 4; §4 Admissions read-only + delete control + remove helper → Task 5; §5 reused engine → untouched (verified, no task needed); testing → Task 6.
- **Type consistency:** the toggle's props (`ayCode`, `current`, `isCurrentAy`) are unchanged, so Task 3's call site stays valid with no new props threaded. The Admissions page (Task 5) drops imports of `EarlyBirdAyControl` and `listSelectableAcademicYears`, both removed in the same task. Task 4 touches only `ay-readiness-pill.tsx` (uses the already-computed `done` flag) — no shared types with other tasks.
- **Task independence:** each task is now self-contained and leaves the tree green on its own (the earlier Task 3↔4 prop coupling was removed when the switch-dialog warning was dropped in favor of the readiness pill).
- **Placeholder scan:** none.
