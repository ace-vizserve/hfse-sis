# Evaluation Module Purpose Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip all PTC-related features from the Evaluation module, leaving only the FCA write-up flow that feeds T1–T3 report cards.

**Architecture:** Remove UI tabs, 410 the associated API routes, trim dead lib functions, delete dead lib + component files. DB tables (`evaluation_checklist_items`, `evaluation_checklist_responses`, `evaluation_subject_comments`, `evaluation_ptc_feedback`) are untouched — preserved for future PTC integration. No migration.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase, Tailwind v4, shadcn/ui

---

## File Map

| Action        | File                                                        |
| ------------- | ----------------------------------------------------------- |
| Rewrite → 410 | `app/api/evaluation/checklist-items/route.ts`               |
| Rewrite → 410 | `app/api/evaluation/checklist-items/[id]/route.ts`          |
| Rewrite → 410 | `app/api/evaluation/checklist-responses/route.ts`           |
| Rewrite → 410 | `app/api/evaluation/subject-comments/route.ts`              |
| Rewrite → 410 | `app/api/evaluation/ptc-feedback/route.ts`                  |
| Full rewrite  | `app/(evaluation)/evaluation/sections/[sectionId]/page.tsx` |
| Full rewrite  | `app/(evaluation)/evaluation/sections/page.tsx`             |
| Modify        | `components/evaluation/sections-list.tsx`                   |
| Modify        | `lib/evaluation/queries.ts`                                 |
| Delete        | `lib/evaluation/checklist.ts`                               |
| Delete        | `lib/evaluation/ptc-resolver.ts`                            |
| Delete        | `components/evaluation/checklist-roster-client.tsx`         |
| Delete        | `components/evaluation/ptc-roster-client.tsx`               |
| Delete        | `components/evaluation/rating-selector.tsx`                 |
| Delete        | `components/evaluation/checklist-subject-picker.tsx`        |

---

## Task 1: 410 the 5 API routes

**Files:**

- Rewrite: `app/api/evaluation/checklist-items/route.ts`
- Rewrite: `app/api/evaluation/checklist-items/[id]/route.ts`
- Rewrite: `app/api/evaluation/checklist-responses/route.ts`
- Rewrite: `app/api/evaluation/subject-comments/route.ts`
- Rewrite: `app/api/evaluation/ptc-feedback/route.ts`

- [ ] **Step 1: Replace `app/api/evaluation/checklist-items/route.ts`**

```typescript
import { NextResponse } from 'next/server';

export function POST() {
  return NextResponse.json({ error: 'Gone' }, { status: 410 });
}
```

- [ ] **Step 2: Replace `app/api/evaluation/checklist-items/[id]/route.ts`**

```typescript
import { NextResponse } from 'next/server';

export function PATCH() {
  return NextResponse.json({ error: 'Gone' }, { status: 410 });
}

export function DELETE() {
  return NextResponse.json({ error: 'Gone' }, { status: 410 });
}
```

- [ ] **Step 3: Replace `app/api/evaluation/checklist-responses/route.ts`**

```typescript
import { NextResponse } from 'next/server';

export function PATCH() {
  return NextResponse.json({ error: 'Gone' }, { status: 410 });
}
```

- [ ] **Step 4: Replace `app/api/evaluation/subject-comments/route.ts`**

```typescript
import { NextResponse } from 'next/server';

export function PATCH() {
  return NextResponse.json({ error: 'Gone' }, { status: 410 });
}
```

- [ ] **Step 5: Replace `app/api/evaluation/ptc-feedback/route.ts`**

```typescript
import { NextResponse } from 'next/server';

export function PATCH() {
  return NextResponse.json({ error: 'Gone' }, { status: 410 });
}
```

- [ ] **Step 6: Commit**

```bash
git add app/api/evaluation/checklist-items/route.ts \
        "app/api/evaluation/checklist-items/[id]/route.ts" \
        app/api/evaluation/checklist-responses/route.ts \
        app/api/evaluation/subject-comments/route.ts \
        app/api/evaluation/ptc-feedback/route.ts
git commit -m "feat(evaluation): 410 checklist + PTC API routes — module purpose fix"
```

---

## Task 2: Rewrite the section roster page

**Files:**

- Full rewrite: `app/(evaluation)/evaluation/sections/[sectionId]/page.tsx`

