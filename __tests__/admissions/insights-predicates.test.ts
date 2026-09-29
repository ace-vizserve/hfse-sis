import { describe, expect, it } from 'vitest';

import { APPLICATION_TERMINAL_REASON_LABELS } from '@/lib/schemas/sis';
import {
  categoryMixKey,
  daysToEnrol,
  decodePairSegment,
  encodePairSegment,
  hasReachedFunnelStage,
  intakeMonthIndex,
  isFunnelStageName,
  isWithdrawnApplication,
  levelAsAppliedKey,
  nationalityBucketer,
  OVERFLOW_SEGMENT,
  rankKeys,
  reasonLabel,
  referralBucketer,
  referralSourceKey,
  terminalReasonKey,
  topReasonKeys,
} from '@/lib/admissions/insights-predicates';

describe('rankKeys', () => {
  it('orders by count, then by name', () => {
    expect(rankKeys(['b', 'a', 'b', 'c', 'a', 'd'])).toEqual([
      { key: 'a', count: 2 },
      { key: 'b', count: 2 },
      { key: 'c', count: 1 },
      { key: 'd', count: 1 },
    ]);
  });
});

describe('pair segments', () => {
  it('survive a level label that contains the separator', () => {
    const seg = encodePairSegment('Youngstarters | Little Stars', 'financial');
    expect(decodePairSegment(seg)).toEqual({
      first: 'Youngstarters | Little Stars',
      second: 'financial',
    });
  });
  it('carry an empty half as "any"', () => {
    expect(decodePairSegment(encodePairSegment('', OVERFLOW_SEGMENT))).toEqual({
      first: '',
      second: OVERFLOW_SEGMENT,
    });
  });
  it('reject a segment with no separator', () => {
    expect(decodePairSegment('financial')).toBeNull();
  });
});

describe('hasReachedFunnelStage', () => {
  it('counts the five canonical statuses as Submitted, trimmed', () => {
    for (const s of [
      'Submitted',
      'Ongoing Verification',
      ' Processing ',
      'Enrolled',
      'Enrolled (Conditional)',
    ]) {
      expect(hasReachedFunnelStage(s, 'Submitted')).toBe(true);
    }
  });
  it('counts a blank, unknown or terminal status in no stage', () => {
    for (const s of [
      '',
      null,
      'No status',
      'Deferred',
      'Cancelled',
      'Withdrawn',
    ]) {
      expect(hasReachedFunnelStage(s, 'Submitted')).toBe(false);
    }
  });
  it('is cumulative', () => {
    expect(hasReachedFunnelStage('Enrolled', 'Processing')).toBe(true);
    expect(hasReachedFunnelStage('Processing', 'Enrolled')).toBe(false);
  });
  it('recognises stage names', () => {
    expect(isFunnelStageName('Submitted')).toBe(true);
    expect(isFunnelStageName('Enrolled (Conditional)')).toBe(false);
    expect(isFunnelStageName(null)).toBe(false);
  });
});

describe('daysToEnrol', () => {
  const base = {
    status: 'Enrolled',
    createdAt: '2026-03-01T00:00:00Z',
    enrolledAt: '2026-04-01T00:00:00Z',
  };
  it('counts whole days from application to enrolment', () => {
    expect(daysToEnrol(base)).toBe(31);
  });
  it('reads a status with stray spaces as enrolled', () => {
    expect(daysToEnrol({ ...base, status: ' Enrolled (Conditional) ' })).toBe(
      31
    );
  });
  it('is null for anyone not enrolled or missing a timestamp', () => {
    expect(daysToEnrol({ ...base, status: 'Processing' })).toBeNull();
    expect(daysToEnrol({ ...base, enrolledAt: null })).toBeNull();
    expect(daysToEnrol({ ...base, createdAt: undefined })).toBeNull();
  });
  it('is null when enrolment is stamped before the application, even by hours', () => {
    expect(
      daysToEnrol({ ...base, enrolledAt: '2026-02-28T18:00:00Z' })
    ).toBeNull();
  });
});

