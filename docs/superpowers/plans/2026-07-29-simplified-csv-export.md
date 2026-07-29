# Simplified CSV Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the five-section CSV export sheet with an instant download on 15 tables and a three-option radio on `StudentDataTable`.

**Architecture:** Extract the field-building logic out of `export-sheet.tsx` into a pure module both surfaces share. The shell's Export CSV button then branches: no `csv.rawColumns` → download immediately from the table's own sorted row model; `csv.rawColumns` present → open a slim sheet offering "what's on screen" plus table-declared presets that pull raw DB columns. Everything else in the old sheet is deleted.

**Tech Stack:** Next.js 16, React 19, TanStack Table v8, TypeScript, Vitest + @testing-library/react (jsdom).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-29-simplified-csv-export-design.md`. Read it before Task 1.
- **Never edit `.claude/worktrees/`** — it holds stale copies of every file below. Only touch `components/`, `app/`, `__tests__/`.
- Output for the 15 instant-download tables must stay **byte-identical to today's untouched export**: export-eligible visible columns in screen order + `defaultChecked` extras. **One deliberate exception (user ruling, 2026-07-29):** a column whose value is an object is **dropped from the export entirely** — neither `[object Object]` (the old on-screen behaviour) nor a JSON blob (the old raw-column behaviour) is useful in a spreadsheet. This applies to on-screen columns and raw DB columns alike; the clearest real case is `residenceHistory` on `ay####_enrolment_applications`.
- Column headers come from `resolveColumnDefLabel` (KD #161); raw DB columns from `humanizeFieldName`. Do not hand-roll either.
- `meta.excludeFromExport` must keep excluding columns. `NON_DATA_COLUMN_IDS` = `select`, `actions`, `action`, `open`.
- No changes to `POST /api/sis/students/raw-columns` or its role gate.
- Plain-English UI copy — school admins are not IT staff.
- Run `npx tsc --noEmit` (must print nothing) and the touched test files after every task.
- Tests must `import { describe, it, expect, vi } from 'vitest'` explicitly.

---

### Task 1: Extract the export payload builder

Pulls the field-building logic out of the sheet so the shell can export without mounting it. Pure module, no React.

**Files:**

- Create: `components/ui/data-table/export-payload.ts`
- Test: `__tests__/ui/data-table-export-payload.test.ts`

**Interfaces:**

- Consumes: `resolveColumnValue` from `./filter-rows`, `resolveColumnDefLabel` from `./column-label`, `CsvExtraColumn` from `./types`.
- Produces: `type ExportField<TRow>`, `isExportableColumn(col)`, `resolveColumnId(col)`, `buildScreenFields(columns, visibleColumnIds, extraColumns)`, `fieldsToCsvColumns(rows, fields)`. Tasks 2 and 3 both import these.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/ui/data-table-export-payload.test.ts
import { describe, expect, it } from 'vitest';
import type { ColumnDef } from '@tanstack/react-table';
import {
  buildScreenFields,
  fieldsToCsvColumns,
} from '@/components/ui/data-table/export-payload';

type Row = { id: string; name: string; level: string };

const rows: Row[] = [
  { id: '1', name: 'Alpha', level: 'P1' },
  { id: '2', name: 'Bravo', level: 'P2' },
];

const columns: ColumnDef<Row>[] = [
  { id: 'select', header: '', cell: () => null },
  { id: 'name', accessorKey: 'name', header: 'Student' },
  { id: 'level', accessorKey: 'level', header: 'Level' },
  {
    id: 'secret',
    accessorKey: 'level',
    header: 'Secret',
    meta: { excludeFromExport: true },
  },
  { id: 'actions', header: '', cell: () => null },
];

describe('buildScreenFields', () => {
  it('keeps only visible, export-eligible columns in visible order', () => {
    const fields = buildScreenFields(
      columns,
      ['level', 'name', 'secret', 'actions'],
      undefined
    );
    expect(fields.map((f) => f.id)).toEqual(['level', 'name']);
    expect(fields.map((f) => f.header)).toEqual(['Level', 'Student']);
  });

  it('appends only defaultChecked extras', () => {
    const fields = buildScreenFields(
      columns,
      ['name'],
      [
        {
          id: 'x',
          header: 'Included',
          accessor: () => 'x',
          defaultChecked: true,
        },
        { id: 'y', header: 'Omitted', accessor: () => 'y' },
      ]
    );
    expect(fields.map((f) => f.id)).toEqual(['name', 'x']);
  });

  it('renders booleans as Yes/No, not true/false', () => {
    const boolCols: ColumnDef<Row>[] = [
      { id: 'flag', accessorFn: () => true, header: 'Flag' },
    ];
    const [field] = buildScreenFields(boolCols, ['flag'], undefined);
    expect(field.accessor(rows[0], 0)).toBe('Yes');
  });
});

describe('fieldsToCsvColumns', () => {
  it('resolves each row against its final index', () => {
    const fields = buildScreenFields(
      [{ id: 'pos', accessorFn: (_r, i) => i + 1, header: 'Position' }],
      ['pos'],
      undefined
    );
    const cols = fieldsToCsvColumns(rows, fields);
    expect(cols[0].header).toBe('Position');
    expect(cols[0].accessor(rows[1])).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/ui/data-table-export-payload.test.ts`
Expected: FAIL — cannot resolve `@/components/ui/data-table/export-payload`.

- [ ] **Step 3: Write the module**

```ts
// components/ui/data-table/export-payload.ts
import type { ColumnDef } from '@tanstack/react-table';

import { resolveColumnDefLabel } from './column-label';
import { resolveColumnValue } from './filter-rows';
import type { CsvExtraColumn } from './types';

// Non-data columns every DataTable consumer uses the same ids for — never
// exported. `action` (singular) is section-roster-table's; `open` is the
// audit logs' row-action link menu.
const NON_DATA_COLUMN_IDS = new Set(['select', 'actions', 'action', 'open']);

/** One exportable field — an on-screen column, a declared extra, or a raw
 *  DB column. Every export surface builds its CSV from this shape. */
export type ExportField<TRow> = {
  id: string;
  header: string;
  accessor: (row: TRow, index: number) => string | number | null;
};

export function resolveColumnId<TRow>(col: ColumnDef<TRow>): string {
  return col.id ?? (col as { accessorKey?: string }).accessorKey ?? '';
}

export function isExportableColumn<TRow>(col: ColumnDef<TRow>): boolean {
  const id = resolveColumnId(col);
  if (NON_DATA_COLUMN_IDS.has(id)) return false;
  return !col.meta?.excludeFromExport;
}

function toCell(v: unknown): string | number | null {
  if (v == null) return null;
  // Match the on-screen Yes/No convention (field-grid.tsx) rather than
  // exporting the literal strings "true"/"false".
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'object') return JSON.stringify(v);
  return v as string | number;
}

/**
 * The default export column set: the export-eligible columns the user can
 * currently SEE, in the order they see them, plus any extras the table
 * flagged `defaultChecked`. This is exactly what the old export sheet
 * seeded, so a plain export produces the same file it always did.
 */
export function buildScreenFields<TRow>(
  columns: ColumnDef<TRow>[],
  visibleColumnIds: string[],
  extraColumns: Array<CsvExtraColumn<TRow>> | undefined
): ExportField<TRow>[] {
  const byId = new Map<string, ColumnDef<TRow>>();
  for (const c of columns) byId.set(resolveColumnId(c), c);

  const columnFields = visibleColumnIds
    .map((id) => byId.get(id))
    .filter((c): c is ColumnDef<TRow> => Boolean(c) && isExportableColumn(c!))
    .map((c) => {
      const id = resolveColumnId(c);
      return {
        id,
        header: resolveColumnDefLabel(c),
        accessor: (row: TRow, index: number) =>
          toCell(resolveColumnValue(columns, id, row, index)),
      };
    });

  const extraFields = (extraColumns ?? [])
    .filter((e) => e.defaultChecked)
    .map((e) => ({
      id: e.id,
      header: e.header,
      accessor: (row: TRow) => e.accessor(row),
    }));

  return [...columnFields, ...extraFields];
}

/**
 * Bind fields to a concrete row list for `exportCsv`. Pre-computing the
 * row->index map keeps index-dependent accessors O(1) per row instead of
 * an O(n^2) indexOf scan.
 */
export function fieldsToCsvColumns<TRow>(
  rows: TRow[],
  fields: ExportField<TRow>[]
): Array<{ header: string; accessor: (row: TRow) => string | number | null }> {
  const rowIndex = new Map<TRow, number>(rows.map((r, i) => [r, i]));
  return fields.map((f) => ({
    header: f.header,
    accessor: (row: TRow) => f.accessor(row, rowIndex.get(row) ?? 0),
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/ui/data-table-export-payload.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc --noEmit
git add components/ui/data-table/export-payload.ts __tests__/ui/data-table-export-payload.test.ts
git commit -m "refactor(data-table): extract the export payload builder"
```

---

### Task 2: Instant download in the shell

**Files:**

- Modify: `components/ui/data-table/index.tsx` (the Export CSV button, currently lines 529-539)
- Test: `__tests__/ui/data-table-instant-export.test.tsx`

**Interfaces:**

- Consumes: `buildScreenFields`, `fieldsToCsvColumns` from Task 1; `exportCsv` from `./csv`.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/ui/data-table-instant-export.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/ui/data-table';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/test',
  useSearchParams: () => new URLSearchParams(),
}));

type Row = { id: string; name: string; level: string };

const rows: Row[] = [
  { id: '1', name: 'Alpha', level: 'P1' },
  { id: '2', name: 'Bravo', level: 'P2' },
];

const columns: ColumnDef<Row>[] = [
  {
    id: 'name',
    accessorKey: 'name',
    header: ({ column }) => (
      <SortableHeader column={column}>Student</SortableHeader>
    ),
    meta: { label: 'Student' },
  },
  { id: 'level', accessorKey: 'level', header: 'Level' },
];

function captureCsv() {
  let text = '';
  vi.spyOn(URL, 'createObjectURL').mockImplementation(
    (obj: Blob | MediaSource) => {
      void (obj as Blob).text().then((t) => {
        text = t;
      });
      return 'blob:mock';
    }
  );
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  return () => text;
}

describe('DataTable — instant CSV export (no rawColumns)', () => {
  it('downloads on click without opening a dialog', async () => {
    const user = userEvent.setup();
    const getCsv = captureCsv();

    render(
      <DataTable<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        csv={{ filename: 'test.csv' }}
      />
    );

    await user.click(screen.getByRole('button', { name: /Export CSV/ }));

    await waitFor(() => expect(getCsv()).not.toBe(''));
    const lines = getCsv().replace(/^﻿/, '').split('\n');
    expect(lines[0]).toBe('Student,Level');
    expect(lines[1]).toBe('Alpha,P1');

    // The whole point: no sheet.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('narrows to ticked rows when a selection is active', async () => {
    const user = userEvent.setup();
    const getCsv = captureCsv();

    render(
      <DataTable<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        csv={{ filename: 'test.csv' }}
        selection={{ enabled: true }}
      />
    );

    // Tick the first data row (checkbox 0 is the header select-all).
    const boxes = screen.getAllByRole('checkbox');
    await user.click(boxes[1]);
    await user.click(screen.getByRole('button', { name: /Export CSV/ }));

    await waitFor(() => expect(getCsv()).not.toBe(''));
    const lines = getCsv().replace(/^﻿/, '').split('\n');
    expect(lines).toHaveLength(2); // header + the one ticked row
    expect(lines[1]).toBe('Alpha,P1');
  });
});
```

(`SelectionConfig` requires only `enabled: boolean` — verified — so this
fixture compiles as written.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/ui/data-table-instant-export.test.tsx`
Expected: FAIL — a dialog opens, so `queryByRole('dialog')` is non-null and no blob is created.

- [ ] **Step 3: Branch the Export CSV button**

Add the imports near the other `./` imports in `components/ui/data-table/index.tsx`:

```tsx
import { exportCsv } from './csv';
import { buildScreenFields, fieldsToCsvColumns } from './export-payload';
```

Add this handler inside the component, next to the other callbacks:

```tsx
// Instant export — for tables with no raw-DB-column capability there is
// nothing to configure, so the button downloads what is on screen rather
// than opening a sheet. Rows come from the table's own sorted row model,
// which IS the current filter + sort, so the file can't disagree with the
// screen. A live row selection narrows it; nothing ticked means everything.
function handleInstantExport() {
  if (!csv) return;
  const scoped =
    selectedRows.length > 0
      ? selectedRows
      : table.getSortedRowModel().rows.map((r) => r.original);
  const fields = buildScreenFields(
    columns,
    table
      .getVisibleLeafColumns()
      .filter((c) => c.id !== 'select')
      .map((c) => c.id),
    csv.extraColumns
  );
  exportCsv(scoped, fieldsToCsvColumns(scoped, fields), csv.filename);
}
```

Replace the button's `onClick` (currently `() => setExportOpen(true)`):

```tsx
              onClick={() =>
                csv.rawColumns ? setExportOpen(true) : handleInstantExport()
              }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/ui/data-table-instant-export.test.tsx`
Expected: PASS

- [ ] **Step 5: Confirm no regression on the tables that still open a sheet**

Run: `npx vitest run __tests__/ui/data-table-export-sheet.test.tsx`
Expected: PASS — its fixture passes `rawColumns` in one test and not in others; any failure here means the branch is wrong. If a test fails only because it no longer opens a sheet, add `rawColumns` to that test's `csv` fixture rather than changing the branch.

- [ ] **Step 6: Type-check and commit**

```bash
npx tsc --noEmit
git add components/ui/data-table/index.tsx __tests__/ui/data-table-instant-export.test.tsx
git commit -m "feat(data-table): download immediately when there is nothing to configure"
```

---

### Task 3: Slim the export sheet to a preset radio

**Files:**

- Modify: `components/ui/data-table/types.ts` (add `exportPresets` to `CsvRawColumnsConfig`)
- Rewrite: `components/ui/data-table/export-sheet.tsx` (currently 1109 lines → ~180)
- Modify: `components/ui/data-table/index.tsx` (drop the props the sheet no longer takes)
- Test: `__tests__/ui/data-table-export-sheet.test.tsx` (rewrite)

**Interfaces:**

- Consumes: `ExportField`, `buildScreenFields`, `fieldsToCsvColumns` from Task 1.
- Produces: `CsvExportPreset` type used by Task 4.

- [ ] **Step 1: Add the preset type**

In `components/ui/data-table/types.ts`, above `CsvRawColumnsConfig`:

```ts
/**
 * A named "export everything from these sources" choice, offered alongside
 * the built-in "what's on screen" option. Declared per table because only
 * the table knows which of its raw sources belong together — e.g. the
 * applications record alone vs. the record plus its pipeline status.
 */
export type CsvExportPreset = {
  id: string;
  label: string;
  /** Ids of `CsvRawColumnsConfig.sources` this preset loads, in order. */
  sourceIds: string[];
};
```

and add to `CsvRawColumnsConfig`:

```ts
  exportPresets?: CsvExportPreset[];
```

- [ ] **Step 2: Write the failing test**

```tsx
// __tests__/ui/data-table-export-sheet.test.tsx  (replace the file)
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/ui/data-table';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import type { CsvConfig } from '@/components/ui/data-table/types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/test',
  useSearchParams: () => new URLSearchParams(),
}));

type Row = { id: string; name: string };

const rows: Row[] = [
  { id: '1', name: 'Alpha' },
  { id: '2', name: 'Bravo' },
];

const columns: ColumnDef<Row>[] = [
  {
    id: 'name',
    accessorKey: 'name',
    header: ({ column }) => (
      <SortableHeader column={column}>Student</SortableHeader>
    ),
    meta: { label: 'Student' },
  },
];

const fetchApps = vi.fn(async (keys: string[]) =>
  Object.fromEntries(keys.map((k) => [k, { nric: `N${k}`, dob: '2015-01-01' }]))
);
const fetchStatus = vi.fn(async (keys: string[]) =>
  Object.fromEntries(keys.map((k) => [k, { applicationStatus: 'Enrolled' }]))
);

const csv: CsvConfig<Row> = {
  filename: 'test.csv',
  rawColumns: {
    keyOf: (r) => r.id,
    sources: [
      { id: 'applications', label: 'Applications', fetch: fetchApps },
      { id: 'status', label: 'Status', fetch: fetchStatus },
    ],
    exportPresets: [
      {
        id: 'record',
        label: 'Full application record',
        sourceIds: ['applications'],
      },
      {
        id: 'full',
        label: 'Full record + pipeline',
        sourceIds: ['applications', 'status'],
      },
    ],
  },
};

function captureCsv() {
  let text = '';
  vi.spyOn(URL, 'createObjectURL').mockImplementation(
    (obj: Blob | MediaSource) => {
      void (obj as Blob).text().then((t) => {
        text = t;
      });
      return 'blob:mock';
    }
  );
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  return () => text;
}

async function openSheet() {
  const user = userEvent.setup();
  render(
    <DataTable<Row>
      data={rows}
      columns={columns}
      getRowId={(r) => r.id}
      csv={csv}
    />
  );
  await user.click(screen.getByRole('button', { name: /Export CSV/ }));
  return { user, dialog: await screen.findByRole('dialog') };
}

describe('DataTableExportSheet — preset choice', () => {
  it('shows the row count and defaults to what is on screen', async () => {
    const { dialog } = await openSheet();
    expect(within(dialog).getByText(/2 rows/)).toBeInTheDocument();
    expect(
      within(dialog).getByRole('radio', { name: /What's on screen/ })
    ).toBeChecked();
  });

  it('exports only the visible columns under the default option', async () => {
    const getCsv = captureCsv();
    const { user, dialog } = await openSheet();
    await user.click(within(dialog).getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(getCsv()).not.toBe(''));
    expect(getCsv().replace(/^﻿/, '').split('\n')[0]).toBe('Student');
    expect(fetchApps).not.toHaveBeenCalled();
  });

  it('loads one source for a single-source preset', async () => {
    const getCsv = captureCsv();
    const { user, dialog } = await openSheet();
    await user.click(
      within(dialog).getByRole('radio', { name: /Full application record/ })
    );
    await user.click(within(dialog).getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(getCsv()).not.toBe(''));
    const header = getCsv().replace(/^﻿/, '').split('\n')[0];
    expect(header).toContain('Nric');
    expect(header).not.toContain('Application Status');
    expect(fetchApps).toHaveBeenCalledWith(['1', '2']);
  });

  it('loads both sources for a multi-source preset', async () => {
    const getCsv = captureCsv();
    const { user, dialog } = await openSheet();
    await user.click(
      within(dialog).getByRole('radio', { name: /Full record \+ pipeline/ })
    );
    await user.click(within(dialog).getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(getCsv()).not.toBe(''));
    const header = getCsv().replace(/^﻿/, '').split('\n')[0];
    expect(header).toContain('Nric');
    expect(header).toContain('Application Status');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run __tests__/ui/data-table-export-sheet.test.tsx`
Expected: FAIL — the old sheet has no "Download" button, no radios, and no row-count text in this shape.

- [ ] **Step 4: Rewrite the sheet**

Replace the entire contents of `components/ui/data-table/export-sheet.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Download, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

import { exportCsv } from './csv';
import {
  buildScreenFields,
  fieldsToCsvColumns,
  type ExportField,
} from './export-payload';
import { humanizeFieldName } from './humanize-field';
import type { CsvConfig } from './types';

const SCREEN_OPTION = 'screen';

export type DataTableExportSheetProps<TRow> = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Rows in the CURRENT scope — already filtered, sorted and
   *  selection-narrowed by the shell. The sheet never re-filters. */
  rows: TRow[];
  columns: ColumnDef<TRow>[];
  visibleColumnIds: string[];
  csv: CsvConfig<TRow>;
};

export function DataTableExportSheet<TRow>({
  open,
  onOpenChange,
  rows,
  columns,
  visibleColumnIds,
  csv,
}: DataTableExportSheetProps<TRow>) {
  const [choice, setChoice] = useState<string>(SCREEN_OPTION);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed on each open so a previous run's choice never silently applies
  // to a different scope.
  useEffect(() => {
    if (open) {
      setChoice(SCREEN_OPTION);
      setError(null);
    }
  }, [open]);

  const presets = csv.rawColumns?.exportPresets ?? [];

  async function handleDownload() {
    setBusy(true);
    setError(null);
    try {
      let fields: ExportField<TRow>[];
      if (choice === SCREEN_OPTION) {
        fields = buildScreenFields(columns, visibleColumnIds, csv.extraColumns);
      } else {
        const cfg = csv.rawColumns;
        const preset = presets.find((p) => p.id === choice);
        if (!cfg || !preset) return;
        const keys = rows.map(cfg.keyOf);
        // Load each source the preset names, in declared order, so the
        // column order in the file follows the preset rather than whichever
        // request resolved first.
        // Two sources can share a column name (`enroleeNumber` exists on
        // both admissions tables), which would emit a duplicate CSV header.
        // Suffix with the source label only when a preset spans more than
        // one source, so single-source exports stay clean.
        const disambiguate = preset.sourceIds.length > 1;
        const loaded = await Promise.all(
          preset.sourceIds.map(async (sourceId) => {
            const source = cfg.sources.find((s) => s.id === sourceId);
            if (!source) return [];
            const data = await source.fetch(keys);
            // Drop object-valued columns (e.g. residenceHistory) — a JSON
            // blob in a spreadsheet cell helps nobody. Probe the first
            // non-null value per column name.
            const colNames = Array.from(
              new Set(Object.values(data).flatMap((r) => Object.keys(r)))
            ).filter((col) => {
              const sample = Object.values(data)
                .map((r) => r[col])
                .find((v) => v != null);
              return typeof sample !== 'object';
            });
            return colNames.map((col) => ({
              id: `raw:${sourceId}:${col}`,
              header: disambiguate
                ? `${humanizeFieldName(col)} (${source.label})`
                : humanizeFieldName(col),
              accessor: (row: TRow): string | number | null => {
                const v = data[cfg.keyOf(row)]?.[col];
                if (v == null) return null;
                if (typeof v === 'boolean') return v ? 'Yes' : 'No';
                if (typeof v === 'object') return JSON.stringify(v);
                return v as string | number;
              },
            }));
          })
        );
        fields = loaded.flat();
      }
      exportCsv(rows, fieldsToCsvColumns(rows, fields), csv.filename);
      onOpenChange(false);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Could not build the export. Try again.'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Export CSV</SheetTitle>
          <SheetDescription>
            {rows.length} rows will be exported, matching the filters on screen.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-5">
          <RadioGroup
            value={choice}
            onValueChange={setChoice}
            className="gap-3"
          >
            <div className="flex items-start gap-3">
              <RadioGroupItem
                value={SCREEN_OPTION}
                id="export-screen"
                className="mt-0.5"
              />
              <Label
                htmlFor="export-screen"
                className="flex-1 cursor-pointer font-normal"
              >
                <span className="block font-medium text-foreground">
                  What&apos;s on screen
                </span>
                <span className="block text-xs text-muted-foreground">
                  The columns this table is showing right now. Use the Columns
                  menu first if you want more.
                </span>
              </Label>
            </div>
            {presets.map((p) => (
              <div key={p.id} className="flex items-start gap-3">
                <RadioGroupItem
                  value={p.id}
                  id={`export-${p.id}`}
                  className="mt-0.5"
                />
                <Label
                  htmlFor={`export-${p.id}`}
                  className="flex-1 cursor-pointer font-normal"
                >
                  <span className="block font-medium text-foreground">
                    {p.label}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Every stored field, not just what fits on screen.
                  </span>
                </Label>
              </div>
            ))}
          </RadioGroup>

          {error && (
            <p className="mt-4 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>

        <SheetFooter>
          <Button onClick={handleDownload} disabled={busy}>
            {busy ? (
              <Loader2 className="mr-1 size-3.5 animate-spin" />
            ) : (
              <Download className="mr-1 size-3.5" />
            )}
            Download
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 5: Update the shell's mount**

In `components/ui/data-table/index.tsx`, replace the whole `<DataTableExportSheet ... />` block (currently lines 748-780) with:

```tsx
{
  csv && exportEverOpened && (
    <DataTableExportSheet
      open={exportOpen}
      onOpenChange={setExportOpen}
      rows={
        selectedRows.length > 0
          ? selectedRows
          : table.getSortedRowModel().rows.map((r) => r.original)
      }
      columns={columns}
      visibleColumnIds={table
        .getVisibleLeafColumns()
        .filter((c) => c.id !== 'select')
        .map((c) => c.id)}
      csv={csv}
    />
  );
}
```

Then delete anything this orphans — the `DataTableExportSeed` import/type usage and any now-unused local values feeding the old props. Let `npx tsc --noEmit` tell you what is dead.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run __tests__/ui/data-table-export-sheet.test.tsx __tests__/ui/data-table-instant-export.test.tsx`
Expected: PASS (5 tests)

- [ ] **Step 7: Type-check and commit**

```bash
npx tsc --noEmit
git add components/ui/data-table/export-sheet.tsx components/ui/data-table/index.tsx components/ui/data-table/types.ts __tests__/ui/data-table-export-sheet.test.tsx
git commit -m "feat(data-table): replace the export sheet with a preset choice"
```

---

### Task 4: Declare the presets on StudentDataTable

**Files:**

- Modify: `components/sis/student-data-table.tsx` (delete `extraColumns` block ~lines 632-676; add `exportPresets` inside `rawColumns` ~line 681)
- Test: `__tests__/sis/student-data-table-export-presets.test.ts`

**Interfaces:**

- Consumes: `CsvExportPreset` from Task 3.

- [ ] **Step 1: Write the failing test**

The component needs props and context to render, so assert on the source text — the same technique `__tests__/audit/allowlist-coverage.test.ts` uses.

```ts
// __tests__/sis/student-data-table-export-presets.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = readFileSync(
  join(__dirname, '..', '..', 'components', 'sis', 'student-data-table.tsx'),
  'utf8'
);

describe('StudentDataTable export config', () => {
  it('declares both export presets', () => {
    expect(SRC).toContain("label: 'Full application record'");
    expect(SRC).toContain("label: 'Full record + pipeline'");
    expect(SRC).toMatch(/sourceIds:\s*\['applications'\]/);
    expect(SRC).toMatch(/sourceIds:\s*\['applications',\s*'status'\]/);
  });

  it('no longer declares the status extraColumns superseded by the presets', () => {
    // All 8 lived on _enrolment_status, which the "+ pipeline" preset now
    // exports in full — keeping them would offer the same data twice.
    for (const id of [
      'enroleeType',
      'enrolmentDate',
      'assessmentStatus',
      'assessmentGradeMath',
      'assessmentGradeEnglish',
      'contractStatus',
      'feeStatus',
      'registrationStatus',
    ]) {
      expect(SRC).not.toContain(`id: '${id}',`);
    }
    expect(SRC).not.toContain('extraColumns:');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/sis/student-data-table-export-presets.test.ts`
Expected: FAIL — presets absent, `extraColumns:` still present.

- [ ] **Step 3: Delete the extraColumns block**

In `components/sis/student-data-table.tsx`, remove the entire `extraColumns: [ ... ],` property (all 8 entries) from the `csv={{ ... }}` prop, along with the comment block above it that begins "More `_enrolment_status` fields".

- [ ] **Step 4: Add the presets**

Inside the `rawColumns: { ... }` object, after the `sources: [...]` array:

```ts
                // Offered as the "export everything" choices in the export
                // sheet. Applications alone is the clean identity/contacts
                // record; + Status adds the funnel columns (applicationStatus,
                // the 9 stage statuses and their dates, enrolee type,
                // enrolment date, assessment grades — KD #59/#62), which is
                // what makes the file useful for chasing.
                exportPresets: [
                  {
                    id: 'record',
                    label: 'Full application record',
                    sourceIds: ['applications'],
                  },
                  {
                    id: 'full',
                    label: 'Full record + pipeline',
                    sourceIds: ['applications', 'status'],
                  },
                ],
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run __tests__/sis/student-data-table-export-presets.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Type-check and commit**

```bash
npx tsc --noEmit
git add components/sis/student-data-table.tsx __tests__/sis/student-data-table-export-presets.test.ts
git commit -m "feat(admissions): offer full-record CSV exports on the students table"
```

---

### Task 5: Remove the orphaned dependencies and verify

**Files:**

- Modify: `package.json`
- Modify: `components/ui/data-table/index.tsx` (the stale lazy-import comment at line 65)

- [ ] **Step 1: Confirm @dnd-kit is now unreferenced**

Run: `grep -rn "@dnd-kit" components/ app/ lib/ __tests__/`
Expected: no output. If anything remains, stop and report — do not remove the packages.

- [ ] **Step 2: Remove the three packages**

```bash
npm uninstall @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

- [ ] **Step 3: Fix the stale comment**

`components/ui/data-table/index.tsx:65` still explains the lazy import as "pulls in @dnd-kit (drag-reorder columns)", which is no longer true. Replace that comment with:

```tsx
// Lazy — only tables declaring `csv.rawColumns` ever open this sheet, so
// its Sheet/RadioGroup tree stays out of the bundle for the tables that
// download instantly.
```

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run --reporter=dot`
Expected: all files pass. Note `data-table-export-sheet.test.tsx` timing-flakes under full-suite load — re-run it in isolation before treating a failure there as real.

- [ ] **Step 5: Production build**

Run: `npx next build`
Expected: `✓ Compiled successfully`

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json components/ui/data-table/index.tsx
git commit -m "chore: drop @dnd-kit, orphaned by the export sheet rewrite"
```

---

## Manual verification

Programmatic tests cannot confirm a real download. Before calling this done:

1. `/markbook/sections` — click Export CSV. A file downloads with no dialog; headers read plain English.
2. Hide a column via the Columns menu, export again — that column is gone from the file.
3. `/admissions/applications` — Export CSV opens the small sheet; row count matches the table; **What's on screen** is preselected.
4. Choose **Full record + pipeline**, Download. The file contains identity columns _and_ `Application Status` / stage columns.
5. Filter the table (e.g. a status tab), export again — the row count and the file both narrow.
6. `/records/students` — same sheet appears (shared component, intentional).
