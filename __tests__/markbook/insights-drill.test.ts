import { describe, expect, it } from 'vitest';

import {
  averageDecisionHours,
  changeRequestWindowStart,
  countsTowardInsightsAverage,
  decisionMs,
  isInChangeRequestWindow,
  isInsightsAverageRow,
  isTopBand,
  levelAveragesForPeriod,
  levelTermSegment,
  parseLevelTermSegment,
  parseSubjectLevelSegment,
  parseSubjectTermSegment,
  parseTopBandSegment,
  parseTrendSeriesKey,
  parseWindowedCrSegment,
  pickGradeDistributionTerm,
  round1,
  subjectLevelSegment,
  subjectTermSegment,
  tallySheetLocksByTerm,
  termNumberFromLabel,
  topBandSegment,
  windowedCrSegment,
} from '@/lib/markbook/insights-drill';

describe('entry rule shared by the Insights averages, the histogram and their drills', () => {
  it('counts a real grade on a non-N.A. row, nothing else', () => {
    expect(countsTowardInsightsAverage(false, 80)).toBe(true);
    expect(countsTowardInsightsAverage(null, 0)).toBe(true);
    expect(countsTowardInsightsAverage(true, 95)).toBe(false);
    expect(countsTowardInsightsAverage(false, null)).toBe(false);
  });
  it('a drill row also needs an examinable subject', () => {
    expect(
      isInsightsAverageRow({
        isExaminable: true,
        isNa: false,
        computedGrade: 70,
      })
    ).toBe(true);
    expect(
      isInsightsAverageRow({
        isExaminable: false,
        isNa: false,
        computedGrade: 70,
      })
    ).toBe(false);
    expect(
      isInsightsAverageRow({
        isExaminable: true,
        isNa: true,
        computedGrade: 70,
      })
    ).toBe(false);
  });
  it('round1 rounds half up to one decimal, as the loaders do', () => {
    expect(round1(82.75)).toBe(82.8);
    expect(round1(80)).toBe(80);
  });
});

describe('pickGradeDistributionTerm — the term the grade histogram reads', () => {
  const t = (
    id: string,
    n: number,
    start: string | null,
    end: string | null,
    current = false
  ) => ({
    id,
    term_number: n,
    is_current: current,
    start_date: start,
    end_date: end,
  });

  it('the is_current term wins', () => {
    const terms = [
      t('a', 1, '2026-01-05', '2026-03-13'),
      t('b', 2, '2026-03-23', '2026-06-05', true),
    ];
    expect(pickGradeDistributionTerm(terms, '2026-01-10')?.id).toBe('b');
  });
  it('then the term containing today', () => {
    const terms = [
      t('a', 1, '2026-01-05', '2026-03-13'),
      t('b', 2, '2026-03-23', '2026-06-05'),
    ];
    expect(pickGradeDistributionTerm(terms, '2026-04-01')?.id).toBe('b');
  });
  it('then the most recently finished term', () => {
    const terms = [
      t('a', 1, '2025-01-06', '2025-03-14'),
      t('b', 2, '2025-03-24', '2025-06-06'),
    ];
    expect(pickGradeDistributionTerm(terms, '2026-09-29')?.id).toBe('b');
  });
  it('then the highest term number; none → null', () => {
    const terms = [t('b', 2, null, null), t('a', 1, null, null)];
    expect(pickGradeDistributionTerm(terms, '2026-09-29')?.id).toBe('b');
    expect(pickGradeDistributionTerm([], '2026-09-29')).toBeNull();
  });
});

describe('change-request window and decision rule', () => {
  const now = new Date('2026-09-29T04:00:00.000Z');
  it('the window starts N calendar days before now', () => {
    expect(changeRequestWindowStart(30, now)).toBe('2026-08-30T04:00:00.000Z');
  });
  it('the start instant is inside the window; a moment before is not', () => {
    const since = changeRequestWindowStart(30, now);
    expect(isInChangeRequestWindow('2026-08-30T04:00:00+00:00', since)).toBe(
      true
    );
    expect(isInChangeRequestWindow('2026-08-30T03:59:59Z', since)).toBe(false);
  });
  it('a decision needs a terminal status and a review at or after the request', () => {
    expect(
      decisionMs({
        status: 'pending',
        requestedAt: '2026-09-01T00:00:00Z',
        reviewedAt: null,
      })
    ).toBeNull();
    expect(
      decisionMs({
        status: 'rejected',
        requestedAt: '2026-09-15T00:00:00Z',
        reviewedAt: '2026-09-14T00:00:00Z',
      })
    ).toBeNull();
    expect(
      decisionMs({
        status: 'applied',
        requestedAt: '2026-09-01T00:00:00Z',
        reviewedAt: '2026-09-01T12:00:00Z',
      })
    ).toBe(12 * 3_600_000);
  });
  it('averages decision hours to one decimal; none → null', () => {
    expect(
      averageDecisionHours([
        {
          status: 'approved',
          requestedAt: '2026-09-10T00:00:00Z',
          reviewedAt: '2026-09-11T06:00:00Z',
        },
        {
          status: 'applied',
          requestedAt: '2026-09-01T00:00:00Z',
          reviewedAt: '2026-09-01T12:00:00Z',
        },
        {
          status: 'pending',
          requestedAt: '2026-09-20T00:00:00Z',
          reviewedAt: null,
        },
      ])
    ).toBe(21);
    expect(averageDecisionHours([])).toBeNull();
  });
});

