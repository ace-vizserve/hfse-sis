import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/ui/data-table';

// A caller whose `pageSize` follows its data (the server-paginated audit log
// shows every loaded row) must get the new size when the data grows — it used
// to keep the first one, so 16 of 50 rows showed after a filter was cleared.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/test',
  useSearchParams: () => new URLSearchParams(''),
}));

type Row = { id: string; name: string };
const make = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({ id: String(i), name: `Row ${i}` }));
const columns: ColumnDef<Row>[] = [
  { id: 'name', accessorKey: 'name', header: 'Name' },
];

function Table({ rows }: { rows: Row[] }) {
  return (
    <DataTable<Row>
      data={rows}
      columns={columns}
      getRowId={(r) => r.id}
      pageSize={Math.max(rows.length, 1)}
      url={{ enabled: true, namespace: 'al' }}
    />
  );
}

describe('DataTable — pageSize prop changes', () => {
  it('follows a new pageSize', () => {
    const { rerender } = render(<Table rows={make(16)} />);
    expect(screen.getAllByRole('row')).toHaveLength(17);
    rerender(<Table rows={make(50)} />);
    expect(screen.getAllByRole('row')).toHaveLength(51);
  });
});
