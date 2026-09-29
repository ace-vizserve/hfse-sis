import * as React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  unstable_cache:
    (fn: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) =>
      fn(...args),
  revalidateTag: () => {},
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    throw new Error('no database in this test');
  },
}));

import { buildLeaveQuotaColumns } from '@/components/attendance/drills/attendance-drill-sheet';
import {
  defaultColumnsForTarget,
  DRILL_COLUMN_LABELS,
  type LeaveQuotaRow,
} from '@/lib/attendance/drill';

const row = (over: Partial<LeaveQuotaRow> = {}): LeaveQuotaRow => ({
  leaveType: 'compassionate',
  studentSectionId: 'ss-ben',
  studentName: 'Ben Tan',
  studentNumber: 'H240001',
  sectionId: 'sec-1',
  sectionName: 'Respect',
  level: 'P5',
  termNumber: null,
  allowance: 5,
  used: 6,
  isOver: true,
  ...over,
});

type CellFn = (ctx: { row: { original: LeaveQuotaRow } }) => React.ReactNode;

function renderCell(id: string, original: LeaveQuotaRow) {
  const cols = buildLeaveQuotaColumns(
    defaultColumnsForTarget('over-leave-quota')
  );
  const col = cols.find((c) => c.id === id)!;
  const cell = col.cell as unknown as CellFn;
  render(<>{cell({ row: { original } })}</>);
}

describe('leave-quota drill columns', () => {
  it('builds the default columns in order, plus the View link', () => {
    const cols = buildLeaveQuotaColumns(
      defaultColumnsForTarget('over-leave-quota')
    );
    expect(cols.map((c) => c.id)).toEqual([
      'studentName',
      'sectionName',
      'level',
      'leaveType',
      'termNumber',
      'allowance',
      'used',
      'action',
    ]);
  });

  it('uses the plain-English labels as headers', () => {
    const cols = buildLeaveQuotaColumns(['leaveType', 'termNumber']);
    expect(cols[0]!.header).toBe(DRILL_COLUMN_LABELS.leaveType);
    expect(cols[1]!.header).toBe('Term');
  });

  it('names the leave type in words', () => {
    renderCell('leaveType', row({ leaveType: 'vacation' }));
    expect(screen.getByText('Vacation leave')).toBeTruthy();
  });

  it('says "Whole year" for the per-year compassionate allowance', () => {
    renderCell('termNumber', row());
    expect(screen.getByText('Whole year')).toBeTruthy();
  });

  it('shows the term for vacation leave', () => {
    renderCell('termNumber', row({ leaveType: 'vacation', termNumber: 2 }));
    expect(screen.getByText('T2')).toBeTruthy();
  });

  it('links the student to their attendance page (KD #81)', () => {
    renderCell('studentName', row());
    expect(
      screen.getByRole('link', { name: 'Ben Tan' }).getAttribute('href')
    ).toBe('/attendance/students/H240001');
  });
});