describe('tallySheetLocksByTerm', () => {
  it('counts locked and open per term, in term order, ignoring other years', () => {
    const out = tallySheetLocksByTerm(
      [
        { id: 't1', term_number: 1 },
        { id: 't2', term_number: 2 },
      ],
      [
        { term_id: 't1', is_locked: true },
        { term_id: 't1', is_locked: false },
        { term_id: 't2', is_locked: false },
        { term_id: 'other-year', is_locked: true },
      ]
    );
    expect(out).toEqual([
      { termNumber: 1, termLabel: 'Term 1', locked: 1, open: 1 },
      { termNumber: 2, termLabel: 'Term 2', locked: 0, open: 1 },
    ]);
  });
});

describe('levelAveragesForPeriod — the "Which levels are struggling?" value', () => {
  it('is the unweighted mean of each subject average in that period', () => {
    const out = levelAveragesForPeriod(
      [
        { periodLabel: 'T3', levelCode: 'P1', avgGrade: 80 },
        { periodLabel: 'T3', levelCode: 'P1', avgGrade: 85.5 },
        { periodLabel: 'T3', levelCode: 'P2', avgGrade: 70 },
        { periodLabel: 'T3', levelCode: 'P2', avgGrade: null },
        { periodLabel: 'T2', levelCode: 'P1', avgGrade: 10 },
      ],
      'T3'
    );
    expect(out).toEqual([
      { levelCode: 'P1', avg: 82.8 },
      { levelCode: 'P2', avg: 70 },
    ]);
  });
});

describe('segment grammar', () => {
  it('subject | term — the subject name may itself hold a bar', () => {
    expect(subjectTermSegment('Mathematics', 2)).toBe('Mathematics|T2');
    expect(parseSubjectTermSegment('Mathematics|T2')).toEqual({
      subjectName: 'Mathematics',
      termNumber: 2,
    });
    expect(parseSubjectTermSegment('A|B|T3')).toEqual({
      subjectName: 'A|B',
      termNumber: 3,
    });
    expect(parseSubjectTermSegment('Mathematics|2')).toBeNull();
    expect(parseSubjectTermSegment('')).toBeNull();
  });
  it('level | term', () => {
    expect(levelTermSegment('P3', 2)).toBe('P3|T2');
    expect(parseLevelTermSegment('P3|T2')).toEqual({
      levelCode: 'P3',
      termNumber: 2,
    });
    expect(parseLevelTermSegment('P3')).toBeNull();
  });
  it('subject | level', () => {
    expect(subjectLevelSegment('English', 'S1')).toBe('English|S1');
    expect(parseSubjectLevelSegment('English|S1')).toEqual({
      subjectName: 'English',
      levelCode: 'S1',
    });
    expect(parseSubjectLevelSegment('English')).toBeNull();
  });
  it('top band, with or without a term', () => {
    expect(topBandSegment(2)).toBe('top|T2');
    expect(parseTopBandSegment('top')).toEqual({ termNumber: null });
    expect(parseTopBandSegment('top|T2')).toEqual({ termNumber: 2 });
    expect(parseTopBandSegment('o')).toBeNull();
    expect(isTopBand('vs')).toBe(true);
    expect(isTopBand('o')).toBe(true);
    expect(isTopBand('s')).toBe(false);
    expect(isTopBand(null)).toBe(false);
  });
  it('windowed change requests', () => {
    expect(windowedCrSegment(30)).toBe('30d');
    expect(windowedCrSegment(30, 'pending')).toBe('30d:pending');
    expect(parseWindowedCrSegment('30d')).toEqual({ days: 30, status: null });
    expect(parseWindowedCrSegment('30d:decided')).toEqual({
      days: 30,
      status: 'decided',
    });
    expect(parseWindowedCrSegment('pending')).toBeNull();
  });
  it('term labels and trend series keys', () => {
    expect(termNumberFromLabel('T2')).toBe(2);
    expect(termNumberFromLabel('Term 3')).toBe(3);
    expect(termNumberFromLabel('Latest')).toBeNull();
    expect(parseTrendSeriesKey('English · AY2025')).toEqual({
      subjectName: 'English',
      ayCode: 'AY2025',
    });
    expect(parseTrendSeriesKey('English')).toBeNull();
  });
});
