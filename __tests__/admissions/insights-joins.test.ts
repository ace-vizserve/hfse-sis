import { describe, expect, it } from 'vitest';

import {
  joinTerminalReasonRows,
  rollupTerminalReasons,
} from '@/lib/admissions/insights';
import {
  computeReferralConversion,
  computeWithdrawnByLevel,
  joinFunnelRows,
} from '@/lib/admissions/insights-funnel';

const app = (
  enroleeNumber: string | null,
  levelApplied: string | null = 'P1'
) => ({
  enroleeNumber,
  levelApplied,
  howDidYouKnowAboutHFSEIS: null,
  category: null,
  nationality: null,
});

describe('joinFunnelRows — application-first, as the drill joins', () => {
  it('keeps an application with no status row, drops a status row with no application', () => {
    const out = joinFunnelRows(
      [
        { enroleeNumber: 'E1', applicationStatus: 'Submitted' },
        { enroleeNumber: 'ORPHAN', applicationStatus: 'Withdrawn' },
      ],
      [app('E1'), app('E2')]
    );
    expect(out.map((r) => [r.enroleeNumber, r.applicationStatus])).toEqual([
      ['E1', 'Submitted'],
      ['E2', null],
    ]);
  });

  it('reads the last status row when an applicant has two', () => {
    const out = joinFunnelRows(
      [
        { enroleeNumber: 'E1', applicationStatus: 'Submitted' },
        { enroleeNumber: 'E1', applicationStatus: 'Cancelled' },
      ],
      [app('E1')]
    );
    expect(out).toHaveLength(1);
    expect(out[0].applicationStatus).toBe('Cancelled');
  });

  it('drops an application with no applicant number', () => {
    expect(joinFunnelRows([], [app(null), app('')])).toEqual([]);
  });
});

describe('joinTerminalReasonRows', () => {
  it('keeps applications whose last status row carries a reason, blank included', () => {
    const out = joinTerminalReasonRows(
      [
        { enroleeNumber: 'E1', applicationTerminalReason: 'financial' },
        { enroleeNumber: 'E2', applicationTerminalReason: null },
        { enroleeNumber: 'E3', applicationTerminalReason: '' },
        { enroleeNumber: 'ORPHAN', applicationTerminalReason: 'financial' },
        { enroleeNumber: 'E4', applicationTerminalReason: 'financial' },
        { enroleeNumber: 'E4', applicationTerminalReason: null },
      ],
      [
        { enroleeNumber: 'E1', levelApplied: 'P1' },
        { enroleeNumber: 'E2', levelApplied: 'P1' },
        { enroleeNumber: 'E3', levelApplied: null },
        { enroleeNumber: 'E4', levelApplied: 'P2' },
      ]
    );
    expect(out).toEqual([
      { applicationTerminalReason: 'financial', levelApplied: 'P1' },
      { applicationTerminalReason: '', levelApplied: null },
    ]);
    const rollup = rollupTerminalReasons(out);
    expect(rollup.total).toBe(2);
    expect(rollup.byLevel.map((l) => l.level)).toEqual(['P1', 'Unknown']);
  });
});

describe('computeWithdrawnByLevel', () => {
  it('reads a withdrawn status with stray spaces', () => {
    expect(
      computeWithdrawnByLevel([
        { levelApplied: 'P1', applicationStatus: ' Withdrawn ' },
      ])
    ).toEqual([{ level: 'P1', count: 1 }]);
  });
});

describe('computeReferralConversion', () => {
  it('marks the folded Other row, and only that row', () => {
    const sources = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
    const rows = sources.flatMap((s, i) =>
      Array.from({ length: i + 1 }, () => ({
        howDidYouKnowAboutHFSEIS: s,
        applicationStatus: 'Processing',
      }))
    );
    const out = computeReferralConversion(rows);
    expect(out.filter((r) => r.folded === true)).toEqual([
      {
        source: 'Other',
        applied: 3,
        enrolled: 0,
        conversionPct: 0,
        folded: true,
      },
    ]);
    expect(out.filter((r) => r.folded === undefined)).toHaveLength(8);
  });
});
