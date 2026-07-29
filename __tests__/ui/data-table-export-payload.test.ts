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
