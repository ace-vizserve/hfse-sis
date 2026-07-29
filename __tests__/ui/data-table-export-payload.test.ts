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
      undefined,
      rows
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
      ],
      rows
    );
    expect(fields.map((f) => f.id)).toEqual(['name', 'x']);
  });

  it('renders booleans as Yes/No, not true/false', () => {
    const boolCols: ColumnDef<Row>[] = [
      { id: 'flag', accessorFn: () => true, header: 'Flag' },
    ];
    const [field] = buildScreenFields(boolCols, ['flag'], undefined, rows);
    expect(field.accessor(rows[0], 0)).toBe('Yes');
  });

  it('drops a visible column whose accessor returns an object', () => {
    const objCols: ColumnDef<Row>[] = [
      { id: 'name', accessorKey: 'name', header: 'Name' },
      {
        id: 'metadata',
        accessorFn: () => ({ a: 1 }),
        header: 'Metadata',
      },
    ];
    const fields = buildScreenFields(
      objCols,
      ['name', 'metadata'],
      undefined,
      rows
    );
    expect(fields.map((f) => f.id)).toEqual(['name']);
  });

  it('drops a column whose FIRST row is a string but a LATER row is an object', () => {
    // rows[0].id === '1', rows[1].id === '2' — the object only shows up on
    // the second row. A probe that stops at the first non-null value would
    // wrongly keep this column.
    const mixedCols: ColumnDef<Row>[] = [
      { id: 'name', accessorKey: 'name', header: 'Name' },
      {
        id: 'mixed',
        accessorFn: (r) => (r.id === '1' ? 'a string' : { a: 1 }),
        header: 'Mixed',
      },
    ];
    const fields = buildScreenFields(
      mixedCols,
      ['name', 'mixed'],
      undefined,
      rows
    );
    expect(fields.map((f) => f.id)).toEqual(['name']);
  });

  it('drops a column whose FIRST row is an object but a LATER row is a string (order-independence mirror)', () => {
    const mixedCols: ColumnDef<Row>[] = [
      { id: 'name', accessorKey: 'name', header: 'Name' },
      {
        id: 'mixed',
        accessorFn: (r) => (r.id === '1' ? { a: 1 } : 'a string'),
        header: 'Mixed',
      },
    ];
    const fields = buildScreenFields(
      mixedCols,
      ['name', 'mixed'],
      undefined,
      rows
    );
    expect(fields.map((f) => f.id)).toEqual(['name']);
  });

  it('keeps a visible column whose values are all null', () => {
    const nullCols: ColumnDef<Row>[] = [
      { id: 'name', accessorKey: 'name', header: 'Name' },
      { id: 'empty', accessorFn: () => null, header: 'Empty' },
    ];
    const fields = buildScreenFields(
      nullCols,
      ['name', 'empty'],
      undefined,
      rows
    );
    expect(fields.map((f) => f.id)).toEqual(['name', 'empty']);
  });
});

describe('fieldsToCsvColumns', () => {
  it('resolves each row against its final index', () => {
    const fields = buildScreenFields(
      [{ id: 'pos', accessorFn: (_r, i) => i + 1, header: 'Position' }],
      ['pos'],
      undefined,
      rows
    );
    const cols = fieldsToCsvColumns(rows, fields);
    expect(cols[0].header).toBe('Position');
    expect(cols[0].accessor(rows[1])).toBe(2);
  });
});