Removes: all checklist and PTC imports, the 3-tab system, PTC deadline banners, subject data loading, `formatPtcRangeForBanner` helper, `isSubjectTeacherOnly` logic. Teacher gate simplified to form_adviser only. `WriteupRosterClient` rendered directly.

- [ ] **Step 1: Replace the entire file**

Write this exact content to `app/(evaluation)/evaluation/sections/[sectionId]/page.tsx`:

```typescript
import { ArrowLeft, Sparkle } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { TermSwitcher } from '@/components/evaluation/term-switcher';
import { WriteupRosterClient } from '@/components/evaluation/writeup-roster-client';
import { Badge } from '@/components/ui/badge';
import { PageShell } from '@/components/ui/page-shell';
import {
  getEvaluationTermConfig,
  getSectionRoster,
  listFormAdviserSectionIds,
} from '@/lib/evaluation/queries';
import { createClient, getSessionUser } from '@/lib/supabase/server';

export default async function EvaluationSectionRosterPage({
  params,
  searchParams,
}: {
  params: Promise<{ sectionId: string }>;
  searchParams: Promise<{ term_id?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (
    sessionUser.role !== 'teacher' &&
    sessionUser.role !== 'registrar' &&
    sessionUser.role !== 'school_admin' &&
    sessionUser.role !== 'superadmin'
  ) {
    redirect('/');
  }

  const { sectionId } = await params;
  const sp = await searchParams;
  const supabase = await createClient();

  const { data: section } = await supabase
    .from('sections')
    .select(
      'id, name, academic_year_id, level:levels(id, label, level_type), academic_year:academic_years(id, ay_code, label)'
    )
    .eq('id', sectionId)
    .single();
  if (!section) notFound();

  // Teachers must be the section's form adviser — subject teachers have no
  // role in this module after the purpose fix (KD evaluation purpose spec).
  if (sessionUser.role === 'teacher') {
    const adviserSet = await listFormAdviserSectionIds(sessionUser.id);
    if (!adviserSet.has(sectionId)) redirect('/evaluation/sections');
  }

  // T1–T3 only; T4 excluded (no FCA comment on the final card, KD #49).
  const { data: termsRaw } = await supabase
    .from('terms')
    .select('id, label, term_number, is_current')
    .eq('academic_year_id', section.academic_year_id)
    .neq('term_number', 4)
    .order('term_number', { ascending: true });

  type TermLite = {
    id: string;
    label: string;
    term_number: number;
    is_current: boolean;
  };
  const terms = (termsRaw ?? []) as TermLite[];
  const defaultTermId =
    sp.term_id ?? terms.find((t) => t.is_current)?.id ?? terms[0]?.id ?? '';
  const selectedTerm = terms.find((t) => t.id === defaultTermId) ?? null;
  if (!selectedTerm) {
    return (
      <PageShell>
        <div className="text-sm text-destructive">
          No T1–T3 term configured for this AY.
        </div>
      </PageShell>
    );
  }

  const [config, roster] = await Promise.all([
    getEvaluationTermConfig(selectedTerm.id),
    getSectionRoster(sectionId, selectedTerm.id),
  ]);

  const level = (
    Array.isArray(section.level) ? section.level[0] : section.level
  ) as { id: string; label: string; level_type: string } | null;
  const ay = (
    Array.isArray(section.academic_year)
      ? section.academic_year[0]
      : section.academic_year
  ) as { ay_code: string; label: string } | null;

  // Teachers are locked until Joann sets the virtue theme; registrar+ can
  // always edit (write-up fields gate per canEdit in WriteupRosterClient).
  const canEdit = sessionUser.role !== 'teacher' || !!config?.virtueTheme;
  const submittedCount = roster.filter((r) => r.submitted).length;
  const totalCount = roster.length;

  return (
    <PageShell>
      <Link
        href={`/evaluation/sections?term_id=${selectedTerm.id}`}
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Sections
      </Link>

      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-3">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Evaluation · Write-ups
          </p>
          <div className="flex flex-wrap items-baseline gap-3">
            <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
              {section.name}
            </h1>
            {level && (
              <Badge
                variant="outline"
                className="h-7 border-border bg-white px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
              >
                {level.label}
              </Badge>
            )}
            {ay && (
              <Badge
                variant="outline"
                className="h-7 border-border bg-white px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
              >
                {ay.ay_code}
              </Badge>
            )}
          </div>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            {submittedCount} of {totalCount} write-ups submitted. Autosaves per
            keystroke; Submit stamps a write-up as finalised (edits stay
            possible).
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 md:items-end">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Term
          </span>
          <TermSwitcher current={defaultTermId} options={terms} />
        </div>
      </header>

      {config?.virtueTheme ? (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
          <div className="flex items-center gap-2">
            <Sparkle className="size-4 text-primary" />
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Virtue theme · {selectedTerm.label}
            </span>
          </div>
          <p className="mt-1 font-serif text-lg font-semibold tracking-tight text-foreground">
            {config.virtueTheme}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Write about each student through the lens of this theme. Appears as
            &ldquo;Form Class Adviser&rsquo;s Comments (HFSE Virtues:{' '}
            {config.virtueTheme})&rdquo; on the {selectedTerm.label} report
            card.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-100">
          <p className="font-medium">
            Virtue theme not set for {selectedTerm.label}.
          </p>
          <p className="mt-1 text-amber-800/80 dark:text-amber-200/80">
            {sessionUser.role === 'teacher' ? (
              <>
                Write-up fields are locked until Joann sets the theme in SIS
                Admin.
              </>
            ) : (
              <>
                Set it in{' '}
                <Link
                  href="/sis/ay-setup"
                  className="font-medium underline underline-offset-2"
                >
                  SIS Admin → AY Setup → Dates
                </Link>
                . Editing stays possible for registrar+ in the meantime.
              </>
            )}
          </p>
        </div>
      )}

      <WriteupRosterClient
        termId={selectedTerm.id}
        sectionId={section.id}
        roster={roster}
        canEdit={canEdit}
      />
    </PageShell>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add "app/(evaluation)/evaluation/sections/[sectionId]/page.tsx"
git commit -m "feat(evaluation): simplify roster page — write-ups only, remove PTC tabs + banners"
```

