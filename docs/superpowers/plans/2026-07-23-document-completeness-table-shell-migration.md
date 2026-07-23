# Document Completeness Table → Shared DataTable Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `components/shared/document-completeness-table.tsx` — currently ~1000 lines hand-rolled on raw `@/components/ui/table` with manually-reimplemented search/filter/sort/pagination/selection/bulk-actions — to use the shared `<DataTable>` shell (`components/ui/data-table/`), closing the biggest baseline-parity gap found in this session's data-table audit. This is step 1 of the approved data-table roadmap (`docs/superpowers/specs/` — see the plan-mode audit captured this session; roadmap items 2–6 are separate future work, not in scope here).

**Architecture:** One component, two module-discriminated callers (`module: 'admissions' | 'p-files'`), reused across 3 render sites (`app/(admissions)/admissions/page.tsx` once, `app/(p-files)/p-files/page.tsx` twice in mutually-exclusive branches — confirmed via reading the surrounding conditional, never both on one request). The external prop API (`module`, `students`, `ayCode`, `initialStatusFilter`, `bulkRemindEnabled`, `bulkRemindWindowDays`) stays **unchanged** — all 3 call sites need zero edits. Columns become a `buildColumns(module, ...)` function (same established pattern as `staff-accounts-client.tsx`), with a dynamic slot-column set computed from the union of all students' `slots` (same as today, just via `React.useMemo` feeding a `ColumnDef[]` instead of manual `<TableHead>` JSX). Selection + bulk-remind moves from hand-rolled `Set<string>` state + a custom sticky footer to the shell's native `selection`/`bulkActions` (`BulkAction<TRow>.onTrigger(selectedRows)`).

**Tech Stack:** Next.js 16 client component, `@tanstack/react-table` via the shared shell, shadcn primitives, `BulkNotifyDialog` (unchanged, reused as-is).

## Global Constraints

