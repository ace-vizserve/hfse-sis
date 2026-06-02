# Staff View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/sis/admin/staff` — a school-wide teacher assignment manager showing each teacher's FCA section and subject load for the current AY, with a slide-over editor to add/remove assignments without visiting each section individually.

**Architecture:** New RSC page in the SIS admin group. A new `lib/sis/staff.ts` loader joins `teacher_assignments → sections → subjects` and merges with `getTeacherList()`, cached on the existing `sis:${ayCode}` tag so any assignment mutation automatically invalidates it. A new `GET /api/teacher-assignments/by-teacher` route lazy-fetches a single teacher's state (plus pickers) when their slide-over opens. Client components use shadcn `<Sheet>`, `<Select>`, and the `<DataTable>` shell. All mutations go through the existing POST/DELETE assignment routes — no new write routes, no migrations.

**Tech Stack:** Next.js 16 App Router, Supabase service client, `unstable_cache` (`sis:${ayCode}` tag), shadcn Sheet/Select/DataTable, `@tanstack/react-table`, `sonner` toast, `lucide-react`.

---

## Codebase context (read before implementing)

- **Existing assignment routes** at `app/api/teacher-assignments/route.ts` (POST) and `app/api/teacher-assignments/[id]/route.ts` (DELETE) — do not touch these.
- **`lib/auth/staff-list.ts`** — `getTeacherList({ excludeDisabled: false })` returns `StaffMember[]` (`{ id, email, name, disabled }`), role=`teacher` only, 5-min cache.
- **`lib/sis/dashboard.ts`** — `getSectionStaffingCoverage(ayCode)` returns `{ total, withAdviser }` — reuse this for the KPI strip; don't duplicate the query.
- **RSC page pattern** — follow `app/(sis)/sis/admin/approvers/page.tsx`: `PageShell` + `ArrowLeft` back link + serif h1 + description + client component.
- **DataTable shell** — `DataTable` from `@/components/ui/data-table` has no `onRowClick` prop. Use an action column (`ChevronRight` button) to open the sheet.
- **Current AY query** — `await createClient().from('academic_years').select('id, ay_code').eq('is_current', true).single()` (pattern from `app/(sis)/sis/sections/page.tsx:53-59`).
- **Audit** — all mutations already log `assignment.create` / `assignment.delete` via the existing routes; no new audit actions needed.
- **Design system** — tokens only from `app/globals.css`; serif h1; `font-mono text-[11px] uppercase tracking-[0.14em]` for eyebrows; `border-hairline` for subtle borders. Read `docs/context/09-design-system.md` before writing any JSX.

---

## Task 1 — Data loader: `lib/sis/staff.ts`

**Files:**

- Create: `lib/sis/staff.ts`

- [ ] **Step 1: Create the file with types and the uncached loader**