---

## Task 3: Simplify sections picker + sections list

**Files:**

- Full rewrite: `app/(evaluation)/evaluation/sections/page.tsx`
- Modify: `components/evaluation/sections-list.tsx`

These are updated together because `sections/page.tsx` passes props directly to `EvaluationSectionsList`. Removes: `subjectTeacherSet`, `checklistTopics`, `isSubjectTeacherOnly`, `isAlsoBoth`, `topicCount`. Subject-teacher-only teachers now see an empty state with clear copy. Stats cards always show all 3 (no `isSubjectTeacherOnly` conditional).

- [ ] **Step 1: Replace `components/evaluation/sections-list.tsx`**

Key changes: remove `topicCount`, `isAlsoBoth`, `isSubjectTeacherOnly` from `SectionCardData`; `SectionCard` always renders the adviser view (write-up progress bar); remove subject teacher label badges.

```typescript
'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, SquarePen } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export type SectionCardData = {
  id: string;
  name: string;
  levelId: string | null;
  levelLabel: string | null;
  active: number;
  submitted: number;
};

export type LevelOption = { id: string; code: string; label: string };

export function EvaluationSectionsList({
  sections,
  levels,
  selectedTermId,
}: {
  sections: SectionCardData[];
  levels: LevelOption[];
  selectedTermId: string;
}) {
  const [activeLevelId, setActiveLevelId] = useState<string | null>(null);

  const groups = useMemo(() => {
    const source = activeLevelId
      ? sections.filter((s) => s.levelId === activeLevelId)
      : sections;

    if (activeLevelId) {
      return [
        {
          levelId: activeLevelId,
          levelLabel: levels.find((l) => l.id === activeLevelId)?.label ?? null,
          sections: source,
        },
      ];
    }

    const map = new Map<
      string,
      { levelLabel: string | null; sections: SectionCardData[] }
    >();
    for (const s of source) {
      const key = s.levelId ?? '__none__';
      if (!map.has(key))
        map.set(key, { levelLabel: s.levelLabel, sections: [] });
      map.get(key)!.sections.push(s);
    }
    return Array.from(map.entries()).map(([levelId, g]) => ({ levelId, ...g }));
  }, [sections, levels, activeLevelId]);

  return (
    <div className="space-y-6">
      {levels.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <FilterChip
            active={activeLevelId === null}
            onClick={() => setActiveLevelId(null)}
          >
            All
          </FilterChip>
          {levels.map((l) => (
            <FilterChip
              key={l.id}
              active={activeLevelId === l.id}
              onClick={() =>
                setActiveLevelId(activeLevelId === l.id ? null : l.id)
              }
            >
              {l.code}
            </FilterChip>
          ))}
        </div>
      )}

      {groups.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No sections for this level.
        </p>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <div key={group.levelId ?? 'none'} className="space-y-3">
              <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {group.levelLabel ?? 'Unknown level'}
                <span className="ml-2 text-muted-foreground/50">
                  {group.sections.length}{' '}
                  {group.sections.length === 1 ? 'section' : 'sections'}
                </span>
              </h3>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {group.sections.map((s) => (
                  <SectionCard
                    key={s.id}
                    section={s}
                    selectedTermId={selectedTermId}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SectionCard({
  section: s,
  selectedTermId,
}: {
  section: SectionCardData;
  selectedTermId: string;
}) {
  const complete = s.active > 0 && s.submitted === s.active;
  const started = s.submitted > 0;
  const percent =
    s.active === 0 ? 0 : Math.round((s.submitted / s.active) * 100);

  return (
    <Link
      href={`/evaluation/sections/${s.id}?term_id=${selectedTermId}`}
      className="group"
    >
      <Card className="@container/card h-full gap-3 transition-all group-hover:-translate-y-0.5 group-hover:border-brand-indigo/40 group-hover:shadow-sm">
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            {s.levelLabel ?? 'Unknown level'}
          </CardDescription>
          <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
            {s.name}
          </CardTitle>
          <CardAction>
            <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <SquarePen className="size-4" />
            </div>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-baseline gap-2">
            <span className="font-serif text-2xl font-semibold tabular-nums text-foreground">
              {s.submitted}
            </span>
            <span className="text-sm text-muted-foreground">
              / {s.active} submitted
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full transition-all ${complete ? 'bg-brand-mint' : 'bg-brand-indigo/70'}`}
              style={{ width: `${percent}%` }}
            />
          </div>
        </CardContent>
        <CardFooter>
          {complete ? (
            <Badge className="border-transparent bg-brand-mint text-foreground">
              <CheckCircle2 className="mr-1 size-3" />
              Complete
            </Badge>
          ) : started ? (
            <Badge
              variant="outline"
              className="border-brand-indigo/30 bg-brand-indigo/5 text-brand-indigo"
            >
              In progress · {percent}%
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="border-border bg-muted/40 text-muted-foreground"
            >
              Not started
            </Badge>
          )}
        </CardFooter>
      </Card>
    </Link>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-7 rounded-full px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors ${
        active
          ? 'bg-brand-indigo text-white shadow-sm'
          : 'border border-border bg-card text-muted-foreground hover:border-brand-indigo/40 hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 2: Replace `app/(evaluation)/evaluation/sections/page.tsx`**

Key changes: remove `getChecklistTopicCountByTerm` and `listSubjectTeacherSectionIds` imports; simplify teacher section filtering to adviser-only; remove `checklistTopics` parallel fetch; update hero copy; remove `isSubjectTeacherOnly` conditional on stats grid; remove `topicCount`/`isAlsoBoth`/`isSubjectTeacherOnly` from section props.

```typescript
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  ClipboardCheck,
  GraduationCap,
  LayoutGrid,
  Layers,
  Users,
} from 'lucide-react';

import { createClient, getSessionUser } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EvaluationSectionsList } from '@/components/evaluation/sections-list';
import {
  getWriteupProgressByTerm,
  listFormAdviserSectionIds,
} from '@/lib/evaluation/queries';

type LevelLite = {
  id: string;
  code: string;
  label: string;
  level_type: 'primary' | 'secondary';
};

export default async function EvaluationSectionsPickerPage({
  searchParams,
}: {
  searchParams: Promise<{ term_id?: string; term?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (
    sessionUser.role !== 'teacher' &&
    sessionUser.role !== 'registrar' &&
    sessionUser.role !== 'school_admin' &&
    sessionUser.role !== 'superadmin'
  ) {
    redirect('/');
  }

  const sp = await searchParams;
  const supabase = await createClient();

  const { data: ay } = await supabase
    .from('academic_years')
    .select('id, ay_code, label')
    .eq('is_current', true)
    .single();

  if (!ay) {
    return (
      <PageShell>
        <div className="text-sm text-destructive">
          No current academic year configured.
        </div>
      </PageShell>
    );
  }

  const { data: termsRaw } = await supabase
    .from('terms')
    .select('id, label, term_number, virtue_theme, is_current')
    .eq('academic_year_id', ay.id)
    .order('term_number', { ascending: true });

  type TermRow = {
    id: string;
    label: string;
    term_number: number;
    virtue_theme: string | null;
    is_current: boolean;
  };
  const terms = ((termsRaw ?? []) as TermRow[]).filter(
    (t) => t.term_number !== 4
  );

  const termNumberParam = sp.term ? Number.parseInt(sp.term, 10) : NaN;
  const termIdFromNumber = Number.isFinite(termNumberParam)
    ? terms.find((t) => t.term_number === termNumberParam)?.id
    : undefined;

  const defaultTermId =
    sp.term_id ??
    termIdFromNumber ??
    terms.find((t) => t.is_current)?.id ??
    terms[0]?.id ??
    '';
  const selectedTerm = terms.find((t) => t.id === defaultTermId) ?? null;

  const { data: allSections } = await supabase
    .from('sections')
    .select('id, name, level:levels(id, code, label, level_type)')
    .eq('academic_year_id', ay.id);

  let sections: Array<{ id: string; name: string; level: LevelLite | null }> = (
    (allSections ?? []) as Array<{
      id: string;
      name: string;
      level: LevelLite | LevelLite[] | null;
    }>
  ).map((s) => ({
    id: s.id,
    name: s.name,
    level: Array.isArray(s.level) ? (s.level[0] ?? null) : s.level,
  }));

  // Teachers see only their advisory sections — subject teachers have no
  // role in this module after the purpose fix.
  if (sessionUser.role === 'teacher') {
    const adviserSet = await listFormAdviserSectionIds(sessionUser.id);
    sections = sections.filter((s) => adviserSet.has(s.id));
  }

  const sectionIds = sections.map((s) => s.id);

  const progress = selectedTerm
    ? await getWriteupProgressByTerm(selectedTerm.id, sectionIds)
    : ({} as Record<string, { active_count: number; submitted_count: number }>);

  const sorted = sections.slice().sort((a, b) => {
    const ca = a.level?.code ?? '';
    const cb = b.level?.code ?? '';
    return ca.localeCompare(cb) || a.name.localeCompare(b.name);
  });

  const isTeacher = sessionUser.role === 'teacher';

  const levels = Array.from(
    new Map(
      sorted
        .filter((s) => s.level?.id)
        .map((s) => [
          s.level!.id,
          { id: s.level!.id, code: s.level!.code, label: s.level!.label },
        ])
    ).values()
  );

  const totalActive = Object.values(progress).reduce(
    (n, p) => n + (p?.active_count ?? 0),
    0
  );
  const totalSubmitted = Object.values(progress).reduce(
    (n, p) => n + (p?.submitted_count ?? 0),
    0
  );
  const completePct =
    totalActive === 0 ? 0 : Math.round((totalSubmitted / totalActive) * 100);
  const levelCount = new Set(sorted.map((s) => s.level?.label).filter(Boolean))
    .size;

  return (
    <PageShell>
      <Link
        href="/evaluation"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Evaluation
      </Link>

      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Evaluation · {selectedTerm?.label ?? ay.ay_code}
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            {isTeacher ? 'Your sections.' : 'Sections.'}
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            {isTeacher
              ? 'Your advisory sections. Open one to write student evaluations.'
              : 'Every section in the current academic year. Pick one to view or edit evaluations.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className="h-7 border-border bg-card px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
          >
            {ay.ay_code}
          </Badge>
          {totalActive > 0 && (
            <Badge
              variant="outline"
              className={`h-7 border-border bg-card px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] ${
                completePct === 100
                  ? 'border-brand-mint/50 text-emerald-700'
                  : 'text-muted-foreground'
              }`}
            >
              {completePct}% submitted
            </Badge>
          )}
        </div>
      </header>

      {terms.length > 0 && (
        <Tabs value={defaultTermId}>
          <TabsList>
            {terms.map((t) => (
              <TabsTrigger key={t.id} value={t.id} asChild>
                <Link href={`/evaluation/sections?term_id=${t.id}`}>
                  {t.label}
                  {t.is_current && (
                    <span className="ml-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                      current
                    </span>
                  )}
                </Link>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      {selectedTerm && !selectedTerm.virtue_theme && (
        <div className="flex items-start gap-3 rounded-xl border border-brand-amber/40 bg-brand-amber-light/40 p-4">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-amber/15 text-brand-amber">
            <AlertTriangle className="size-4" />
          </div>
          <div className="min-w-0 space-y-1">
            <p className="font-serif text-sm font-semibold text-foreground">
              Virtue theme not set for {selectedTerm.label}.
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Joann sets the virtue theme in{' '}
              <Link
                href="/sis/ay-setup"
                className="font-medium text-brand-amber underline underline-offset-2"
              >
                SIS Admin → AY Setup → Dates
              </Link>
              . Until it&apos;s set,{' '}
              {isTeacher
                ? 'the write-up fields are locked.'
                : "advisers can't start writing (registrars can still edit if needed)."}
            </p>
          </div>
        </div>
      )}

      {sorted.length > 0 && (
        <div className="@container/main">
          <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-3 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs">
            <SummaryCard
              description={isTeacher ? 'Your sections' : 'Total sections'}
              value={sorted.length.toLocaleString('en-SG')}
              icon={Layers}
              footerTitle={`${levelCount} ${levelCount === 1 ? 'level' : 'levels'}`}
              footerDetail={selectedTerm?.label ?? ay.label}
            />
            <SummaryCard
              description="Active students"
              value={Object.values(progress)
                .reduce((n, p) => n + (p?.active_count ?? 0), 0)
                .toLocaleString('en-SG')}
              icon={Users}
              footerTitle="Currently enrolled"
              footerDetail="Across every section listed"
            />
            <SummaryCard
              description="Write-ups submitted"
              value={`${completePct}%`}
              icon={ClipboardCheck}
              footerTitle={
                totalActive === 0
                  ? '—'
                  : `${totalSubmitted.toLocaleString('en-SG')} of ${totalActive.toLocaleString('en-SG')}`
              }
              footerDetail={
                selectedTerm ? `${selectedTerm.label} progress` : 'No term selected'
              }
            />
          </div>
        </div>
      )}

      {sorted.length === 0 ? (
        <Card className="items-center py-12 text-center">
          <CardContent className="flex flex-col items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo/10 to-brand-indigo/5">
              <GraduationCap className="size-6 text-brand-indigo/60" />
            </div>
            <p className="font-serif text-lg font-semibold text-foreground">
              {isTeacher ? 'No advisory sections.' : 'No sections in this AY.'}
            </p>
            <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
              {isTeacher
                ? 'You have no form adviser assignments. Ask the registrar to assign one in SIS Admin → Sections.'
                : 'Create sections in SIS Admin → Sections for the current academic year.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex items-center gap-2.5">
            <div className="flex size-6 items-center justify-center rounded-lg bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <LayoutGrid className="size-3" />
            </div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {sorted.length} {sorted.length === 1 ? 'section' : 'sections'}
              {selectedTerm && (
                <span className="ml-2 text-muted-foreground/50">
                  · {selectedTerm.label}
                </span>
              )}
            </p>
          </div>

          <EvaluationSectionsList
            levels={levels}
            selectedTermId={selectedTerm?.id ?? ''}
            sections={sorted.map((s) => {
              const p = progress[s.id];
              return {
                id: s.id,
                name: s.name,
                levelId: s.level?.id ?? null,
                levelLabel: s.level?.label ?? null,
                active: p?.active_count ?? 0,
                submitted: p?.submitted_count ?? 0,
              };
            })}
          />
        </>
      )}
    </PageShell>
  );
}

function SummaryCard({
  description,
  value,
  icon: Icon,
  footerTitle,
  footerDetail,
}: {
  description: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  footerTitle: string;
  footerDetail: string;
}) {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {description}
        </CardDescription>
        <CardTitle className="font-serif text-[32px] font-semibold leading-none tabular-nums text-foreground @[240px]/card:text-[38px]">
          {value}
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Icon className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardFooter className="flex-col items-start gap-1 text-sm">
        <p className="font-medium text-foreground">{footerTitle}</p>
        <p className="text-xs text-muted-foreground">{footerDetail}</p>
      </CardFooter>
    </Card>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add "app/(evaluation)/evaluation/sections/page.tsx" \
        components/evaluation/sections-list.tsx
git commit -m "feat(evaluation): simplify sections picker — adviser-only, remove topic count"
```