describe('intakeMonthIndex', () => {
  it('uses the UTC month and ignores the year', () => {
    expect(intakeMonthIndex('2026-01-10T02:00:00Z')).toBe(0);
    expect(intakeMonthIndex('2025-03-31T20:00:00Z')).toBe(2);
  });
  it('drops December, blanks and unreadable dates', () => {
    expect(intakeMonthIndex('2025-12-15T00:00:00Z')).toBeNull();
    expect(intakeMonthIndex(null)).toBeNull();
    expect(intakeMonthIndex('not a date')).toBeNull();
  });
});

describe('level and withdrawal', () => {
  it('reads the level as applied, blank as Unknown', () => {
    expect(levelAsAppliedKey(' P1 ')).toBe('P1');
    expect(levelAsAppliedKey('   ')).toBe('Unknown');
    expect(levelAsAppliedKey(null)).toBe('Unknown');
  });
  it('recognises a withdrawn application with stray spaces', () => {
    expect(isWithdrawnApplication(' Withdrawn ')).toBe(true);
    expect(isWithdrawnApplication('Cancelled')).toBe(false);
  });
});

describe('terminal reasons', () => {
  it('keeps no reason as null and a blank reason as Unspecified', () => {
    expect(terminalReasonKey(null)).toBeNull();
    expect(terminalReasonKey(undefined)).toBeNull();
    expect(terminalReasonKey('   ')).toBe('Unspecified');
    expect(terminalReasonKey(' financial ')).toBe('financial');
  });
  it('names the top five by count, ties by name', () => {
    const keys = ['f', 'f', 'e', 'e', 'd', 'c', 'b', 'a'];
    expect([...topReasonKeys(keys)].sort()).toEqual(['a', 'b', 'c', 'e', 'f']);
  });
  it('labels a known code and passes free text through', () => {
    const [code, label] = Object.entries(APPLICATION_TERMINAL_REASON_LABELS)[0];
    expect(reasonLabel(code)).toBe(label);
    expect(reasonLabel('Moved to Johor')).toBe('Moved to Johor');
  });
});

describe('referral sources', () => {
  it('reads a blank source as Not specified', () => {
    expect(referralSourceKey('  ')).toBe('Not specified');
    expect(referralSourceKey(null)).toBe('Not specified');
  });
  it('keeps every source when there are eight or fewer', () => {
    const bucketOf = referralBucketer(['a', 'b', 'c']);
    expect(bucketOf('c')).toBe('c');
  });
  it('folds the sources past the top eight into the overflow bucket', () => {
    const keys = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'].flatMap(
      (s, i) => Array.from({ length: i + 1 }, () => s)
    );
    const bucketOf = referralBucketer(keys);
    expect(bucketOf('J')).toBe('J');
    expect(bucketOf('C')).toBe('C');
    expect(bucketOf('B')).toBe(OVERFLOW_SEGMENT);
    expect(bucketOf('A')).toBe(OVERFLOW_SEGMENT);
  });
});

describe('categoryMixKey', () => {
  it('keeps a real category and folds anything else into Unspecified', () => {
    expect(categoryMixKey(' Current ')).toBe('Current');
    expect(categoryMixKey('New')).toBe('New');
    expect(categoryMixKey('nonsense')).toBe('Unspecified');
    expect(categoryMixKey(null)).toBe('Unspecified');
  });
});

describe('nationalityBucketer', () => {
  it('names the top N, folds the rest into Other, blank into Unspecified', () => {
    const values = [
      'Singapore',
      'Singapore',
      'Philippines',
      'Philippines',
      'India',
      null,
    ];
    const bucketOf = nationalityBucketer(values, 2);
    expect(bucketOf('singapore')).toBe('Singapore');
    expect(bucketOf('India')).toBe('Other');
    expect(bucketOf('  ')).toBe('Unspecified');
  });
  it('merges the two spellings of Vietnam before ranking', () => {
    const bucketOf = nationalityBucketer(['Viet Nam', 'Vietnam', 'India'], 1);
    expect(bucketOf('Viet Nam')).toBe('Vietnam');
    expect(bucketOf('India')).toBe('Other');
  });
});