- **External prop API unchanged.** `module`, `students`, `ayCode`, `initialStatusFilter`, `bulkRemindEnabled`, `bulkRemindWindowDays` keep their exact names/types/optionality (see current `AdmissionsProps`/`PFilesProps`/`Props` union). All 3 call sites (`app/(admissions)/admissions/page.tsx:275`, `app/(p-files)/p-files/page.tsx:299` and `:547`) must compile and behave identically with zero edits.
- **Keep the `key={...}` remount pattern at the call sites — do not try to "improve" it away.** Both pages pass `key={`${selectedAy}:${focusedStatus}`}`-style keys specifically so the component remounts (and re-reads `initialStatusFilter`) when the server-resolved URL-derived value changes. The temptation is to replace this with the shell's own `url` state reading the bare `?status=` query param directly — **do not do this**: the shell's `useUrlState` always prepends the table's namespace to any param key (`paramKeys` overrides the _name_ within the namespace, never removes the namespace — verified by reading `use-url-state.ts::key()`), and running the shell **without** a namespace on this table would reintroduce the exact "namespace footgun" this codebase already got bitten by once (KD #84 history: a namespace-less table treats every non-reserved page query param — here, `?ay=` and P-Files' `?expiring=` — as a phantom facet filter, zeroing tab/status counts). Give this table's shell config a real namespace (`completeness`) for search/facets/pagination, and let the status filter's _initial_ value keep coming from the `initialStatusFilter` prop exactly as today (via `statusTabs[].isDefault`) — the remount hack is the correct, low-risk mechanism for this and stays.
- **Slot columns stay dynamic**, computed once per render from the union of all `students[].slots` (matches current `slotHeaders` memo) — never hardcode a fixed slot list, since `DOCUMENT_SLOTS` membership differs by scope/era of data.
- **Bulk-remind and per-row-remind must both keep working, wired to the same unmodified `BulkNotifyDialog`.** Two separate dialog instances today (bulk selection → `bulkOpen`/`bulkItems`; single row → `perRowOpen`/`perRowItems`) — preserve this two-dialog structure, don't try to merge them.
- Design system compliance (Hard Rule #7): no raw hex/oklch/slate/zinc/gray/bg-white/bg-black; reuse existing `CompletePct`/`StatusDot`/`abbreviateSlotLabel` helpers verbatim — they're pure presentational functions with no dependency on the old table markup, keep them as-is.
- `admissionsBulkTargets` / `pfilesBulkTargets` (the functions that decide which slots are reminder-eligible per student) are pure business logic — copy verbatim, do not alter their conditions.

---

### Task 1: Column definitions + core shell wiring (read-only: search, facets, statusTabs, csv, url, pagination)

**Files:**

- Modify: `components/shared/document-completeness-table.tsx`

**Interfaces:**

- Consumes: `AdmissionsCompleteness` (`lib/admissions/dashboard.ts` — `{ enroleeNumber, studentNumber, fullName, level, section, applicationStatus, submittedDate, total, complete, toFollow, rejected, uploaded, expired, slots: AdmissionsCompletenessSlot[] }`), `StudentCompleteness` (`lib/p-files/queries.ts` — `{ enroleeNumber, studentNumber, fullName, level, section, total, complete, expired, missing, uploaded, slots: {...}[] }`), `DOCUMENT_SLOTS`/`DocumentStatus` (`lib/p-files/document-config.ts`), `TABLE_COPY` (`lib/copy/data-table.ts`).
- Produces: `buildColumns(module, slotHeaders, ayCode): ColumnDef<CommonRow>[]` (module-discriminated: 4th column is `applicationStatus` for admissions, `section` for p-files, matching current `status4` sort key's dual meaning) — consumed by Task 2, which adds the trailing actions column and wires selection.

- [ ] **Step 1: Read the current file in full before editing**

`components/shared/document-completeness-table.tsx` is ~1000 lines. Read it completely first — this task rewrites its structure but keeps several pieces verbatim (`StatusDot`, `CompletePct`, `pct()`, `abbreviateSlotLabel`, `admissionsBulkTargets`, `pfilesBulkTargets`, the `CommonRow`/`AdmissionsProps`/`PFilesProps`/`Props` types). Do not touch the two caller files yet — that's Task 2's final verification step.

- [ ] **Step 2: Replace the top-level imports**

Remove: `Checkbox` (moves to shell-native selection in Task 2, not needed here), `Table`/`TableBody`/`TableCell`/`TableHead`/`TableHeader`/`TableRow` (from `@/components/ui/table` — no longer used), `ArrowDown`/`ArrowUp`/`ChevronLeft`/`ChevronRight`/`ChevronsLeft`/`ChevronsRight`/`ChevronsUpDown` (the old custom `SortButton` + pagination — the shell provides both), `X` (old Clear-filters icon — the shell's toolbar has its own).

Add:

```tsx
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/ui/data-table';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
```

Keep: `Link`, `Mail`, `Search` (still used — `Search` may now be unused if the shell's own search input replaces it; check and remove if so), `IdentifierLink`, `Badge`, `Button`, `Card`/`CardContent`/`CardDescription`/`CardHeader`/`CardTitle`, `BulkNotifyDialog`/`BulkNotifyItem`, the two data types, `DOCUMENT_SLOTS`/`DocumentStatus`, `TABLE_COPY`.

- [ ] **Step 3: Keep verbatim — do not modify**

`StatusDot`, `CompletePct`, `pct()`, `abbreviateSlotLabel`, `admissionsBulkTargets`, `pfilesBulkTargets`, `CommonRow`, `AdmissionsProps`, `PFilesProps`, `Props`. Delete the now-unused `SortKey`/`SortDir`/`SortButton` (lines 270–306 in the current file) — the shell's `SortableHeader` replaces this entirely.

- [ ] **Step 4: Write `buildColumns`**

```tsx
function buildColumns(
  module: Module,
  slotHeaders: { key: string; label: string }[],
  actionHref: (enroleeNumber: string) => string
): ColumnDef<CommonRow>[] {
  const identifierLabel = module === 'admissions' ? 'Applicant' : 'Student';

  const columns: ColumnDef<CommonRow>[] = [
    {
      id: 'name',
      accessorFn: (row) => row.fullName,
      header: ({ column }) => (
        <SortableHeader column={column}>{identifierLabel}</SortableHeader>
      ),
      cell: ({ row }) => (
        <div>
          <IdentifierLink
            href={actionHref(row.original.enroleeNumber)}
            className="text-sm"
          >
            {row.original.fullName}
          </IdentifierLink>
          <div className="font-mono text-[10px] text-muted-foreground">
            {row.original.studentNumber ?? row.original.enroleeNumber}
          </div>
        </div>
      ),
      enableHiding: false,
    },
    {
      id: 'level',
      accessorFn: (row) => row.level ?? '',
      header: ({ column }) => (
        <SortableHeader column={column}>Level</SortableHeader>
      ),
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {row.original.level ?? '—'}
        </span>
      ),
    },
    {
      id: 'status4',
      accessorFn: (row) =>
        module === 'admissions'
          ? ((row as AdmissionsCompleteness).applicationStatus ?? '')
          : ((row as StudentCompleteness).section ?? ''),
      header: ({ column }) => (
        <SortableHeader column={column}>
          {module === 'admissions' ? 'Status' : 'Section'}
        </SortableHeader>
      ),
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {module === 'admissions'
            ? ((row.original as AdmissionsCompleteness).applicationStatus ??
              '—')
            : ((row.original as StudentCompleteness).section ?? '—')}
        </span>
      ),
    },
  ];

  for (const h of slotHeaders) {
    columns.push({
      id: `slot:${h.key}`,
      accessorFn: (row) =>
        row.slots.find((sl) => sl.key === h.key)?.status ?? '',
      header: () => (
        <span
          className="inline-block max-w-[60px] truncate text-center text-[10px]"
          title={h.label}
        >
          {abbreviateSlotLabel(h.label)}
        </span>
      ),
      cell: ({ row }) => {
        const status = row.original.slots.find(
          (sl) => sl.key === h.key
        )?.status;
        return (
          <div className="text-center">
            {status ? (
              <StatusDot status={status} />
            ) : (
              <span className="text-[10px] text-muted-foreground">—</span>
            )}
          </div>
        );
      },
      enableSorting: false,
    });
  }

  columns.push({
    id: 'pct',
    accessorFn: (row) => pct(row.total, row.complete),
    header: ({ column }) => <SortableHeader column={column}>%</SortableHeader>,
    cell: ({ row }) => (
      <div className="text-center">
        <CompletePct pct={pct(row.original.total, row.original.complete)} />
      </div>
    ),
  });

  return columns;
}
```

Note: the trailing "Action" column (per-row Remind button + View link) is added in Task 2, since it depends on the bulk-remind wiring — do not add it here.

- [ ] **Step 5: Rewrite the component body's data-shaping (levels/sections/slotHeaders memos stay, filtering/sorting/pagination state is deleted)**

Keep: the `levels`/`sections`/`slotHeaders` `React.useMemo`s (still needed — `sections` feeds a facet, `slotHeaders` feeds `buildColumns`), `querySuffix`, `actionHref`, `identifierLabel`/`emptyLabel`/`countLabel`/`cardTitle`/`cardDescription` (module-specific strings).

Delete: `statusFilter`/`search`/`levelFilter`/`sectionFilter`/`pageIndex`/`pageSize`/`sortKey`/`sortDir` state, the `filtered`/`sorted` memos, the two `useEffect`s (page-reset-on-filter-change, drop-stale-selection — the shell handles both internally), `handleSort`, `pageCount`/`paged`/`pageIds`/`allPageSelected`/`somePageSelected`/`togglePage`/`toggleRow`, `hasFilter`, `fixedColCount`.

Keep for Task 2: `selected`/`bulkOpen`/`perRowOpen`/`perRowItems`/`bulkItems` state and the `bulkItems` memo — these move into Task 2's step, not deleted here, just not yet wired to the shell.

- [ ] **Step 6: Render via `<DataTable>`**

Replace the `<Card>` JSX body (the hand-rolled `<Table>` + custom toolbar + custom pagination) with:

```tsx
const columns = React.useMemo(
  () => buildColumns(module, slotHeaders, actionHref),
  [module, slotHeaders, actionHref]
);

const statusOptions: { value: string; label: string }[] =
  module === 'admissions'
    ? [
        { value: 'to-follow', label: TABLE_COPY.awaitingParentReply },
        { value: 'rejected', label: TABLE_COPY.sentBackToParent },
        { value: 'uploaded', label: TABLE_COPY.awaitingValidation },
        { value: 'expired', label: TABLE_COPY.lapsedReupload },
      ]
    : [{ value: 'expired', label: TABLE_COPY.lapsedReupload }];

return (
  <Card>
    <CardHeader className="gap-2">
      <CardTitle>{cardTitle}</CardTitle>
      <CardDescription>{cardDescription}</CardDescription>
    </CardHeader>
    <CardContent className="px-0">
      <DataTable<CommonRow>
        data={students}
        columns={columns}
        getRowId={(row) => row.enroleeNumber}
        searchKeys={['fullName', 'studentNumber', 'enroleeNumber']}
        searchPlaceholder="Search by name or number…"
        facets={[
          { columnId: 'level', label: 'Level', valueOptions: levels },
          ...(module === 'p-files' && sections.length > 0
            ? [
                {
                  columnId: 'status4',
                  label: 'Section',
                  valueOptions: sections,
                },
              ]
            : []),
        ]}
        statusTabs={[
          {
            value: 'all',
            label: 'All',
            predicate: () => true,
            isDefault:
              props.initialStatusFilter === undefined ||
              props.initialStatusFilter === 'all',
          },
          ...statusOptions.map((opt) => ({
            value: opt.value,
            label: opt.label,
            predicate: (row: CommonRow) => {
              if (opt.value === 'expired') return row.expired > 0;
              if (module === 'admissions') {
                const a = row as AdmissionsCompleteness;
                if (opt.value === 'to-follow') return a.toFollow > 0;
                if (opt.value === 'rejected') return a.rejected > 0;
                if (opt.value === 'uploaded') return a.uploaded > 0;
              }
              return false;
            },
            isDefault: props.initialStatusFilter === opt.value,
          })),
        ]}
        csv={{ filename: `${countLabel}-completeness.csv` }}
        url={{ enabled: true, namespace: 'completeness' }}
        initialSort={[{ id: 'name', desc: false }]}
        pageSizeOptions={[10, 25, 50, 100]}
        pageSize={25}
        emptyState={{ icon: Search, title: emptyLabel }}
        emptyFilteredState={{ title: emptyLabel }}
      />
    </CardContent>
  </Card>
);
```

Note the `statusTabs[].isDefault` computation directly from the `initialStatusFilter` prop — this is what preserves the deep-link-opens-pre-filtered behavior without touching the shell's own url-reading for status, per the Global Constraints note on the `key` remount pattern.

- [ ] **Step 7: Verify column facet id mismatch risk**

The `facets` config above references `columnId: 'status4'` for the P-Files section facet, reusing the same column that also holds admissions' `applicationStatus`. Double check this doesn't cause label confusion in the admissions case (it shouldn't — the p-files-only conditional spread means this facet entry never appears for `module === 'admissions'`), but read the final rendered facet dropdown's `valueOptions` (`sections`) against the column's actual `accessorFn` output to confirm they match before moving on.

- [ ] **Step 8: Run typecheck**

```bash
npx tsc --noEmit
```

Expect a number of errors at this point — Task 2 hasn't wired the still-referenced `selected`/`bulkOpen`/etc. state into anything yet, and the actions column doesn't exist. This step is a checkpoint to confirm Steps 1-7's own code (columns, DataTable wiring, deleted old state) is internally consistent — fix any error that is NOT about the not-yet-added actions column or not-yet-consumed selection state. If unsure whether an error belongs to Task 1 or Task 2's scope, treat it as Task 1's if it's about a column/facet/statusTab you just wrote, Task 2's if it's about `selected`/`bulkOpen`/`perRowOpen`/`bulkItems`/`BulkNotifyDialog`.

- [ ] **Step 9: Commit**

```bash
git add components/shared/document-completeness-table.tsx
git commit -m "refactor(shared): rebuild DocumentCompletenessTable columns on the shared DataTable shell (read-only wiring)"
```

---

### Task 2: Selection + bulk-remind + per-row-remind wiring, verify all 3 call sites

**Files:**

- Modify: `components/shared/document-completeness-table.tsx`

**Interfaces:**

- Consumes: `buildColumns` from Task 1 (extend with a trailing actions column), `BulkAction<TRow>` shape (`components/ui/data-table/bulk-action-footer.tsx` — `{ key, label, icon?, onTrigger: (selectedRows: TRow[]) => void | Promise<void>, destructive? }`), `SelectionConfig<TRow>` (`components/ui/data-table/types.ts` — `{ enabled, bulkActions?, enableRowSelection? }`), `BulkNotifyDialog`/`BulkNotifyItem` (unchanged, `components/p-files/bulk-notify-dialog.tsx`).
- Produces: nothing consumed further — this is the final task.

- [ ] **Step 1: Add the trailing actions column**

Extend `buildColumns` (from Task 1's Step 4) — it goes from 3 params to 6, adding `bulkRemindEnabled`, `onRemindOne`, and `bulkRemindWindowDays` — plus one final column:

```tsx
function buildColumns(
  module: Module,
  slotHeaders: { key: string; label: string }[],
  actionHref: (enroleeNumber: string) => string,
  bulkRemindEnabled: boolean,
  onRemindOne: (items: BulkNotifyItem[]) => void,
  bulkRemindWindowDays: number | null
): ColumnDef<CommonRow>[] {
  // ...same columns as Task 1's Step 4, then:

  columns.push({
    id: 'actions',
    header: '',
    cell: ({ row }) => {
      const href = actionHref(row.original.enroleeNumber);
      const items = bulkRemindEnabled
        ? module === 'admissions'
          ? admissionsBulkTargets(row.original as AdmissionsCompleteness)
          : pfilesBulkTargets(
              row.original as StudentCompleteness,
              bulkRemindWindowDays
            )
        : [];
      return (
        <div className="inline-flex items-center justify-end gap-2">
          {bulkRemindEnabled && items.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
              aria-label={`Send reminder to ${row.original.fullName}`}
              onClick={() => onRemindOne(items)}
            >
              <Mail className="size-3" />
              Remind
            </Button>
          )}
          <Link
            href={href}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            View
            <ArrowUpRight className="size-3" />
          </Link>
        </div>
      );
    },
    enableSorting: false,
    enableHiding: false,
  });

  return columns;
}
```

`ArrowUpRight` needs re-adding to the imports (it was on the original import list; confirm it wasn't accidentally dropped in Task 1's Step 2).

- [ ] **Step 2: Wire selection + bulk action in the component body**

This step's `columns` memo **replaces** Task 1 Step 6's 3-arg version — there is only ever one `columns` memo in the finished file; do not leave both.

```tsx
const [bulkOpen, setBulkOpen] = React.useState(false);
const [perRowOpen, setPerRowOpen] = React.useState(false);
const [perRowItems, setPerRowItems] = React.useState<BulkNotifyItem[]>([]);
const [bulkItems, setBulkItems] = React.useState<BulkNotifyItem[]>([]);
const [selectionResetSignal, setSelectionResetSignal] = React.useState(0);

function handleRemindOne(items: BulkNotifyItem[]) {
  setPerRowItems(items);
  setPerRowOpen(true);
}

function handleSendReminders(selectedRows: CommonRow[]) {
  const out: BulkNotifyItem[] = [];
  for (const s of selectedRows) {
    if (module === 'admissions') {
      out.push(...admissionsBulkTargets(s as AdmissionsCompleteness));
    } else {
      out.push(
        ...pfilesBulkTargets(s as StudentCompleteness, bulkRemindWindowDays)
      );
    }
  }
  setBulkItems(out);
  setBulkOpen(true);
}

const columns = React.useMemo(
  () =>
    buildColumns(
      module,
      slotHeaders,
      actionHref,
      bulkRemindEnabled,
      handleRemindOne,
      bulkRemindWindowDays
    ),
  [module, slotHeaders, actionHref, bulkRemindEnabled, bulkRemindWindowDays]
);
```

Add to the `<DataTable>` props (from Task 1's Step 6):

```tsx
selection={
  bulkRemindEnabled
    ? {
        enabled: true,
        bulkActions: [
          {
            key: 'send-reminders',
            label: 'Send reminders',
            icon: Mail,
            onTrigger: handleSendReminders,
          },
        ],
      }
    : undefined
}
selectionResetSignal={selectionResetSignal}
```

`getRowId={(row) => row.enroleeNumber}` (already set in Task 1) is what the shell uses to track selection — no change needed there.

- [ ] **Step 3: Mount both `BulkNotifyDialog`s, with the reset signal wired on success**

After the `</DataTable>`/`</CardContent>` close, before `</Card>`:

```tsx
{
  bulkRemindEnabled && (
    <>
      <BulkNotifyDialog
        items={bulkItems}
        module={module}
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        onSuccess={() => setSelectionResetSignal((n) => n + 1)}
      />
      <BulkNotifyDialog
        items={perRowItems}
        module={module}
        open={perRowOpen}
        onOpenChange={(open) => {
          setPerRowOpen(open);
          if (!open) setPerRowItems([]);
        }}
      />
    </>
  );
}
```

Note: `onSuccess` clearing selection via `selectionResetSignal` (an incrementing counter the shell watches, per `DataTableProps.selectionResetSignal`'s documented purpose "clears the current row selection... use after a bulk action completes") replaces the old `setSelected(new Set())` call — this is the one behavior difference from the original hand-rolled version, and it's the shell's documented, intended mechanism for exactly this case, not a workaround.

- [ ] **Step 4: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: 0 errors. Fix anything remaining from Task 1's Step 8 checkpoint plus anything new from this task's wiring.

- [ ] **Step 5: Verify all 3 call sites need zero changes**

```bash
git diff --stat HEAD -- app/\(admissions\)/admissions/page.tsx app/\(p-files\)/p-files/page.tsx
```

Expected: no output (zero changes to either file) — confirms the external prop API held. If either file shows a diff, STOP and figure out why before proceeding — the Global Constraints require these call sites to need zero edits.

Read `app/(admissions)/admissions/page.tsx:275-282` and `app/(p-files)/p-files/page.tsx:299-307` and `:547-553` one more time and manually trace: does the `key={...}` prop still make sense given the component now also carries its own shell-managed url-state (search text, facets, pagination) under the `completeness` namespace? Confirm: remounting via `key` resets the shell's namespaced url-state too (since it's a fresh component instance reading fresh `useSearchParams()` on mount) — this matches the current file's existing behavior (a remount already resets local `search`/`levelFilter`/etc. state today), so it is not a new regression, just carried forward. Note this confirmation in your report — don't silently skip it.

- [ ] **Step 6: Run the full test suite**

```bash
npx vitest run
```

Expected: no new failures. This component has no direct unit tests today (it's a presentational client component); if `npx vitest run --related components/shared/document-completeness-table.tsx` (or an equivalent targeted run) surfaces any test importing it, read and address that specifically.

- [ ] **Step 7: Manual verification read-through**

Static read-through (no browser access assumed) covering both modules' distinct behavior:

- Admissions: 4 status filter options (to-follow/rejected/uploaded/expired) all present, section facet absent (p-files-only).
- P-Files: 1 status filter option (expired only), section facet present when `sections.length > 0`.
- Bulk-remind only renders (selection enabled) when `bulkRemindEnabled` is true — confirm the `selection` prop's `undefined` fallback correctly hides bulk UI entirely when false, matching the old `bulkRemindEnabled &&` gates throughout the original file.
- Per-row Remind button only shows when `items.length > 0` for that row (a fully-complete student has zero reminder targets) — confirm this guard survived into the new actions column.
- If browser access is available: visit `/admissions` and `/p-files`, open the Document Completeness table, exercise search/facets/status-tabs/sort/pagination, select 2+ rows and confirm the bulk-action footer + "Send reminders" opens the dialog with the right item count, clear selection, click a single row's "Remind" button and confirm the per-row dialog opens with just that student's items, confirm both `/admissions?status=expired`-style and `/p-files?expiring=30`-style deep links still land pre-filtered.

- [ ] **Step 8: Commit**

```bash
git add components/shared/document-completeness-table.tsx
git commit -m "feat(shared): wire selection + bulk/per-row remind into DocumentCompletenessTable's shell migration"
```

## Notes

- Roadmap items 2–6 (expandable rows on the document-validation queues, `grading_pct` progress bar, staff-accounts toggle, `level-mismatches-table` migration, and the rest) are separate future work — not touched by this plan.
- This migration deliberately does **not** add expandable/nested rows (Category B from the audit) even though this exact table's student→document-slot shape is a strong candidate — that capability doesn't exist in the shell yet and is roadmap item 2's job, applied first to the smaller document-validation queues before this table.
- The `%` completion column stays a `CompletePct` badge in this migration, not a progress bar — Category C (progress-bar cells) is a follow-on polish pass once the shell migration itself is proven, not bundled into the same change.