```typescript
// lib/sis/staff.ts
import { unstable_cache } from 'next/cache';

import { getTeacherList } from '@/lib/auth/staff-list';
import { createServiceClient } from '@/lib/supabase/service';

export type StaffSubjectAssignment = {
  assignmentId: string;
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  sectionId: string;
  sectionName: string;
  levelCode: string;
};

export type StaffRow = {
  userId: string;
  email: string;
  name: string;
  disabled: boolean;
  fcaSection: { id: string; name: string; levelCode: string } | null;
  subjectAssignments: StaffSubjectAssignment[];
};

type RawSection = {
  id: string;
  name: string;
  levels: { code: string } | { code: string }[] | null;
};

type RawAssignment = {
  id: string;
  teacher_user_id: string;
  section_id: string;
  subject_id: string | null;
  role: string;
  subjects: { code: string; name: string } | null;
};

async function loadStaffAssignmentsUncached(
  ayCode: string
): Promise<StaffRow[]> {
  const service = createServiceClient();

  const { data: ayRow } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode)
    .maybeSingle();
  if (!ayRow) return [];

  const { data: sectionRows } = await service
    .from('sections')
    .select('id, name, levels(code)')
    .eq('academic_year_id', (ayRow as { id: string }).id);

  const sections = (sectionRows ?? []) as RawSection[];
  const sectionMeta = new Map(
    sections.map((s) => {
      const levelCode = Array.isArray(s.levels)
        ? (s.levels[0]?.code ?? '')
        : (s.levels?.code ?? '');
      return [s.id, { id: s.id, name: s.name, levelCode }];
    })
  );

  if (sectionMeta.size === 0) {
    const teachers = await getTeacherList({ excludeDisabled: false });
    return teachers.map((t) => ({
      userId: t.id,
      email: t.email,
      name: t.name,
      disabled: t.disabled,
      fcaSection: null,
      subjectAssignments: [],
    }));
  }

  const sectionIds = [...sectionMeta.keys()];

  const { data: assignmentRows } = await service
    .from('teacher_assignments')
    .select(
      'id, teacher_user_id, section_id, subject_id, role, subjects(code, name)'
    )
    .in('section_id', sectionIds);

  const assignments = (assignmentRows ?? []) as RawAssignment[];

  const teachers = await getTeacherList({ excludeDisabled: false });

  return teachers.map((teacher) => {
    const mine = assignments.filter((a) => a.teacher_user_id === teacher.id);

    const fcaRow = mine.find((a) => a.role === 'form_adviser');
    const fcaSec = fcaRow ? sectionMeta.get(fcaRow.section_id) : undefined;

    const subjectAssignments: StaffSubjectAssignment[] = mine
      .filter((a) => a.role === 'subject_teacher')
      .map((a) => {
        const sec = sectionMeta.get(a.section_id);
        return {
          assignmentId: a.id,
          subjectId: a.subject_id ?? '',
          subjectCode: a.subjects?.code ?? '',
          subjectName: a.subjects?.name ?? '',
          sectionId: a.section_id,
          sectionName: sec?.name ?? '',
          levelCode: sec?.levelCode ?? '',
        };
      });

    return {
      userId: teacher.id,
      email: teacher.email,
      name: teacher.name,
      disabled: teacher.disabled,
      fcaSection: fcaSec
        ? { id: fcaSec.id, name: fcaSec.name, levelCode: fcaSec.levelCode }
        : null,
      subjectAssignments,
    };
  });
}

export function loadStaffAssignments(ayCode: string): Promise<StaffRow[]> {
  return unstable_cache(
    loadStaffAssignmentsUncached,
    ['sis', 'staff-assignments', ayCode],
    { tags: [`sis:${ayCode}`], revalidate: 60 }
  )(ayCode);
}
```

- [ ] **Step 2: Verify TypeScript**

```powershell
npx tsc --noEmit
```

Expected: no new errors (zero errors relating to `lib/sis/staff.ts`).

- [ ] **Step 3: Commit**

```powershell
git add lib/sis/staff.ts
git commit -m "feat(sis): loadStaffAssignments loader for staff view"
```

---

## Task 2 — API route: `app/api/teacher-assignments/by-teacher/route.ts`

**Files:**

- Create: `app/api/teacher-assignments/by-teacher/route.ts`

This route lazy-fetches a single teacher's FCA + subject assignments for the current AY, plus all sections and subjects needed to populate the slide-over pickers. It's called client-side when the sheet opens — not pre-fetched for every row.

- [ ] **Step 1: Create the route**

