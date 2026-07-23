# DataTable Expandable/Nested Rows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in `expandable` capability to the shared `<DataTable>` shell (`components/ui/data-table/`) — the one genuinely missing structural capability found in this session's data-table audit — and apply it to the 3 document-validation queue tables (`components/admissions/document-validation/validation-queue.tsx`, `components/p-files/document-validation/{awaiting,expiring}-queue.tsx`), which today repeat a student's identity (name/number/level/status) on every row because each row is really one (student × document-slot) pair. This is roadmap step 2 (step 1, the `document-completeness-table.tsx` shell migration, already shipped).

**Architecture:** The shell gains one new optional prop, `expandable?: ExpandableConfig<TRow>`. When set, the render loop groups the CURRENT PAGE's already-filtered/sorted rows by a caller-supplied key (`groupBy`), renders one collapsible summary row per group via a caller-supplied render-prop (`renderGroupHeader`) that spans the full column width, and renders each group's member rows underneath using the table's normal per-column cell rendering — unchanged from today. Grouping is a purely presentational transform applied to `table.getRowModel().rows` (post-filter, post-sort, post-pagination) — TanStack's own row model, sorting, filtering, and pagination pipeline are completely untouched, so this cannot regress the ~30 other tables that never set `expandable`. Per the design discussion this session: grouping is applied **within the current page**, not across page boundaries (deliberately simpler than group-aware pagination — these are small internal triage queues, typically single-digit-to-low-double-digit rows, where a student's slots splitting across a 25-row page is a rare edge case not worth the complexity of bypassing TanStack's built-in pagination row model).

Each of the 3 target components currently defines a `fullName`/"Student" column that repeats per row. This plan removes that column from `columns` and moves the student's identity into `renderGroupHeader` instead — so a student with 3 pending documents shows their name/level/status **once**, with a chevron to expand/collapse their 3 document rows (each showing only the slot-specific columns: Document/Owner/Preview/Actions/etc.). All groups start expanded by default (matches today's "see everything" behavior — the win is one identity line instead of three, not hiding data by default).

**Tech Stack:** `@tanstack/react-table` (already a dependency, no new package), React, existing shadcn primitives.

## Global Constraints