---

## Task 4: Trim `lib/evaluation/queries.ts`

**Files:**

- Modify: `lib/evaluation/queries.ts`

Remove `getChecklistTopicCountByTerm` (lines 220–239) and `listSubjectTeacherSectionIds` (lines 205–215). The remaining 4 functions stay untouched.

- [ ] **Step 1: Delete `listSubjectTeacherSectionIds` from `lib/evaluation/queries.ts`**

Remove lines 203–215 (the function + its leading comment):

```typescript
// DELETE this block:
// Which sections does this user teach a subject in? Returns the section_id set.
// Scoped to `teacher_assignments.role='subject_teacher'`.
export async function listSubjectTeacherSectionIds(
  userId: string
): Promise<Set<string>> {
  const service = createServiceClient();
  const { data } = await service
    .from('teacher_assignments')
    .select('section_id')
    .eq('teacher_user_id', userId)
    .eq('role', 'subject_teacher');
  return new Set((data ?? []).map((r) => r.section_id as string));
}
```

- [ ] **Step 2: Delete `getChecklistTopicCountByTerm` from `lib/evaluation/queries.ts`**

Remove lines 217–239 (the function + its leading comment):

```typescript
// DELETE this block:
// Total checklist topic count per section for the given term. Used by the
// sections picker to show setup progress on subject-teacher cards.
// Topics are scoped per section (migration 061 / KD #110).
export async function getChecklistTopicCountByTerm(
  termId: string,
  sections: Array<{ id: string }>
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (sections.length === 0) return out;

  const sectionIds = sections.map((s) => s.id);
  const service = createServiceClient();
  const { data } = await service
    .from('evaluation_checklist_items')
    .select('section_id')
    .eq('term_id', termId)
    .in('section_id', sectionIds);

  for (const row of (data ?? []) as Array<{ section_id: string }>) {
    out[row.section_id] = (out[row.section_id] ?? 0) + 1;
  }
  return out;
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/evaluation/queries.ts
git commit -m "feat(evaluation): remove checklist + subject-teacher queries from lib"
```