```typescript
// app/api/teacher-assignments/by-teacher/route.ts
import { NextResponse, type NextRequest } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { createServiceClient } from '@/lib/supabase/service';

type RawSection = {
  id: string;
  name: string;
  levels: { code: string } | { code: string }[] | null;
};

type RawAssignment = {
  id: string;
  section_id: string;
  subject_id: string | null;
  role: string;
  subjects: { code: string; name: string } | null;
  sections: { name: string } | null;
};

// GET /api/teacher-assignments/by-teacher?teacherId=<uuid>&ayCode=AY2026
// Returns the teacher's current assignments + all sections + all subjects
// for the current AY. Used by the StaffAssignmentSheet to populate pickers.
export async function GET(request: NextRequest) {
  const auth = await requireRole(['registrar', 'school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const teacherId = request.nextUrl.searchParams.get('teacherId');
  const ayCode = request.nextUrl.searchParams.get('ayCode');
  if (!teacherId || !ayCode) {
    return NextResponse.json(
      { error: 'teacherId and ayCode are required' },
      { status: 400 }
    );
  }

  const service = createServiceClient();

  const { data: ayRow } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode)
    .maybeSingle();
  if (!ayRow) {
    return NextResponse.json({ error: 'AY not found' }, { status: 404 });
  }
  const ayId = (ayRow as { id: string }).id;

  // All sections for this AY (needed for pickers)
  const { data: sectionRows } = await service
    .from('sections')
    .select('id, name, levels(code)')
    .eq('academic_year_id', ayId)
    .order('name');

  const allSections = (sectionRows ?? []).map((s) => {
    const raw = s as RawSection;
    const levelCode = Array.isArray(raw.levels)
      ? (raw.levels[0]?.code ?? '')
      : (raw.levels?.code ?? '');
    return { id: raw.id, name: raw.name, levelCode };
  });

  const sectionIds = allSections.map((s) => s.id);

  // All subjects (needed for picker)
  const { data: subjectRows } = await service
    .from('subjects')
    .select('id, code, name')
    .order('code');
  const allSubjects = (subjectRows ?? []) as Array<{
    id: string;
    code: string;
    name: string;
  }>;

  // This teacher's assignments in this AY
  const { data: assignmentRows } = await service
    .from('teacher_assignments')
    .select(
      'id, section_id, subject_id, role, subjects(code, name), sections(name)'
    )
    .eq('teacher_user_id', teacherId)
    .in(
      'section_id',
      sectionIds.length > 0
        ? sectionIds
        : ['00000000-0000-0000-0000-000000000000']
    );

  const assignments = (assignmentRows ?? []) as RawAssignment[];

  const fcaRaw = assignments.find((a) => a.role === 'form_adviser');
  const fcaAssignment = fcaRaw
    ? {
        id: fcaRaw.id,
        sectionId: fcaRaw.section_id,
        sectionName: fcaRaw.sections?.name ?? '',
      }
    : null;

  const subjectAssignments = assignments
    .filter((a) => a.role === 'subject_teacher')
    .map((a) => ({
      id: a.id,
      subjectId: a.subject_id ?? '',
      subjectCode: a.subjects?.code ?? '',
      subjectName: a.subjects?.name ?? '',
      sectionId: a.section_id,
      sectionName: a.sections?.name ?? '',
    }));

  return NextResponse.json({
    fcaAssignment,
    subjectAssignments,
    allSections,
    allSubjects,
  });
}
```

- [ ] **Step 2: Verify TypeScript**

```powershell
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```powershell
git add app/api/teacher-assignments/by-teacher/route.ts
git commit -m "feat(sis): GET /api/teacher-assignments/by-teacher for staff sheet"
```

---

## Task 3 — Slide-over: `components/sis/staff-assignment-sheet.tsx`

**Files:**

- Create: `components/sis/staff-assignment-sheet.tsx`

This is a `'use client'` component. When opened it fetches assignments + pickers from the Task 2 route. FCA changes fire immediately on `<Select>` change. Subject rows can be individually removed; new ones added via an inline add form.

- [ ] **Step 1: Create the component**

```typescript
// components/sis/staff-assignment-sheet.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

// ── Types ────────────────────────────────────────────────────────────────────

type Section = { id: string; name: string; levelCode: string };
type Subject = { id: string; code: string; name: string };

type FcaAssignment = {
  id: string;
  sectionId: string;
  sectionName: string;
} | null;

type SubjectAssignment = {
  id: string;
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  sectionId: string;
  sectionName: string;
};

type SheetData = {
  fcaAssignment: FcaAssignment;
  subjectAssignments: SubjectAssignment[];
  allSections: Section[];
  allSubjects: Subject[];
};

