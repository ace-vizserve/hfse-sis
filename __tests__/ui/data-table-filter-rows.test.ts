import { describe, expect, it } from 'vitest';
import type { ColumnDef } from '@tanstack/react-table';

import {
  filterRows,
  getFacetOptions,
  resolveColumnValue,
} from '@/components/ui/data-table/filter-rows';
import type { FacetConfig } from '@/components/ui/data-table/types';

// Extracted from index.tsx's `tabCountData` — the export sheet's live
// preview must never disagree with the shell's own tab counts, so both
// consume this same module. See KD #82/#84.

type Row = {
  id: string;
  name: string;
  level: string | null;
  score: number;
};

const rows: Row[] = [
  { id: '1', name: 'Alice', level: 'P1', score: 90 },
  { id: '2', name: 'Bob', level: 'P2', score: 75 },
  { id: '3', name: 'Charlie', level: null, score: 60 },
  { id: '4', name: 'Dana', level: 'P1', score: 88 },
];

const columns: ColumnDef<Row>[] = [
  { id: 'name', accessorKey: 'name', header: 'Name' },
  { id: 'level', accessorKey: 'level', header: 'Level' },
  {
    id: 'grade',
    // accessorFn-backed computed column — deliberately not accessorKey, the
    // exact shape that broke a raw `row[id]` lookup in the KD #82/#84 bug.
    accessorFn: (r) => (r.score >= 80 ? 'High' : 'Low'),
    header: 'Grade',
  },
];

describe('resolveColumnValue', () => {
  it('resolves via accessorKey', () => {
    expect(resolveColumnValue(columns, 'name', rows[0], 0)).toBe('Alice');
  });

  it('resolves via accessorFn (computed column)', () => {
    expect(resolveColumnValue(columns, 'grade', rows[0], 0)).toBe('High');
    expect(resolveColumnValue(columns, 'grade', rows[2], 2)).toBe('Low');
  });

  it('falls back to a raw row lookup when the column is not found', () => {
    expect(resolveColumnValue(columns, 'id', rows[0], 0)).toBe('1');
  });
});

describe('filterRows', () => {
  it('is an identity when no facets or search are given', () => {
    expect(filterRows(rows, { columns })).toEqual(rows);
  });

  it('applies a facet filter by exact value', () => {
    const out = filterRows(rows, {
      columns,
      facets: [{ id: 'level', values: ['P1'] }],
    });
    expect(out.map((r) => r.name)).toEqual(['Alice', 'Dana']);
  });

  it('matches the "(unassigned)" sentinel for null/empty facet values', () => {
    const out = filterRows(rows, {
      columns,
      facets: [{ id: 'level', values: ['(unassigned)'] }],
    });
    expect(out.map((r) => r.name)).toEqual(['Charlie']);
  });

  it('filters an accessorFn-backed column via a facet — the exact bug class this module fixes', () => {
    const out = filterRows(rows, {
      columns,
      facets: [{ id: 'grade', values: ['High'] }],
    });
    expect(out.map((r) => r.name)).toEqual(['Alice', 'Dana']);
  });

  it('applies global search across string search keys', () => {
    const out = filterRows(rows, {
      columns,
      search: 'ali',
      searchKeys: ['name'],
    });
    expect(out.map((r) => r.name)).toEqual(['Alice']);
  });

  it('applies global search across a function search key', () => {
    const out = filterRows(rows, {
      columns,
      search: 'p2',
      searchKeys: [(r) => r.level ?? ''],
    });
    expect(out.map((r) => r.name)).toEqual(['Bob']);
  });

  it('combines facets and search', () => {
    const out = filterRows(rows, {
      columns,
      facets: [{ id: 'level', values: ['P1'] }],
      search: 'dana',
      searchKeys: ['name'],
    });
    expect(out.map((r) => r.name)).toEqual(['Dana']);
  });

  it('ignores an empty facet value array', () => {
    const out = filterRows(rows, {
      columns,
      facets: [{ id: 'level', values: [] }],
    });
    expect(out).toEqual(rows);
  });
});

describe('getFacetOptions', () => {
  it('prefers an explicit valueOptions list', () => {
    const facet: FacetConfig = {
      columnId: 'level',
      label: 'Level',
      valueOptions: ['P1', 'P2', 'P3'],
    };
    expect(getFacetOptions(rows, columns, facet)).toEqual([
      { value: 'P1', label: 'P1' },
      { value: 'P2', label: 'P2' },
      { value: 'P3', label: 'P3' },
    ]);
  });

  it('derives sorted distinct values from data when no valueOptions given', () => {
    const facet: FacetConfig = { columnId: 'level', label: 'Level' };
    expect(getFacetOptions(rows, columns, facet)).toEqual([
      { value: 'P1', label: 'P1' },
      { value: 'P2', label: 'P2' },
    ]);
  });

  it('derives options via an accessorFn-backed column', () => {
    const facet: FacetConfig = { columnId: 'grade', label: 'Grade' };
    expect(getFacetOptions(rows, columns, facet)).toEqual([
      { value: 'High', label: 'High' },
      { value: 'Low', label: 'Low' },
    ]);
  });

  it('excludes null values from derived options', () => {
    const facet: FacetConfig = { columnId: 'level', label: 'Level' };
    const options = getFacetOptions(rows, columns, facet);
    expect(options.some((o) => o.value === '')).toBe(false);
    expect(options.length).toBe(2);
  });
});
