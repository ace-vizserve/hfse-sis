import { describe, expect, it } from 'vitest';

import {
  overdueSweepTargets,
  statusKey,
  type OverdueCandidate,
  type StageStatuses,
} from '@/lib/billing/overdue';

const TODAY = '2026-10-21';
const inv = (o: Partial<OverdueCandidate> = {}): OverdueCandidate => ({
  studentNumber: 'S1',
  ayCode: 'AY2027',
  stageKeys: ['fees'],
  state: 'open',
  dueDate: '2026-10-20',
  ...o,
});
const statuses = (
  rows: Record<string, { registration?: string | null; fees?: string | null }>
): StageStatuses => new Map(Object.entries(rows));

describe('overdueSweepTargets', () => {
  it('picks a tied open invoice past due whose stage is not Overdue yet', () => {
    expect(
      overdueSweepTargets(
        [inv()],
        statuses({ [statusKey('S1', 'AY2027')]: { fees: 'Unpaid' } }),
        TODAY
      )
    ).toEqual([{ studentNumber: 'S1', ayCode: 'AY2027' }]);
  });
  it('skips a stage already Overdue, or Cancelled', () => {
    for (const fees of ['Overdue', ' Cancelled '])
      expect(
        overdueSweepTargets(
          [inv()],
          statuses({ [statusKey('S1', 'AY2027')]: { fees } }),
          TODAY
        )
      ).toEqual([]);
  });
  it('due today or later, no due date, paid or voided: not picked', () => {
    const s = statuses({ [statusKey('S1', 'AY2027')]: { fees: 'Unpaid' } });
    for (const o of [
      { dueDate: TODAY },
      { dueDate: '2026-11-01' },
      { dueDate: null },
      { state: 'paid' as const },
      { state: 'voided' as const },
    ])
      expect(overdueSweepTargets([inv(o)], s, TODAY)).toEqual([]);
  });
  it('untied invoices and students with no stage row are skipped', () => {
    const s = statuses({ [statusKey('S1', 'AY2027')]: { fees: 'Unpaid' } });
    expect(
      overdueSweepTargets(
        [
          inv({ ayCode: null }),
          inv({ stageKeys: [] }),
          inv({ studentNumber: 'S2' }),
        ],
        s,
        TODAY
      )
    ).toEqual([]);
  });
  it('checks the stage the invoice is tied to', () => {
    const s = statuses({
      [statusKey('S1', 'AY2027')]: { registration: 'Unpaid', fees: 'Overdue' },
    });
    expect(overdueSweepTargets([inv()], s, TODAY)).toEqual([]);
    expect(
      overdueSweepTargets([inv({ stageKeys: ['registration'] })], s, TODAY)
    ).toEqual([{ studentNumber: 'S1', ayCode: 'AY2027' }]);
  });
  it('one entry per student and year', () => {
    expect(
      overdueSweepTargets(
        [inv(), inv({ stageKeys: ['registration', 'fees'] })],
        statuses({
          [statusKey('S1', 'AY2027')]: { registration: null, fees: 'Unpaid' },
        }),
        TODAY
      )
    ).toEqual([{ studentNumber: 'S1', ayCode: 'AY2027' }]);
  });
});