export type StaffSheetTeacher = {
  userId: string;
  name: string;
  email: string;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function groupByLevel(sections: Section[]): Record<string, Section[]> {
  return sections.reduce<Record<string, Section[]>>((acc, s) => {
    (acc[s.levelCode] ??= []).push(s);
    return acc;
  }, {});
}

// ── Component ────────────────────────────────────────────────────────────────

export function StaffAssignmentSheet({
  teacher,
  ayCode,
  open,
  onOpenChange,
}: {
  teacher: StaffSheetTeacher | null;
  ayCode: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [data, setData] = useState<SheetData | null>(null);
  const [loading, setLoading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [newSubjectId, setNewSubjectId] = useState('');
  const [newSectionId, setNewSectionId] = useState('');

  // Fetch on open; reset on close.
  useEffect(() => {
    if (!open || !teacher) {
      setData(null);
      setNewSubjectId('');
      setNewSectionId('');
      return;
    }
    setLoading(true);
    fetch(
      `/api/teacher-assignments/by-teacher?teacherId=${encodeURIComponent(teacher.userId)}&ayCode=${encodeURIComponent(ayCode)}`
    )
      .then((r) => r.json())
      .then((json) => setData(json as SheetData))
      .catch(() => toast.error('Failed to load assignments'))
      .finally(() => setLoading(false));
  }, [open, teacher, ayCode]);

  // ── Mutations ──────────────────────────────────────────────────────────────

  async function handleFcaChange(sectionId: string) {
    if (!teacher || !data) return;
    setMutating(true);
    try {
      // Remove existing FCA if present.
      if (data.fcaAssignment) {
        const res = await fetch(
          `/api/teacher-assignments/${data.fcaAssignment.id}`,
          { method: 'DELETE' }
        );
        if (!res.ok) {
          const e = (await res.json()) as { error?: string };
          toast.error(e.error ?? 'Failed to remove existing FCA');
          return;
        }
      }

      if (sectionId === '__none__') {
        setData((d) => (d ? { ...d, fcaAssignment: null } : d));
        toast.success('FCA assignment cleared');
        router.refresh();
        return;
      }

      const res = await fetch('/api/teacher-assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teacher_user_id: teacher.userId,
          section_id: sectionId,
          role: 'form_adviser',
        }),
      });
      const json = (await res.json()) as {
        assignment?: { id: string };
        error?: string;
      };
      if (!res.ok) {
        toast.error(json.error ?? 'Failed to save FCA');
        return;
      }
      const sectionName =
        data.allSections.find((s) => s.id === sectionId)?.name ?? '';
      setData((d) =>
        d
          ? {
              ...d,
              fcaAssignment: {
                id: json.assignment!.id,
                sectionId,
                sectionName,
              },
            }
          : d
      );
      toast.success('FCA assignment saved');
      router.refresh();
    } finally {
      setMutating(false);
    }
  }

  async function handleRemoveSubject(assignmentId: string) {
    setMutating(true);
    try {
      const res = await fetch(`/api/teacher-assignments/${assignmentId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const e = (await res.json()) as { error?: string };
        toast.error(e.error ?? 'Failed to remove assignment');
        return;
      }
      setData((d) =>
        d
          ? {
              ...d,
              subjectAssignments: d.subjectAssignments.filter(
                (a) => a.id !== assignmentId
              ),
            }
          : d
      );
      router.refresh();
    } finally {
      setMutating(false);
    }
  }

  async function handleAddSubject() {
    if (!teacher || !data || !newSubjectId || !newSectionId) return;
    setMutating(true);
    try {
      const res = await fetch('/api/teacher-assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teacher_user_id: teacher.userId,
          section_id: newSectionId,
          subject_id: newSubjectId,
          role: 'subject_teacher',
        }),
      });
      const json = (await res.json()) as {
        assignment?: { id: string };
        error?: string;
      };
      if (!res.ok) {
        toast.error(json.error ?? 'Failed to add subject');
        return;
      }
      const subject = data.allSubjects.find((s) => s.id === newSubjectId);
      const section = data.allSections.find((s) => s.id === newSectionId);
      setData((d) =>
        d
          ? {
              ...d,
              subjectAssignments: [
                ...d.subjectAssignments,
                {
                  id: json.assignment!.id,
                  subjectId: newSubjectId,
                  subjectCode: subject?.code ?? '',
                  subjectName: subject?.name ?? '',
                  sectionId: newSectionId,
                  sectionName: section?.name ?? '',
                },
              ],
            }
          : d
      );
      setNewSubjectId('');
      setNewSectionId('');
      toast.success('Subject assignment added');
      router.refresh();
    } finally {
      setMutating(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const sectionsByLevel = data ? groupByLevel(data.allSections) : {};
  const levelCodes = Object.keys(sectionsByLevel).sort();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="font-serif text-xl font-semibold tracking-tight">
            {teacher?.name ?? '—'}
          </SheetTitle>
          <SheetDescription className="font-mono text-[11px]">
            {teacher?.email}
          </SheetDescription>
        </SheetHeader>

        {loading && (
          <div className="flex flex-1 items-center justify-center py-12">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && data && (
          <div className="mt-6 space-y-8">
            {/* FCA Section -------------------------------------------------- */}
            <section className="space-y-3">
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Form Class Adviser
              </p>
              <Select
                value={data.fcaAssignment?.sectionId ?? '__none__'}
                onValueChange={(v) => void handleFcaChange(v)}
                disabled={mutating}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">
                    <span className="text-muted-foreground">None</span>
                  </SelectItem>
                  {levelCodes.map((lc) => (
                    <SelectGroup key={lc}>
                      <SelectLabel>{lc}</SelectLabel>
                      {sectionsByLevel[lc]!.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </section>

            <Separator />

            {/* Subject Teaching ---------------------------------------------- */}
            <section className="space-y-3">
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Subject Teaching
              </p>

              {data.subjectAssignments.length === 0 && (
                <p className="text-sm text-muted-foreground">No subjects assigned.</p>
              )}

              <ul className="space-y-2">
                {data.subjectAssignments.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-hairline px-3 py-2"
                  >
                    <span className="text-sm">
                      <span className="font-mono text-xs font-semibold text-brand-indigo-deep">
                        {a.subjectCode}
                      </span>
                      <span className="mx-1.5 text-muted-foreground">·</span>
                      {a.sectionName}
                    </span>
                    <button
                      type="button"
                      disabled={mutating}
                      onClick={() => void handleRemoveSubject(a.id)}
                      aria-label={`Remove ${a.subjectCode} in ${a.sectionName}`}
                      className="text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
                    >
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>

              {/* Add form */}
              <div className="flex items-center gap-2 pt-1">
                <Select
                  value={newSubjectId}
                  onValueChange={setNewSubjectId}
                  disabled={mutating}
                >
                  <SelectTrigger className="flex-1 text-sm">
                    <SelectValue placeholder="Subject" />
                  </SelectTrigger>
                  <SelectContent>
                    {data.allSubjects.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.code} — {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={newSectionId}
                  onValueChange={setNewSectionId}
                  disabled={mutating}
                >
                  <SelectTrigger className="flex-1 text-sm">
                    <SelectValue placeholder="Section" />
                  </SelectTrigger>
                  <SelectContent>
                    {levelCodes.map((lc) => (
                      <SelectGroup key={lc}>
                        <SelectLabel>{lc}</SelectLabel>
                        {sectionsByLevel[lc]!.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>

                <Button
                  size="icon"
                  variant="outline"
                  disabled={mutating || !newSubjectId || !newSectionId}
                  onClick={() => void handleAddSubject()}
                  aria-label="Add subject assignment"
                >
                  {mutating ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                </Button>
              </div>
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```powershell
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```powershell
git add components/sis/staff-assignment-sheet.tsx
git commit -m "feat(sis): StaffAssignmentSheet slide-over editor"
```

---

## Task 4 — Table: `components/sis/staff-table.tsx`

**Files:**

- Create: `components/sis/staff-table.tsx`

`'use client'` component. Wraps `<DataTable>` with a custom toolbar (name search + FCA filter chips + disabled toggle) and manages the sheet open state. Uses a `ChevronRight` action column to open the sheet since `DataTable` has no `onRowClick` prop.

- [ ] **Step 1: Create the component**

```typescript
// components/sis/staff-table.tsx
'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { ChevronRight, Search, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import {
  StaffAssignmentSheet,
  type StaffSheetTeacher,
} from '@/components/sis/staff-assignment-sheet';
import type { StaffRow } from '@/lib/sis/staff';

type FcaFilter = 'all' | 'has-fca' | 'no-fca';

export function StaffTable({
  rows,
  ayCode,
}: {
  rows: StaffRow[];
  ayCode: string;
}) {
  const [nameSearch, setNameSearch] = useState('');
  const [fcaFilter, setFcaFilter] = useState<FcaFilter>('all');
  const [showDisabled, setShowDisabled] = useState(false);
  const [selectedTeacher, setSelectedTeacher] =
    useState<StaffSheetTeacher | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  function openSheet(row: StaffRow) {
    if (row.disabled) return;
    setSelectedTeacher({ userId: row.userId, name: row.name, email: row.email });
    setSheetOpen(true);
  }

  // Counts for filter chips (from active/enabled teachers only).
  const chipCounts = useMemo(() => {
    const active = rows.filter((r) => !r.disabled);
    return {
      all: active.length,
      hasFca: active.filter((r) => r.fcaSection !== null).length,
      noFca: active.filter((r) => r.fcaSection === null).length,
    };
  }, [rows]);

  const filteredRows = useMemo(() => {
    let r = showDisabled ? rows : rows.filter((row) => !row.disabled);
    if (nameSearch) {
      const q = nameSearch.toLowerCase();
      r = r.filter(
        (row) =>
          row.name.toLowerCase().includes(q) ||
          row.email.toLowerCase().includes(q)
      );
    }
    if (fcaFilter === 'has-fca') r = r.filter((row) => row.fcaSection !== null);
    if (fcaFilter === 'no-fca') r = r.filter((row) => row.fcaSection === null);
    return r;
  }, [rows, nameSearch, fcaFilter, showDisabled]);

  const columns: ColumnDef<StaffRow>[] = [
    {
      accessorKey: 'name',
      header: 'Teacher',
      cell: ({ row }) => (
        <div>
          <p
            className={
              row.original.disabled
                ? 'text-sm text-muted-foreground line-through'
                : 'text-sm font-medium text-foreground'
            }
          >
            {row.original.name}
          </p>
          <p className="text-xs text-muted-foreground">{row.original.email}</p>
        </div>
      ),
    },
    {
      id: 'fcaSection',
      header: 'FCA Section',
      cell: ({ row }) => {
        const fca = row.original.fcaSection;
        if (!fca)
          return <span className="text-sm text-muted-foreground">—</span>;
        return <Badge variant="secondary">{fca.name}</Badge>;
      },
    },
    {
      id: 'subjectAssignments',
      header: 'Subjects Taught',
      cell: ({ row }) => {
        const subs = row.original.subjectAssignments;
        if (subs.length === 0)
          return <span className="text-sm text-muted-foreground">—</span>;
        const visible = subs.slice(0, 3);
        const extra = subs.length - 3;
        return (
          <div className="flex flex-wrap gap-1">
            {visible.map((a) => (
              <span
                key={a.assignmentId}
                className="inline-flex items-center rounded-md border border-hairline bg-muted px-2 py-0.5 font-mono text-[11px]"
              >
                {a.subjectCode}&thinsp;·&thinsp;{a.sectionName}
              </span>
            ))}
            {extra > 0 && (
              <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                +{extra} more
              </span>
            )}
          </div>
        );
      },
    },
    {
      id: 'load',
      header: 'Load',
      cell: ({ row }) => {
        const fca = row.original.fcaSection ? '1 FCA' : null;
        const n = row.original.subjectAssignments.length;
        const subs = n > 0 ? `${n} subject${n === 1 ? '' : 's'}` : null;
        const parts = [fca, subs].filter(Boolean).join(' + ');
        return (
          <span className="font-mono text-xs text-muted-foreground">
            {parts || 'No assignments'}
          </span>
        );
      },
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          disabled={row.original.disabled}
          onClick={() => openSheet(row.original)}
          aria-label={`Edit assignments for ${row.original.name}`}
        >
          <ChevronRight className="size-4" />
        </Button>
      ),
    },
  ];

  const chipDefs: { key: FcaFilter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: chipCounts.all },
    { key: 'has-fca', label: 'Has FCA', count: chipCounts.hasFca },
    { key: 'no-fca', label: 'No FCA', count: chipCounts.noFca },
  ];

  return (
    <>
      <div className="space-y-3">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search teachers..."
              value={nameSearch}
              onChange={(e) => setNameSearch(e.target.value)}
              className="h-8 w-64 pl-8 text-sm"
            />
            {nameSearch && (
              <button
                type="button"
                onClick={() => setNameSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {chipDefs.map(({ key, label, count }) => (
              <button
                key={key}
                type="button"
                onClick={() => setFcaFilter(key)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  fcaFilter === key
                    ? 'bg-foreground text-background'
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                {label} {count}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setShowDisabled((v) => !v)}
            className="ml-auto text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            {showDisabled ? 'Hide disabled accounts' : 'Show disabled accounts'}
          </button>
        </div>

        <DataTable
          columns={columns}
          data={filteredRows}
          getRowId={(row) => row.userId}
          hidePagination={filteredRows.length <= 20}
          emptyState={{ title: 'No teachers found', body: 'Add staff accounts via Users.' }}
        />
      </div>

      <StaffAssignmentSheet
        teacher={selectedTeacher}
        ayCode={ayCode}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />
    </>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```powershell
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```powershell
git add components/sis/staff-table.tsx
git commit -m "feat(sis): StaffTable with search, FCA filter chips, and sheet trigger"
```

---

## Task 5 — RSC page, sidebar entry, and verification

**Files:**

- Create: `app/(sis)/sis/admin/staff/page.tsx`
- Modify: `lib/sidebar/registry.ts`

- [ ] **Step 1: Create the RSC page**

```typescript
// app/(sis)/sis/admin/staff/page.tsx
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { StaffTable } from '@/components/sis/staff-table';
import { PageShell } from '@/components/ui/page-shell';
import { getSectionStaffingCoverage } from '@/lib/sis/dashboard';
import { loadStaffAssignments } from '@/lib/sis/staff';
import { createClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/supabase/server';

export default async function StaffPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (
    sessionUser.role !== 'registrar' &&
    sessionUser.role !== 'school_admin' &&
    sessionUser.role !== 'superadmin'
  ) {
    redirect('/sis');
  }

  const supabase = await createClient();
  const { data: ayRow } = await supabase
    .from('academic_years')
    .select('ay_code')
    .eq('is_current', true)
    .single();
  const ayCode = (ayRow as { ay_code: string } | null)?.ay_code;
  if (!ayCode) redirect('/sis');

  const [rows, coverage] = await Promise.all([
    loadStaffAssignments(ayCode),
    getSectionStaffingCoverage(ayCode),
  ]);

  const totalTeachers = rows.filter((r) => !r.disabled).length;
  const withFca = coverage.withAdviser;
  const sectionsMissingFca = coverage.total - coverage.withAdviser;

  return (
    <PageShell>
      <Link
        href="/sis"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        SIS Admin
      </Link>

      <header className="space-y-3">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          SIS Admin · Staff
        </p>
        <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
          Staff assignments.
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Manage form class adviser and subject teaching assignments for{' '}
          {ayCode}. Click a teacher's row to edit their assignments.
        </p>
      </header>

      {/* KPI strip */}
      <div className="flex flex-wrap gap-3">
        <div className="rounded-xl border border-hairline bg-card px-4 py-3">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Teachers
          </p>
          <p className="text-2xl font-semibold tabular-nums text-foreground">
            {totalTeachers}
          </p>
        </div>
        <div className="rounded-xl border border-hairline bg-card px-4 py-3">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            With FCA
          </p>
          <p className="text-2xl font-semibold tabular-nums text-foreground">
            {withFca}
          </p>
        </div>
        <div
          className={`rounded-xl border px-4 py-3 ${
            sectionsMissingFca > 0
              ? 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30'
              : 'border-hairline bg-card'
          }`}
        >
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Sections missing FCA
          </p>
          <p
            className={`text-2xl font-semibold tabular-nums ${
              sectionsMissingFca > 0 ? 'text-amber-600' : 'text-foreground'
            }`}
          >
            {sectionsMissingFca}
          </p>
        </div>
      </div>

      <StaffTable rows={rows} ayCode={ayCode} />
    </PageShell>
  );
}
```

- [ ] **Step 2: Add sidebar entry**

Open `lib/sidebar/registry.ts`. Find the `iconByHref` block for the `sis` module. It currently looks like:

```typescript
iconByHref: {
  '/sis': LayoutDashboard,
  '/sis/ay-setup': CalendarCog,
  '/sis/calendar': CalendarDays,
  '/sis/sections': LayoutGrid,
  '/sis/admin/discount-codes': Tag,
  '/sis/admin/subjects': Scale,
  '/sis/admin/approvers': ShieldCheck,
  '/sis/admin/template': Copy,
  '/sis/admin/school-config': Building2,
  '/sis/admin/users': UserCog,
  '/sis/admin/settings': Settings2,
  '/sis/sync-students': Database,
  '/sis/audit-log': History,
},
```

Add `'/sis/admin/staff': Users,` after `/sis/admin/approvers`:

```typescript
iconByHref: {
  '/sis': LayoutDashboard,
  '/sis/ay-setup': CalendarCog,
  '/sis/calendar': CalendarDays,
  '/sis/sections': LayoutGrid,
  '/sis/admin/discount-codes': Tag,
  '/sis/admin/subjects': Scale,
  '/sis/admin/approvers': ShieldCheck,
  '/sis/admin/staff': Users,
  '/sis/admin/template': Copy,
  '/sis/admin/school-config': Building2,
  '/sis/admin/users': UserCog,
  '/sis/admin/settings': Settings2,
  '/sis/sync-students': Database,
  '/sis/audit-log': History,
},
```

Also ensure `Users` is imported at the top of `registry.ts`. Check the existing imports — if `Users` is already imported from `lucide-react`, no change needed. If not, add it to the lucide import line.

- [ ] **Step 3: Verify TypeScript**

```powershell
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Run full build**

```powershell
npx next build
```

Expected: clean compile. The build output should list `/sis/admin/staff` as one of the compiled pages.

- [ ] **Step 5: Manual happy path**

1. Start dev server: `npx next dev`
2. Sign in as `school_admin` or `superadmin`.
3. Navigate to `/sis/admin/staff` — page loads with KPI strip and teacher table.
4. Verify: teachers with FCA assignments show a section badge in the FCA column; those without show "—".
5. Verify: "No FCA" filter chip shows only teachers without an FCA section.
6. Verify: name search filters the table.
7. Click the `ChevronRight` button on a teacher row — slide-over opens, shows a spinner briefly, then FCA section dropdown pre-selected + subject list rendered.
8. Change the FCA section to a different one → `toast.success("FCA assignment saved")` fires; close and reopen the row — new section shows.
9. Remove a subject assignment (×) → row disappears from the list; no page reload.
10. Add a new subject + section via the inline add form → row appears in the list.
11. Navigate to `/sis/audit-log` — verify `assignment.create` and `assignment.delete` rows appear with the correct teacher and section context.

- [ ] **Step 6: Commit**

```powershell
git add app/(sis)/sis/admin/staff/page.tsx lib/sidebar/registry.ts
git commit -m "feat(sis): /sis/admin/staff — school-wide teacher assignment manager"
```
