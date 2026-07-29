import { describe, expect, it } from 'vitest';
import type { Column, ColumnDef } from '@tanstack/react-table';

import {
  resolveColumnDefLabel,
  resolveColumnLabel,
} from '@/components/ui/data-table/column-label';

type Row = { name: string };

// The shell's Columns menu holds live `Column` instances; the export sheet
// holds raw `ColumnDef`s. Both funnel through the same fallback chain, so
// each case below is asserted against both entry points.
function asColumn(
  id: string,
  header: unknown,
  meta?: Record<string, unknown>
): Column<Row, unknown> {
  return {
    id,
    columnDef: { header, meta },
  } as unknown as Column<Row, unknown>;
}

describe('resolveColumnLabel / resolveColumnDefLabel', () => {
  it('prefers meta.label over everything else', () => {
    expect(
      resolveColumnLabel(asColumn('fcaName', () => null, { label: 'Adviser' }))
    ).toBe('Adviser');

    expect(
      resolveColumnDefLabel({
        id: 'fcaName',
        header: () => null,
        meta: { label: 'Adviser' },
      } as ColumnDef<Row>)
    ).toBe('Adviser');
  });

  it('prefers meta.label even when a string header is also present', () => {
    // A string header is a legitimate label source, but an explicit one wins
    // — this is how a glyph header (`#`) gets a readable menu entry.
    expect(
      resolveColumnLabel(asColumn('index', '#', { label: 'Index number' }))
    ).toBe('Index number');
  });

  it('falls back to a plain string header', () => {
    expect(resolveColumnLabel(asColumn('level', 'Level'))).toBe('Level');
    expect(
      resolveColumnDefLabel({ id: 'level', header: 'Level' } as ColumnDef<Row>)
    ).toBe('Level');
  });

  it('treats a blank string header as absent, not as an empty label', () => {
    // Several action columns use `header: ''`. Without the trim guard these
    // render as an unlabelled checkbox row in the Columns menu.
    expect(resolveColumnLabel(asColumn('actions', ''))).toBe('Actions');
    expect(resolveColumnLabel(asColumn('actions', '   '))).toBe('Actions');
    expect(
      resolveColumnDefLabel({ id: 'actions', header: '' } as ColumnDef<Row>)
    ).toBe('Actions');
  });

  it('humanizes the id when the header is a render function and no label is set', () => {
    // The safety net — readable, but not the plan. The coverage test is what
    // stops a render-function header from shipping without meta.label.
    expect(resolveColumnLabel(asColumn('levelLabel', () => null))).toBe(
      'Level Label'
    );
    expect(resolveColumnLabel(asColumn('enrollment_date', () => null))).toBe(
      'Enrollment Date'
    );
  });

  it('humanizes the id when the header is missing entirely', () => {
    expect(resolveColumnLabel(asColumn('daysUntilExpiry', undefined))).toBe(
      'Days Until Expiry'
    );
  });

  it('resolves an accessorKey-only definition (no explicit id)', () => {
    // TanStack derives `id` from `accessorKey`, but the export sheet reads the
    // raw definition before a table exists, so it must do that itself.
    expect(
      resolveColumnDefLabel({
        accessorKey: 'studentName',
        header: () => null,
      } as unknown as ColumnDef<Row>)
    ).toBe('Student Name');
  });

  it('returns an empty string for a definition with neither id nor accessorKey', () => {
    expect(
      resolveColumnDefLabel({
        header: () => null,
      } as unknown as ColumnDef<Row>)
    ).toBe('');
  });
});
