import { describe, expect, it } from 'vitest';

import {
  controllabilityOf,
  encodeInsightsSegment,
  enrolledCategoryBucket,
  INSIGHTS_MOVEMENT_MONTHS,
  isMidYearJoinKind,
  isOnRoll,
  levelLabelOf,
  levelMatchesSegment,
  levelShortCode,
  movementLevelOf,
  movementMonthIndex,
  parseInsightsSegment,
  pickSeriesAy,
  termSegmentFromLabel,
  withdrawalReasonLabelOf,
} from '@/lib/sis/insights-shared';
import {
  isTerminalLevel as reExportedIsTerminal,
  MONTH_LABELS as reExportedMonths,
  WITHDRAWAL_CONTROLLABILITY as reExportedControllability,
} from '@/lib/sis/records-insights';
import {
  isTerminalLevel,
  MONTH_LABELS,
  WITHDRAWAL_CONTROLLABILITY,
} from '@/lib/sis/insights-shared';

describe('records-insights keeps re-exporting the moved constants', () => {
  it('is the same object, not a copy', () => {
    expect(reExportedMonths).toBe(MONTH_LABELS);
    expect(reExportedControllability).toBe(WITHDRAWAL_CONTROLLABILITY);
    expect(reExportedIsTerminal).toBe(isTerminalLevel);
  });
});

describe('level helpers', () => {
  it('short-codes a catalog label and leaves anything else as it is', () => {
    expect(levelShortCode('Primary One')).toBe('P1');
    expect(levelShortCode('Youngstarters')).toBe('Youngstarters');
    expect(levelShortCode('Unknown')).toBe('Unknown');
  });

  it('matches a segment by label or by code', () => {
    expect(levelMatchesSegment('Primary One', 'P1')).toBe(true);
    expect(levelMatchesSegment('Primary One', 'Primary One')).toBe(true);
    expect(levelMatchesSegment('Primary Two', 'P1')).toBe(false);
    expect(levelMatchesSegment('Youngstarters', 'Youngstarters')).toBe(true);
    expect(levelMatchesSegment(null, 'Unknown')).toBe(true);
  });

  it('reads a level embed the way the loaders do', () => {
    expect(levelLabelOf({ label: ' Primary One ', code: 'P1' })).toBe(
      'Primary One'
    );
    expect(levelLabelOf([{ label: null, code: 'P2' }])).toBe('P2');
    expect(levelLabelOf(null)).toBe('Unknown');
  });

  it('treats every status but withdrawn as on roll', () => {
    expect(isOnRoll('active')).toBe(true);
    expect(isOnRoll('late_enrollee')).toBe(true);
    expect(isOnRoll('graduated')).toBe(true);
    expect(isOnRoll('withdrawn')).toBe(false);
  });
});

describe('movement helpers', () => {
  it('buckets a blank level as Unknown and a blank reason as Unspecified', () => {
    expect(movementLevelOf({ level: '  ' })).toBe('Unknown');
    expect(movementLevelOf({ level: 'Primary One' })).toBe('Primary One');
    expect(withdrawalReasonLabelOf({ reasonLabel: null })).toBe('Unspecified');
    expect(withdrawalReasonLabelOf({ reasonLabel: 'Health / medical' })).toBe(
      'Health / medical'
    );
  });

  it('classifies a raw reason, and anything unknown as unspecified', () => {
    expect(controllabilityOf('financial')).toBe('controllable');
    expect(controllabilityOf(' family_relocation ')).toBe('structural');
    expect(controllabilityOf(null)).toBe('unspecified');
    expect(controllabilityOf('made_up')).toBe('unspecified');
  });

  it('counts late and re-enrolled as mid-year joins, nothing else', () => {
    expect(isMidYearJoinKind('late-enrolled')).toBe(true);
    expect(isMidYearJoinKind('re-enrolled')).toBe(true);
    expect(isMidYearJoinKind('withdrawn')).toBe(false);
    expect(isMidYearJoinKind('section-transfer')).toBe(false);
  });

  it('reads the month of an ISO date, -1 when it cannot', () => {
    expect(movementMonthIndex('2026-03-10')).toBe(2);
    expect(movementMonthIndex('2026-12-01')).toBe(11);
    expect(movementMonthIndex('')).toBe(-1);
    expect(movementMonthIndex(null)).toBe(-1);
    expect(INSIGHTS_MOVEMENT_MONTHS).toHaveLength(11);
    expect(INSIGHTS_MOVEMENT_MONTHS[10]).toBe('Nov');
  });
});

describe('enrolledCategoryBucket', () => {
  const map = new Map([
    ['E1', 'New'],
    ['E2', ' Current '],
    ['E3', 'Bogus'],
  ]);
  it('keeps a real category and buckets the rest as Unspecified', () => {
    expect(enrolledCategoryBucket('E1', map)).toBe('New');
    expect(enrolledCategoryBucket(' E2 ', map)).toBe('Current');
    expect(enrolledCategoryBucket('E3', map)).toBe('Unspecified');
    expect(enrolledCategoryBucket('E9', map)).toBe('Unspecified');
    expect(enrolledCategoryBucket(null, map)).toBe('Unspecified');
  });
});

describe('insights segments', () => {
  it('round-trips in a fixed key order', () => {
    const s = encodeInsightsSegment({ outcome: 'returned', level: 'P1' });
    expect(s).toBe('level:P1|outcome:returned');
    expect(parseInsightsSegment(s)).toEqual({
      level: 'P1',
      outcome: 'returned',
    });
  });

  it('keeps a value that itself holds a colon', () => {
    expect(parseInsightsSegment('nationality:Korea: South')).toEqual({
      nationality: 'Korea: South',
    });
  });

  it('is null for nothing, and null (not "everything") for garbage', () => {
    expect(encodeInsightsSegment({})).toBeNull();
    expect(parseInsightsSegment(null)).toEqual({});
    expect(parseInsightsSegment('P1')).toBeNull();
    expect(parseInsightsSegment('colour:red')).toBeNull();
  });
});

describe('wrapper helpers', () => {
  it('sends the comparison series to the comparison year', () => {
    expect(pickSeriesAy('line', 'line', 'AY2026', 'AY2025')).toBe('AY2025');
    expect(pickSeriesAy('bar', 'line', 'AY2026', 'AY2025')).toBe('AY2026');
    expect(pickSeriesAy(undefined, 'line', 'AY2026', 'AY2025')).toBe('AY2026');
    expect(pickSeriesAy('compare', 'compare', 'AY2026', null)).toBe('AY2026');
  });

  it('reads the term number off the late-by-term bar label', () => {
    expect(termSegmentFromLabel('Term 2')).toBe('term:2');
    expect(termSegmentFromLabel('Whenever')).toBeNull();
  });
});
