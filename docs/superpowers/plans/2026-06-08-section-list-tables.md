# Section-list surfaces → DataTable + row-actions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the three pill-grid section lists (SIS / Markbook / Attendance) to the unified `<DataTable>` (mirroring `/evaluation/sections`), each with a `⋯` row-actions menu — so Generate-index is reachable from Markbook (no SIS-Admin trip), registrar-gated.

**Architecture:** Keep each page's existing server loader (same data — no new queries); pass rows to a new `'use client'` DataTable component per module. Extract the Generate-index confirm dialog into a controlled `<GenerateIndexDialog>` reused by the existing button + a shared `<SectionRowActions>` (the per-row menu). Evaluation list unchanged (reference).

**Tech Stack:** Next.js 16 (RSC), TypeScript, `@tanstack/react-table` via `components/ui/data-table`, shadcn/ui, Tailwind v4 tokens.

**Spec:** `docs/superpowers/specs/2026-06-08-section-list-tables-design.md`

---

## File structure

- **Refactor** `components/sis/generate-index-button.tsx` — extract controlled `<GenerateIndexDialog>`; `GenerateIndexButton`/`GenerateAllIndexButton` reuse it (behavior unchanged).
- **Create** `components/sections/section-row-actions.tsx` — shared per-row `⋯` menu (module-aware, role-gated).
- **Create** `components/sis/sections-data-table.tsx`, `components/markbook/sections-data-table.tsx`, `components/attendance/sections-data-table.tsx` — the three tables (mirror `components/evaluation/sections-list.tsx`).
- **Modify** the three pages: `app/(sis)/sis/sections/page.tsx`, `app/(markbook)/markbook/sections/page.tsx`, `app/(attendance)/attendance/sections/page.tsx` — reshape loaded data → rows, render the table, remove the pill grid.

---

## Task 1: Extract `GenerateIndexDialog` (refactor, no behavior change)

**Files:** Modify `components/sis/generate-index-button.tsx`

- [ ] **Step 1: Add a controlled `GenerateIndexDialog` + refactor the button to use it**

Replace the body of `GenerateIndexButton` so the dialog is a separate controlled export. Add at the top of the file (after imports):

```tsx
// Controlled confirm dialog — reused by GenerateIndexButton (below) and the
// section row-actions menu. Renders only the AlertDialog (no trigger), so a
// caller can open it from a DropdownMenuItem (dialog rendered outside the menu).
export function GenerateIndexDialog({
  sectionId,
  sectionName,
  termStarted,
  open,
  onOpenChange,
}: {
  sectionId: string;
  sectionName: string;
  termStarted: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleGenerate(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch(`/api/sections/${sectionId}/generate-index`, {
        method: 'POST',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(body.error ?? 'Could not generate index numbers');
      const count: number = body.rows_renumbered ?? 0;
      toast.success(
        `Renumbered ${count} student${count === 1 ? '' : 's'} in ${sectionName}`
      );
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Generate class index?</AlertDialogTitle>
          <AlertDialogDescription>
            This numbers <strong>{sectionName}</strong> alphabetically by
            surname (last name, then first name). New students enrolled later
            keep getting the next number at the bottom; withdrawn students
            retain their retired numbers.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {termStarted && (
          <Alert variant="warning">
            <AlertIcon variant="warning">
              <TriangleAlert />
            </AlertIcon>
            <AlertTitle>School year is in session</AlertTitle>
            <AlertDescription>
              Students may already know their current numbers and teachers may
              call them by these during class. Regenerating will renumber
              everyone — only do this if you&apos;re correcting a setup mistake.
            </AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleGenerate}
            disabled={busy}
            variant={termStarted ? 'destructive' : 'default'}
          >
            {busy && <Loader2 className="mr-1 size-4 animate-spin" />}
            Generate
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

Then simplify `GenerateIndexButton` to a trigger + the dialog:

```tsx
export function GenerateIndexButton({
  sectionId,
  sectionName,
  termStarted,
  variant = 'default',
}: GenerateIndexButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => setOpen(true)}
      >
        <ArrowDownAZ className="size-3.5" />
        {variant === 'default' && 'Generate index'}
      </Button>
      <GenerateIndexDialog
        sectionId={sectionId}
        sectionName={sectionName}
        termStarted={termStarted}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