- **Zero behavior change for any table that doesn't set `expandable`.** This is an additive, optional prop — every other `<DataTable>` consumer (~28 tables) must render byte-identically to before.
- **Grouping is per-page, not cross-page.** Do not attempt to bypass or replace `getPaginationRowModel()` — group `table.getRowModel().rows` (the already-paginated set) directly.
- **TanStack's filter/sort/facet/search/pagination pipeline stays untouched.** Grouping happens only in the render loop, after `table.getRowModel().rows` is computed.
- **CSV export stays flat (unchanged).** The export sheet operates on `data`/`columns` independently of expand/collapse state — it should keep exporting one row per (student × slot), which is the correct granularity for a spreadsheet. Do not thread `expandable` into `DataTableExportSheetProps`.
- **All 3 target tables' existing mutation logic (optimistic approve/reject, notify) is copied verbatim** — this plan only touches column definitions and adds the group-header render function; it does not alter `statusMutation`/`patchStatus`/`NotifyButton`/any API call.
- Design system compliance (Hard Rule #7): no raw hex/oklch/slate/zinc/gray/bg-white/bg-black; the group-header row uses `bg-muted/30` (an existing semantic token, matches the shell's own table-header treatment) — do not invent a new color.

---

### Task 1: Add `expandable` to the shared DataTable shell

**Files:**

- Modify: `components/ui/data-table/types.ts`
- Modify: `components/ui/data-table/index.tsx`
- Create: `__tests__/ui/data-table-expandable.test.tsx`

**Interfaces:**

- Produces: `ExpandableConfig<TRow>` type (exported from `types.ts`), and the `expandable?: ExpandableConfig<TRow>` prop on `DataTableProps<TRow>` — consumed by Tasks 2 and 3.

- [ ] **Step 1: Add the `ExpandableConfig` type**

In `components/ui/data-table/types.ts`, add (near the other per-feature config types, e.g. after `SelectionConfig`):

```ts
export type ExpandableConfig<TRow> = {
  enabled: boolean;
  /** Rows sharing the same key are grouped under one collapsible parent
   *  row. Grouping is applied to the CURRENT PAGE's rows only (after
   *  filter/sort/pagination) — a group can't span two pages. Acceptable
   *  for the small internal-triage-queue volumes this targets; revisit
   *  with group-aware pagination if a future consumer needs it. */
  groupBy: (row: TRow) => string;
  /** Renders the parent row's content — spans the full column width (a
   *  single `colSpan={columns.length}` cell). Receives the group's member
   *  rows in their already-filtered/sorted order, current expand state,
   *  and a toggle callback. All groups start expanded by default. */
  renderGroupHeader: (group: {
    key: string;
    rows: TRow[];
    isExpanded: boolean;
    toggle: () => void;
  }) => import('react').ReactNode;
};
```

Add `expandable?: ExpandableConfig<TRow>;` to `DataTableProps<TRow>` (alongside `selection`/`csv`/`url` etc.).

- [ ] **Step 2: Update imports in `index.tsx`**

Add `Fragment` to the existing React import (needed because each group's `<TableRow>` + conditional child `<TableRow>`s must be wrapped in one keyed element, and the `<>...</>` shorthand doesn't accept a `key` prop):

```tsx
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from 'react';
```

Add `ExpandableConfig` to the type import: `import type { DataTableProps, FacetConfig } from './types';` → `import type { DataTableProps, ExpandableConfig, FacetConfig } from './types';` (only needed if you reference the type explicitly; using it purely through `props.expandable`'s inferred type may not require the import — add it only if TypeScript asks for it).

- [ ] **Step 3: Destructure `expandable` from props and add collapse-tracking state**

In the `DataTable` function body, add `expandable` to the destructured props (alongside the existing list), and add state right after the existing `rowSelection` state:

```tsx
// Tracks which group KEYS are collapsed — inverted (vs. tracking expanded
// keys) so a freshly-seen group defaults to expanded with zero entries,
// matching the "declutter via one summary line, not by hiding" intent.
const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
```

- [ ] **Step 4: Replace the row-rendering loop**

Find the existing render block:

```tsx
) : (
  table.getRowModel().rows.map((r) => (
    <TableRow
      key={r.id}
      className="group"
      data-state={r.getIsSelected() && 'selected'}
    >
      {r.getVisibleCells().map((c) => (
        <TableCell key={c.id}>
          {flexRender(c.column.columnDef.cell, c.getContext())}
        </TableCell>
      ))}
    </TableRow>
  ))
)}
```

Replace with:

```tsx
) : expandable?.enabled ? (
  (() => {
    const rows = table.getRowModel().rows;
    const groups: { key: string; rows: typeof rows }[] = [];
    const indexByKey = new Map<string, number>();
    for (const r of rows) {
      const key = expandable.groupBy(r.original);
      let idx = indexByKey.get(key);
      if (idx === undefined) {
        idx = groups.length;
        indexByKey.set(key, idx);
        groups.push({ key, rows: [] });
      }
      groups[idx].rows.push(r);
    }
    return groups.map((g) => {
      const isExpanded = !collapsedGroups.has(g.key);
      const toggle = () =>
        setCollapsedGroups((prev) => {
          const next = new Set(prev);
          if (next.has(g.key)) next.delete(g.key);
          else next.add(g.key);
          return next;
        });
      return (
        <Fragment key={g.key}>
          <TableRow className="bg-muted/30 hover:bg-muted/30">
            <TableCell colSpan={columns.length} className="p-0">
              {expandable.renderGroupHeader({
                key: g.key,
                rows: g.rows.map((r) => r.original),
                isExpanded,
                toggle,
              })}
            </TableCell>
          </TableRow>
          {isExpanded &&
            g.rows.map((r) => (
              <TableRow
                key={r.id}
                className="group"
                data-state={r.getIsSelected() && 'selected'}
              >
                {r.getVisibleCells().map((c) => (
                  <TableCell key={c.id}>
                    {flexRender(c.column.columnDef.cell, c.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
        </Fragment>
      );
    });
  })()
) : (
  table.getRowModel().rows.map((r) => (
    <TableRow
      key={r.id}
      className="group"
      data-state={r.getIsSelected() && 'selected'}
    >
      {r.getVisibleCells().map((c) => (
        <TableCell key={c.id}>
          {flexRender(c.column.columnDef.cell, c.getContext())}
        </TableCell>
      ))}
    </TableRow>
  ))
)}
```

(This is the existing `showEmpty ? (...) : showFilteredEmpty ? (...) : (...)` ternary chain — you're only touching the final branch, adding one more condition before the existing fallback. The existing fallback branch is kept verbatim as the non-expandable path.)

- [ ] **Step 5: Write a component test**

Create `__tests__/ui/data-table-expandable.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ColumnDef } from '@tanstack/react-table';

import { DataTable } from '@/components/ui/data-table';

type Row = { id: string; groupKey: string; label: string };

const rows: Row[] = [
  { id: '1', groupKey: 'A', label: 'A-first' },
  { id: '2', groupKey: 'A', label: 'A-second' },
  { id: '3', groupKey: 'B', label: 'B-only' },
];

const columns: ColumnDef<Row>[] = [{ accessorKey: 'label', header: 'Label' }];

function renderTable() {
  return render(
    <DataTable<Row>
      data={rows}
      columns={columns}
      getRowId={(r) => r.id}
      expandable={{
        enabled: true,
        groupBy: (r) => r.groupKey,
        renderGroupHeader: ({ key, rows: groupRows, isExpanded, toggle }) => (
          <button type="button" onClick={toggle} aria-expanded={isExpanded}>
            Group {key} ({groupRows.length})
          </button>
        ),
      }}
    />
  );
}

describe('DataTable expandable rows', () => {
  it('renders one group header per distinct groupBy key', () => {
    renderTable();
    expect(screen.getByText('Group A (2)')).toBeInTheDocument();
    expect(screen.getByText('Group B (1)')).toBeInTheDocument();
  });

  it('starts all groups expanded, showing every child row', () => {
    renderTable();
    expect(screen.getByText('A-first')).toBeInTheDocument();
    expect(screen.getByText('A-second')).toBeInTheDocument();
    expect(screen.getByText('B-only')).toBeInTheDocument();
  });

  it("collapses a group on toggle, hiding only that group's rows", () => {
    renderTable();
    fireEvent.click(screen.getByText('Group A (2)'));
    expect(screen.queryByText('A-first')).not.toBeInTheDocument();
    expect(screen.queryByText('A-second')).not.toBeInTheDocument();
    // Group B untouched
    expect(screen.getByText('B-only')).toBeInTheDocument();
  });

  it('re-expands on a second toggle', () => {
    renderTable();
    const header = screen.getByText('Group A (2)');
    fireEvent.click(header);
    fireEvent.click(screen.getByText('Group A (2)'));
    expect(screen.getByText('A-first')).toBeInTheDocument();
  });

  it('a table without `expandable` renders the flat row list unchanged', () => {
    render(
      <DataTable<Row> data={rows} columns={columns} getRowId={(r) => r.id} />
    );
    expect(screen.getByText('A-first')).toBeInTheDocument();
    expect(screen.getByText('A-second')).toBeInTheDocument();
    expect(screen.getByText('B-only')).toBeInTheDocument();
    // No group-header buttons should exist
    expect(
      screen.queryByRole('button', { name: /Group/ })
    ).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run the new test**

```bash
npx vitest run __tests__/ui/data-table-expandable.test.tsx
```

Expected: 5/5 passing.

- [ ] **Step 7: Run typecheck and the full suite**

```bash
npx tsc --noEmit
npx vitest run
```

Expected: both clean; test count increased by 5 (the new file) plus no regressions in any of the ~30 existing `<DataTable>` consumers' own tests (none of them set `expandable`, so their render path is byte-identical to before).

- [ ] **Step 8: Commit**

```bash
git add components/ui/data-table/types.ts components/ui/data-table/index.tsx __tests__/ui/data-table-expandable.test.tsx
git commit -m "feat(data-table): add opt-in expandable/grouped-row capability to the shared shell"
```

---

### Task 2: Apply expandable rows to the Admissions document-validation queue

**Files:**

- Modify: `components/admissions/document-validation/validation-queue.tsx`

**Interfaces:**

- Consumes: `expandable` prop from Task 1.

- [ ] **Step 1: Read the current file in full**

Confirm it still matches this plan's description (student/document/owner/level/status/preview/actions columns, `rowKey = (r) => \`${r.enroleeNumber}::${r.slotKey}\``, `patchStatus`/`statusMutation` unchanged).

- [ ] **Step 2: Remove the `fullName` column from `columns`**

Delete this column definition (currently first in the array):

```tsx
{
  accessorKey: 'fullName',
  header: ({ column }) => (
    <SortableHeader column={column}>Student</SortableHeader>
  ),
  cell: ({ row }) => (
    <div className="space-y-0.5">
      <IdentifierLink
        href={`/admissions/applications/${encodeURIComponent(row.original.enroleeNumber)}?ay=${encodeURIComponent(ayCode)}`}
      >
        {row.original.fullName}
      </IdentifierLink>
      <div className="font-mono text-[10px] text-muted-foreground">
        {row.original.enroleeNumber}
      </div>
    </div>
  ),
},
```

Its content moves into the group header (Step 4). The remaining columns (Document/Owner/Level/App status/Preview/Actions) are unchanged — do not reorder or edit them.

- [ ] **Step 3: Add `ChevronRight` and `cn` imports**

```tsx
import { ChevronRight } from 'lucide-react';
```

(alongside the existing `CalendarClock`, `GalleryHorizontalEndIcon`, `ListIcon` import from `lucide-react`)

```tsx
import { cn } from '@/lib/utils';
```

- [ ] **Step 4: Add the group-header component**

Add this component above `export function ValidationQueue`:

```tsx
function ValidationGroupHeader({
  rows,
  isExpanded,
  toggle,
  ayCode,
}: {
  rows: ValidationQueueRow[];
  isExpanded: boolean;
  toggle: () => void;
  ayCode: string;
}) {
  const first = rows[0];
  return (
    {/* A <button> can't legally contain the <a> that IdentifierLink
        renders (HTML forbids interactive content inside <button>) — use
        a keyboard-accessible div instead (role="button" + tabIndex +
        Enter/Space handling), same substitution React docs recommend
        whenever a clickable container must wrap a link. */}
    <div
      role="button"
      tabIndex={0}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      }}
      aria-expanded={isExpanded}
      className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ChevronRight
        className={cn(
          'size-4 shrink-0 text-muted-foreground transition-transform',
          isExpanded && 'rotate-90'
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        {/* IdentifierLink doesn't accept onClick — wrap it so the link
            navigates without also toggling the group (the wrapping
            div's onClick would otherwise fire on every click inside). */}
        <span onClick={(e) => e.stopPropagation()}>
          <IdentifierLink
            href={`/admissions/applications/${encodeURIComponent(first.enroleeNumber)}?ay=${encodeURIComponent(ayCode)}`}
          >
            {first.fullName}
          </IdentifierLink>
        </span>
        <span className="ml-2 font-mono text-[10px] text-muted-foreground">
          {first.enroleeNumber}
        </span>
      </div>
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        {first.levelApplied ?? '—'}
      </span>
      <Badge variant="outline">{first.applicationStatus}</Badge>
      <Badge variant="secondary" className="font-mono text-[10px] tabular-nums">
        {rows.length} document{rows.length === 1 ? '' : 's'}
      </Badge>
    </div>
  );
}
```

Note the `<span onClick={(e) => e.stopPropagation()}>` wrapping `IdentifierLink` (`IdentifierLink` itself has no `onClick` prop — see `components/ui/identifier-link.tsx`) — the whole header row is a `<div role="button" onClick={toggle}>` (a plain `<button>` can't legally contain the `<a>` IdentifierLink renders), so without stopping propagation, clicking the student's name would both navigate AND toggle the group. With the wrapper, clicking the name navigates only; clicking anywhere else in the header row toggles.

- [ ] **Step 5: Wire `expandable` into the `<DataTable>` call**

Add to the existing `<DataTable ... />` props (inside the `mode === 'table'` return, alongside `columns`/`data`/`facets`/etc.):

```tsx
expandable={{
  enabled: true,
  groupBy: (row) => row.enroleeNumber,
  renderGroupHeader: ({ rows, isExpanded, toggle }) => (
    <ValidationGroupHeader
      rows={rows}
      isExpanded={isExpanded}
      toggle={toggle}
      ayCode={ayCode}
    />
  ),
}}
```

- [ ] **Step 6: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 7: Manual verification read-through**

Confirm: Triage mode (`mode === 'triage'`) is a completely separate return branch using `TriagePane`, untouched by this change — expandable rows only affect the `mode === 'table'` branch. Confirm the `RejectDialog` (opened via `setRejectTarget`) is unaffected — it's keyed off `rejectTarget`, a piece of state independent of expand/collapse. Confirm `rowKey`/`getRowId` is unchanged (`${enroleeNumber}::${slotKey}`) — this is the per-ROW id, distinct from the per-GROUP key (`enroleeNumber` alone) used by `groupBy`, and both are needed (don't conflate them).

- [ ] **Step 8: Run the full test suite**

```bash
npx vitest run
```

Expected: no new failures (no existing test targets this component directly, per a prior session's audit — confirm this is still true by checking for any test importing `ValidationQueue`; if one exists, read and address it).

- [ ] **Step 9: Commit**

```bash
git add components/admissions/document-validation/validation-queue.tsx
git commit -m "feat(admissions): group document-validation queue rows by student with expand/collapse"
```

---

### Task 3: Apply expandable rows to the P-Files awaiting + expiring queues

**Files:**

- Modify: `components/p-files/document-validation/awaiting-queue.tsx`
- Modify: `components/p-files/document-validation/expiring-queue.tsx`

**Interfaces:**

- Consumes: `expandable` prop from Task 1. Same pattern as Task 2, applied to two near-identical sibling components on the same page (`app/(p-files)/p-files/document-validation/page.tsx`).

- [ ] **Step 1: Read both current files in full**

Confirm they still match this plan's description. Note `AwaitingQueue` gates its actions column on `isOfficer` and has a `mode: 'table' | 'triage'` toggle (same shape as Task 2's target); `ExpiringQueue` has no triage mode and no `isOfficer` gate at the table level (its per-row `NotifyButton` is always rendered — confirm this is still the case, since KD context suggests P-Files' expiring queue may have officer-gating logic worth re-checking).

- [ ] **Step 2: `awaiting-queue.tsx` — remove the `fullName` column**

Delete the first column definition (`accessorKey: 'fullName'`, same shape as Task 2's, minus the `ayCode` query suffix — this table links to `/p-files/${enroleeNumber}` with no `?ay=` param).

Add imports: `import { ChevronRight } from 'lucide-react';` (alongside `GalleryHorizontalEndIcon, ListIcon`) and `import { cn } from '@/lib/utils';`.

Add a group-header component:

```tsx
function AwaitingGroupHeader({
  rows,
  isExpanded,
  toggle,
}: {
  rows: PFileValidationRow[];
  isExpanded: boolean;
  toggle: () => void;
}) {
  const first = rows[0];
  return (
    {/* A <button> can't legally contain the <a> that IdentifierLink
        renders (HTML forbids interactive content inside <button>) — use
        a keyboard-accessible div instead (role="button" + tabIndex +
        Enter/Space handling), same substitution React docs recommend
        whenever a clickable container must wrap a link. */}
    <div
      role="button"
      tabIndex={0}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      }}
      aria-expanded={isExpanded}
      className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ChevronRight
        className={cn(
          'size-4 shrink-0 text-muted-foreground transition-transform',
          isExpanded && 'rotate-90'
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        {/* IdentifierLink doesn't accept onClick — wrap it so the link
            navigates without also toggling the group (the wrapping
            div's onClick would otherwise fire on every click inside). */}
        <span onClick={(e) => e.stopPropagation()}>
          <IdentifierLink href={`/p-files/${encodeURIComponent(first.enroleeNumber)}`}>
            {first.fullName}
          </IdentifierLink>
        </span>
        <span className="ml-2 font-mono text-[10px] text-muted-foreground">
          {first.enroleeNumber}
        </span>
      </div>
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        {first.levelApplied ?? '—'}
      </span>
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        {first.classSection ?? '—'}
      </span>
      <Badge variant="secondary" className="font-mono text-[10px] tabular-nums">
        {rows.length} document{rows.length === 1 ? '' : 's'}
      </Badge>
    </div>
  );
}
```

Wire into the `<DataTable>` call:

```tsx
expandable={{
  enabled: true,
  groupBy: (row) => row.enroleeNumber,
  renderGroupHeader: ({ rows, isExpanded, toggle }) => (
    <AwaitingGroupHeader rows={rows} isExpanded={isExpanded} toggle={toggle} />
  ),
}}
```

- [ ] **Step 3: `expiring-queue.tsx` — remove the `fullName` column**

Same pattern. Delete the first column definition. Add `ChevronRight` import (this file already imports `Loader2, Mail` from `lucide-react` — add to that list) — `cn` is already imported in this file (used by `expiryTone`), no new import needed for it.

Add a group-header component (note: this one has no `applicationStatus`/`classSection` distinction to show beyond level — keep it minimal, matching what identity data this row type actually carries):

```tsx
function ExpiringGroupHeader({
  rows,
  isExpanded,
  toggle,
}: {
  rows: PFileValidationRow[];
  isExpanded: boolean;
  toggle: () => void;
}) {
  const first = rows[0];
  return (
    {/* A <button> can't legally contain the <a> that IdentifierLink
        renders (HTML forbids interactive content inside <button>) — use
        a keyboard-accessible div instead (role="button" + tabIndex +
        Enter/Space handling), same substitution React docs recommend
        whenever a clickable container must wrap a link. */}
    <div
      role="button"
      tabIndex={0}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      }}
      aria-expanded={isExpanded}
      className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ChevronRight
        className={cn(
          'size-4 shrink-0 text-muted-foreground transition-transform',
          isExpanded && 'rotate-90'
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        {/* IdentifierLink doesn't accept onClick — wrap it so the link
            navigates without also toggling the group (the wrapping
            div's onClick would otherwise fire on every click inside). */}
        <span onClick={(e) => e.stopPropagation()}>
          <IdentifierLink href={`/p-files/${encodeURIComponent(first.enroleeNumber)}`}>
            {first.fullName}
          </IdentifierLink>
        </span>
        <span className="ml-2 font-mono text-[10px] text-muted-foreground">
          {first.enroleeNumber}
        </span>
      </div>
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        {first.levelApplied ?? '—'}
      </span>
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        {first.classSection ?? '—'}
      </span>
      <Badge variant="secondary" className="font-mono text-[10px] tabular-nums">
        {rows.length} document{rows.length === 1 ? '' : 's'}
      </Badge>
    </div>
  );
}
```

Wire into the `<DataTable>` call the same way as Step 2.

- [ ] **Step 4: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 5: Manual verification read-through**

Confirm both tables' distinct URL namespaces (`awaiting` / `expiring`) are untouched — this change doesn't touch the `url` prop at all. Confirm `AwaitingQueue`'s triage-mode branch and `isOfficer`-gated actions column are unaffected — expandable grouping only changes the `mode === 'table'` render, and the actions column (whichever columns remain after removing `fullName`) is unchanged. Confirm `ExpiringQueue`'s window filter (`≤30d/≤60d/≤90d`) still works — it filters `rows` before they ever reach `<DataTable data={filtered} ...>`, so grouping (which operates on whatever rows the shell receives) automatically respects the window filter with no additional wiring needed.

- [ ] **Step 6: Run the full test suite**

```bash
npx vitest run
```

Expected: no new failures.

- [ ] **Step 7: Commit**

```bash
git add components/p-files/document-validation/awaiting-queue.tsx components/p-files/document-validation/expiring-queue.tsx
git commit -m "feat(p-files): group awaiting + expiring document queues by student with expand/collapse"
```

## Notes

- Roadmap items 3–6 (grading table progress bar, staff-accounts toggle switch, `level-mismatches-table.tsx` migration, `ay-setup`/`document-completeness` expandable rows) are separate future work, not touched by this plan.
- `document-completeness-table.tsx` and `ay-setup-data-table.tsx` were flagged in the original audit as further candidates for this same `expandable` capability — now that Task 1 ships it, applying it there is a much smaller follow-on (no shell work, just the same column-removal + group-header pattern as Tasks 2/3) whenever that's prioritized.
- Per-page (not cross-page) grouping was a deliberate scope decision this session, given these queues' typical row volumes — flag to the user if a future consumer of `expandable` has high enough volume that this becomes a real problem; group-aware pagination would be a separate, larger follow-on to the shell.
