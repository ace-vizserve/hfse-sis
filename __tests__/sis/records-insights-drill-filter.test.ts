import { describe, expect, it } from 'vitest';

import {
  ALL_DRILL_COLUMNS,
  applyTargetFilter,
  defaultColumnsForTarget,
  DRILL_COLUMN_LABELS,
  drillHeaderForTarget,
  INSIGHTS_DRILL_TARGETS,
  type RecordsDrillRow,
} from '@/lib/sis/drill';

function row(over: Partial<RecordsDrillRow>): RecordsDrillRow {
  return {
    enroleeNumber: 'E1',
    studentNumber: 'S1',
    fullName: 'Jane Doe',
    enrollmentStatus: 'active',
    applicationStatus: '',
    level: 'Primary One',
    sectionId: 'sec1',
    sectionName: 'Obedience',
    pipelineStage: 'Enrolled',
    applicationDate: null,
    enrollmentDate: null,
    withdrawalDate: null,
    daysSinceUpdate: null,
    hasMissingDocs: false,
    expiringDocsCount: 0,
    documentsComplete: 0,
    documentsTotal: 0,
    ...over,
  };
}

describe('enrolled-headcount', () => {
  const rows = [
    row({}),
    row({ enrollmentStatus: 'graduated', level: 'Secondary Four' }),
    row({ enrollmentStatus: 'withdrawn' }),
    row({ level: 'Youngstarters' }),
  ];
  it('keeps every on-roll row, graduated included', () => {
    expect(applyTargetFilter(rows, 'enrolled-headcount', null)).toHaveLength(3);
  });
  it('matches a level code and a label the catalog does not know', () => {
    expect(
      applyTargetFilter(rows, 'enrolled-headcount', 'level:P1')
    ).toHaveLength(1);
    expect(
      applyTargetFilter(rows, 'enrolled-headcount', 'level:Youngstarters')
    ).toHaveLength(1);
  });
  it('opens nothing for an unreadable segment', () => {
    expect(applyTargetFilter(rows, 'enrolled-headcount', 'P1')).toEqual([]);
  });
});

describe('category and nationality', () => {
  const rows = [
    row({
      category: 'New',
      nationalityMixBucket: 'Other',
      nationalityLevelBucket: 'Philippines',
    }),
    row({
      category: 'Unspecified',
      level: 'Primary Two',
      nationalityMixBucket: 'Philippines',
      nationalityLevelBucket: 'Other',
    }),
  ];
  it('filters the category bucket', () => {
    expect(
      applyTargetFilter(rows, 'category', 'category:Unspecified')
    ).toHaveLength(1);
  });
  it('uses the pie bucket alone and the by-level bucket with a level', () => {
    expect(
      applyTargetFilter(rows, 'nationality', 'nationality:Other')
    ).toHaveLength(1);
    expect(
      applyTargetFilter(
        rows,
        'nationality',
        'level:Primary Two|nationality:Other'
      )
    ).toHaveLength(1);
    expect(
      applyTargetFilter(
        rows,
        'nationality',
        'level:Primary One|nationality:Other'
      )
    ).toHaveLength(0);
  });
});

describe('retention', () => {
  const rows = [
    row({ returned: true }),
    row({ returned: false }),
    row({ returned: false, level: 'Primary Two' }),
  ];
  it('opens the whole cohort with no segment', () => {
    expect(applyTargetFilter(rows, 'retention', null)).toHaveLength(3);
  });
  it('splits a level by outcome, level given as the chart code', () => {
    expect(
      applyTargetFilter(rows, 'retention', 'level:P1|outcome:returned')
    ).toHaveLength(1);
    expect(
      applyTargetFilter(rows, 'retention', 'level:P1|outcome:didNotReturn')
    ).toHaveLength(1);
  });
});

describe('movement targets', () => {
  const rows = [
    row({
      movementKind: 'late-enrolled',
      joinedTerm: 2,
      movementDate: '2026-03-02',
    }),
    row({
      movementKind: 'late-enrolled',
      joinedTerm: null,
      movementDate: '2026-04-02',
    }),
    row({ movementKind: 're-enrolled', movementDate: '2026-03-09' }),
    row({
      movementKind: 'withdrawn',
      withdrawalReason: 'Financial / non-payment',
      controllable: 'controllable',
      movementDate: '2026-03-20',
    }),
    row({
      movementKind: 'withdrawn',
      level: 'Primary Two',
      withdrawalReason: 'Unspecified',
      controllable: 'unspecified',
      movementDate: '2026-06-20',
    }),
  ];
  it('late enrollees by term and level', () => {
    expect(applyTargetFilter(rows, 'late-enrollees', null)).toHaveLength(2);
    expect(applyTargetFilter(rows, 'late-enrollees', 'term:2')).toHaveLength(1);
    expect(
      applyTargetFilter(rows, 'late-enrollees', 'level:Primary One')
    ).toHaveLength(2);
  });
  it('withdrawals by reason, level, and cell', () => {
    expect(applyTargetFilter(rows, 'withdrawals', null)).toHaveLength(2);
    expect(
      applyTargetFilter(rows, 'withdrawals', 'reason:Unspecified')
    ).toHaveLength(1);
    expect(
      applyTargetFilter(
        rows,
        'withdrawals',
        'level:Primary One|reason:Financial / non-payment'
      )
    ).toHaveLength(1);
  });
  it('movement month splits joins from withdrawals', () => {
    expect(
      applyTargetFilter(rows, 'movement-month', 'flow:enrollments|month:Mar')
    ).toHaveLength(2);
    expect(
      applyTargetFilter(rows, 'movement-month', 'flow:withdrawals|month:Mar')
    ).toHaveLength(1);
    expect(
      applyTargetFilter(rows, 'movement-month', 'flow:withdrawals|month:Feb')
    ).toEqual([]);
    expect(applyTargetFilter(rows, 'movement-month', null)).toEqual([]);
  });
});

describe('every insights target has columns, labels and a plain title', () => {
  it.each([...INSIGHTS_DRILL_TARGETS])('%s', (target) => {
    const cols = defaultColumnsForTarget(target);
    expect(cols.length).toBeGreaterThan(0);
    for (const c of cols) expect(ALL_DRILL_COLUMNS).toContain(c);
    expect(drillHeaderForTarget(target, null).title.length).toBeGreaterThan(0);
  });
  it('labels every column key', () => {
    for (const c of ALL_DRILL_COLUMNS) {
      expect(DRILL_COLUMN_LABELS[c].length).toBeGreaterThan(0);
    }
  });
  it('titles a code segment with the level name', () => {
    expect(
      drillHeaderForTarget('retention', 'level:P1|outcome:didNotReturn').title
    ).toBe('Primary One · did not come back');
  });
});