```

Leave `GenerateAllIndexButton` exactly as-is (its own dialog; bulk path unchanged). Keep all existing imports; `AlertDialogTrigger` may become unused — remove it from the import if so.

- [ ] **Step 2: tsc + build**

Run: `npx tsc --noEmit` (clean; ignore `.next/dev/types/validator.ts` phantom) then `npx next build` — `/sis/sections` (which renders `GenerateIndexButton` in its pills today) still compiles + works.

- [ ] **Step 3: Commit**

```bash
git add components/sis/generate-index-button.tsx
git commit -m "refactor(sections): extract controlled GenerateIndexDialog"
```

---

## Task 2: Shared `SectionRowActions` (the `⋯` menu)

**Files:** Create `components/sections/section-row-actions.tsx`

> **UI task** — invoke `ui-ux-pro-max@ui-ux-pro-max-skill` + skim `docs/context/09-design-system.md`. Read `components/sis/ay-setup-data-table.tsx` (the `AyRowActions` pattern: `RowActionsMenu` + dialogs rendered OUTSIDE, `onSelect` sets open-state) and `components/sis/generate-sheets-dialog.tsx` (controlled `open`/`onOpenChange`, `scope: { kind:'section', sectionId, sectionLabel }`).

- [ ] **Step 1: Implement the component**

`'use client'`. Props:

```tsx
import type { Role } from '@/lib/auth/roles';
type SectionRowActionsProps = {
  module: 'sis' | 'markbook' | 'attendance';
  sectionId: string;
  sectionName: string;
  role: Role | null;
  termStarted: boolean; // only meaningful for sis/markbook (Generate-index)
  todayHref?: string; // attendance: /attendance/[id]?date=<today>
};
```

Render a `RowActionsMenu` (from `@/components/ui/data-table`) + the dialogs OUTSIDE it, with local open-state:

- `const isRegistrarPlus = role === 'registrar' || role === 'school_admin' || role === 'superadmin';`
- **Open link** (always, first item): a `DropdownMenuItem asChild` wrapping a `next/link` `<Link>`:
  - sis → `/sis/sections/${sectionId}` ("Open roster")
  - markbook → `/markbook/sections/${sectionId}` ("Open grading")
  - attendance → `todayHref` ("Open daily")
- **Generate index** (sis + markbook only, `isRegistrarPlus` only): `DropdownMenuItem` `onSelect={(e)=>{e.preventDefault(); setIndexOpen(true);}}` with `ArrowDownAZ` icon.
- **Generate sheets** (sis + markbook only, `isRegistrarPlus` only): `DropdownMenuItem` → `setSheetsOpen(true)`, `FilePlus2` icon.
- Below the menu, render (outside it):
  - `<GenerateIndexDialog sectionId sectionName termStarted open={indexOpen} onOpenChange={setIndexOpen} />` (import from `@/components/sis/generate-index-button`) — only mount for sis/markbook.
  - `<GenerateSheetsDialog scope={{ kind:'section', sectionId, sectionLabel: sectionName }} open={sheetsOpen} onOpenChange={setSheetsOpen} />` (import from `@/components/sis/generate-sheets-dialog`) — only mount for sis/markbook. (Confirm GenerateSheetsDialog renders nothing/trigger-less when no `children` + controlled `open` — read it; if it requires a trigger, pass a hidden/no-op trigger or use its `children`-less controlled mode.)
- Use shadcn `DropdownMenuItem` from `@/components/ui/dropdown-menu`; tokens only.

- [ ] **Step 2: tsc**

Run: `npx tsc --noEmit` — clean.

- [ ] **Step 3: Commit**

```bash
git add components/sections/section-row-actions.tsx
git commit -m "feat(sections): shared row-actions menu (open / generate-index / generate-sheets, role-gated)"
```

---

## Task 3: SIS sections → DataTable

**Files:** Create `components/sis/sections-data-table.tsx`; Modify `app/(sis)/sis/sections/page.tsx`

> **UI task** — invoke `ui-ux-pro-max` + skim the design system. Mirror `components/evaluation/sections-list.tsx` exactly for the DataTable wiring (facet/search/csv/url-namespace/sort/empty).

- [ ] **Step 1: The table component**

`components/sis/sections-data-table.tsx` (`'use client'`), modeled on `EvaluationSectionsList`:

- Row type: `{ id: string; name: string; levelLabel: string; active: number; withdrawn: number }`.
- Props: `{ rows, levels: {id;code;label}[], role: Role|null, termStarted: boolean, sections: {id;name}[] }`.
- Columns: **Section** (`IdentifierLink` → `/sis/sections/${id}`, SortableHeader) · **Level** (mono, `facetFilterFn`) · **Active** (tabular-nums, SortableHeader) · **Withdrawn** (tabular-nums, SortableHeader, `text-muted-foreground`) · **actions** (`id:'actions'`, `enableSorting:false, enableHiding:false`, cell → `<SectionRowActions module="sis" sectionId={row.id} sectionName={row.name} role={role} termStarted={termStarted} />`).
- `<DataTable>` with: `searchKeys={['name','levelLabel']}`, Level facet (when `levels.length>1`), `initialSort=[{id:'levelLabel'},{id:'name'}]`, `pageSize={25}`, `csv={{filename:'sis-sections.csv'}}`, `url={{enabled:true, namespace:'sections'}}`, empty states. Put the bulk **`<GenerateAllIndexButton sections={sections} termStarted={termStarted} />`** in `toolbarTrailing` (registrar+ — gate by `role`; the whole page is already registrar+).
- Copy `facetFilterFn` from the evaluation list.

- [ ] **Step 2: Wire the page**

In `app/(sis)/sis/sections/page.tsx`: keep the existing role gate + data loads (sections + level + `section_students` counts + terms for `termStarted`). Build `rows` (flatten the per-section active/withdrawn counts + level label) + `levels` + `sections` ({id,name}) + compute `termStarted` (earliest term `start_date` ≤ `sgToday()` — it already does this). Replace the `<LevelGroup>`/`<SectionPill>` grid render with `<SisSectionsDataTable rows levels role={sessionUser.role} termStarted sections />`. Keep the hero + `<NewSectionButton>` + summary cards. Delete the now-unused `LevelGroup`/`SectionPill` local components + the old `GenerateIndexButton`/`GenerateAllIndexButton` header usage if superseded (the bulk button moves into the table toolbar).

- [ ] **Step 3: tsc + build + manual**

`npx tsc --noEmit && npx next build` clean. `/sis/sections` renders a sortable/searchable table with a Level facet + CSV; `⋯` → Open roster / Generate index / Generate sheets all work; "Generate all" in the toolbar works; term-started warning fires mid-year.

- [ ] **Step 4: Commit**

```bash
git add components/sis/sections-data-table.tsx "app/(sis)/sis/sections/page.tsx"
git commit -m "feat(sis): sections list as DataTable with row-actions"
```

---

## Task 4: Markbook sections → DataTable

**Files:** Create `components/markbook/sections-data-table.tsx`; Modify `app/(markbook)/markbook/sections/page.tsx`

> **UI task** — invoke `ui-ux-pro-max`. Mirror the SIS table (Task 3) with these deltas.

- [ ] **Step 1: The table component**

`components/markbook/sections-data-table.tsx` — identical shape to the SIS table EXCEPT:

- Row type drops `withdrawn`: `{ id; name; levelLabel; active }`.
- Columns: Section (`IdentifierLink` → `/markbook/sections/${id}`) · Level · **Students** (the `active` count, SortableHeader) · actions (`<SectionRowActions module="markbook" ... role termStarted />`).
- `csv={{filename:'markbook-sections.csv'}}`. No bulk "Generate all" in the toolbar (Markbook is teacher-viewable; bulk index stays a SIS/registrar action). Same facet/search/url-namespace/sort/empty.

- [ ] **Step 2: Wire the page**

In `app/(markbook)/markbook/sections/page.tsx`: keep the existing loads (sections + level + `section_students` active counts + AY). **Add a terms load** to compute `termStarted` (earliest term `start_date` ≤ `sgToday()`, via `lib/dates::sgToday`) — Markbook's page doesn't load terms today but Generate-index needs the warning flag. Build `rows` + `levels`, pass `role={sessionUser?.role ?? null}` + `termStarted`. Replace the pill grid with `<MarkbookSectionsDataTable rows levels role termStarted />`. Keep the "Manage in SIS Admin" header link (registrar+). Delete the unused pill components.

- [ ] **Step 3: tsc + build + manual**

Clean. As **registrar:** `⋯` → Open grading / Generate index / Generate sheets; Generate index works **without entering SIS Admin** (the headline). As **teacher:** only "Open grading" shows.

- [ ] **Step 4: Commit**

```bash
git add components/markbook/sections-data-table.tsx "app/(markbook)/markbook/sections/page.tsx"
git commit -m "feat(markbook): sections list as DataTable + Generate-index in row-actions (registrar+)"
```

---

## Task 5: Attendance sections → DataTable

**Files:** Create `components/attendance/sections-data-table.tsx`; Modify `app/(attendance)/attendance/sections/page.tsx`

> **UI task** — invoke `ui-ux-pro-max`. Mirror SIS/Markbook with these deltas.

- [ ] **Step 1: The table component**

`components/attendance/sections-data-table.tsx` — like Markbook's EXCEPT:

- Props: `{ rows, levels, today: string }` (no role/termStarted — no Generate-index here).
- Columns: Section (`IdentifierLink` → `/attendance/${id}?date=${today}`) · Level · **Active** · actions (`<SectionRowActions module="attendance" sectionId sectionName role={null} termStarted={false} todayHref={`/attendance/${id}?date=${today}`} />`). The attendance row-action menu shows only "Open daily" (per SectionRowActions module logic).
- `csv={{filename:'attendance-sections.csv'}}`. Facet/search/url-namespace/sort/empty as before.

- [ ] **Step 2: Wire the page**

In `app/(attendance)/attendance/sections/page.tsx`: keep the existing loads + the **form-adviser scoping** (teachers see only their sections — unchanged). Build `rows` + `levels`; pass `today = sgToday()`. Replace the pill grid with `<AttendanceSectionsDataTable rows levels today />`. Delete unused pill components.

- [ ] **Step 3: tsc + build + manual**

Clean. Teachers see only their sections; `⋯` → Open daily opens the daily writer for today; sort/facet/search/CSV work.

- [ ] **Step 4: Commit**

```bash
git add components/attendance/sections-data-table.tsx "app/(attendance)/attendance/sections/page.tsx"
git commit -m "feat(attendance): sections list as DataTable"
```

---

## Task 6: Final verification

- [ ] **Step 1:** `npx tsc --noEmit` clean.
- [ ] **Step 2:** `npx vitest run` — all pass (no logic tests expected to change; confirm none broke).
- [ ] **Step 3:** `npx next build` clean; the three `/…/sections` routes compile; grep for now-orphaned pill components (`SectionPill`/`LevelGroup` locals) and confirm removed — no dead exports.
- [ ] **Step 4:** Manual matrix: all four section lists are tables with consistent sort/facet/search/CSV; Markbook Generate-index works for registrar (no SIS trip) + hidden for teachers; Attendance teacher-scoping intact; Evaluation unchanged.
- [ ] **Step 5:** Dispatch `feature-dev:code-reviewer` over the branch diff; address findings.

---

## Self-review notes (author)

- **Spec coverage:** 3 conversions (T3/T4/T5) · row-actions w/ Generate-index registrar-gated (T2) · GenerateIndexDialog reuse (T1) · evaluation untouched · no new queries (each page reuses existing loads; Markbook adds only a terms-for-termStarted read, which is existing-table, not a new analytic column). All covered.
- **Type consistency:** `SectionRowActions` prop names + `GenerateIndexDialog` signature consistent across T1/T2; row types per module explicit.
- **Risk:** `GenerateSheetsDialog` controlled-open without a `children` trigger — Task 2 step says to verify it renders trigger-less under controlled `open` (read the file; if it hard-requires a trigger, mount it with a hidden trigger or extend it minimally). The pill-grid deletions (T3–T5) — grep for stragglers in T6.
- **Gating:** registrar+ check centralized in `SectionRowActions` (`isRegistrarPlus`); pages pass `role`. Attendance passes `role={null}` (no gated actions there).