---

## Task 5: Delete dead files

Before deleting, grep to confirm zero remaining imports. If any unexpected caller exists, investigate before deleting.

- [ ] **Step 1: Verify `lib/evaluation/checklist.ts` has no remaining callers**

```bash
grep -r "evaluation/checklist" app/ components/ lib/ --include="*.ts" --include="*.tsx"
```

Expected: 0 results. If any appear, open that file and remove the import before proceeding.

- [ ] **Step 2: Verify `lib/evaluation/ptc-resolver.ts` has no remaining callers**

```bash
grep -r "ptc-resolver" app/ components/ lib/ --include="*.ts" --include="*.tsx"
```

Expected: 0 results.

- [ ] **Step 3: Verify the 4 components have no remaining imports**

```bash
grep -r "checklist-roster-client\|ptc-roster-client\|rating-selector\|checklist-subject-picker" app/ components/ --include="*.tsx" --include="*.ts"
```

Expected: 0 results.

- [ ] **Step 4: Delete the files**

```bash
rm lib/evaluation/checklist.ts
rm lib/evaluation/ptc-resolver.ts
rm components/evaluation/checklist-roster-client.tsx
rm components/evaluation/ptc-roster-client.tsx
rm components/evaluation/rating-selector.tsx
rm components/evaluation/checklist-subject-picker.tsx
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(evaluation): delete dead checklist + PTC lib files and components"
```

---

## Task 6: Build verification

- [ ] **Step 1: Run the build**

```bash
npx next build
```

Expected: clean compile, 0 TypeScript errors, 0 missing module errors.

- [ ] **Step 2: Run tests**

```bash
npx vitest run
```

Expected: all 77 tests still passing (no evaluation checklist tests existed — the removed code had no test coverage).

- [ ] **Step 3: Fix any build errors then commit**

If `npx next build` surfaces TypeScript errors (e.g. a missed import somewhere), fix them and commit:

```bash
git add <fixed files>
git commit -m "fix(evaluation): resolve build errors after PTC removal"
```

- [ ] **Step 4: Final commit if clean**

If no fixes were needed, the build passing is the validation. No extra commit required.
