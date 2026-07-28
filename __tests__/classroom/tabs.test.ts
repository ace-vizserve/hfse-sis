import { describe, expect, it } from 'vitest';

import {
  classroomTabHref,
  tabsForCapability,
  type ClassroomTabKey,
} from '@/lib/classroom/tabs';
import type { ClassroomCapability } from '@/lib/classroom/scope';

function keys(capability: ClassroomCapability | null): ClassroomTabKey[] {
  return tabsForCapability(capability).map((t) => t.key);
}

describe('tabsForCapability', () => {
  // The load-bearing invariant of Phase 4: a subject-teacher-only viewer
  // must never be offered attendance or write-ups, in the nav OR anywhere
  // else — those tabs read RLS-restricted data via the service client.
  it('a subject capability never yields attendance or write-ups', () => {
    const tabKeys = keys('subject');
    expect(tabKeys).not.toContain('attendance');
    expect(tabKeys).not.toContain('write-ups');
    expect(tabKeys).toEqual(['overview', 'grades', 'students']);
  });

  it('an adviser capability sees every tab', () => {
    expect(keys('adviser')).toEqual([
      'overview',
      'grades',
      'students',
      'attendance',
      'write-ups',
    ]);
  });

  it('an oversight capability sees every tab', () => {
    expect(keys('oversight')).toEqual([
      'overview',
      'grades',
      'students',
      'attendance',
      'write-ups',
    ]);
  });

  it('no capability yields no tabs at all', () => {
    expect(keys(null)).toEqual([]);
  });
});

describe('classroomTabHref', () => {
  it('builds the index route for overview with the term id appended', () => {
    const [overview] = tabsForCapability('adviser');
    expect(classroomTabHref('sec-1', overview, 'term-9')).toBe(
      '/classroom/sec-1?term_id=term-9'
    );
  });

  it('builds a nested sub-route href', () => {
    const grades = tabsForCapability('adviser').find(
      (t) => t.key === 'grades'
    )!;
    expect(classroomTabHref('sec-1', grades, 'term-9')).toBe(
      '/classroom/sec-1/grades?term_id=term-9'
    );
  });

  it('omits the query string entirely when there is no resolvable term', () => {
    const [overview] = tabsForCapability('adviser');
    expect(classroomTabHref('sec-1', overview, null)).toBe('/classroom/sec-1');
  });
});
