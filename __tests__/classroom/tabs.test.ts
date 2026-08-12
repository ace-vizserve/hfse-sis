import { describe, expect, it } from 'vitest';

import {
  classroomTabHref,
  tabsForCapability,
  type ClassroomTabKey,
} from '@/lib/classroom/tabs';
import type { ClassroomCapability } from '@/lib/classroom/scope';

// Most cases have no cover in play, so the two capabilities are the same.
function keys(
  capability: ClassroomCapability | null,
  substantiveCapability: ClassroomCapability | null = capability
): ClassroomTabKey[] {
  return tabsForCapability(capability, substantiveCapability).map((t) => t.key);
}

describe('tabsForCapability', () => {
  // The load-bearing invariant of Phase 4: a subject-teacher-only viewer
  // must never be offered attendance or write-ups, in the nav OR anywhere
  // else — those tabs read RLS-restricted data via the service client.
  it('a subject capability never yields attendance or write-ups', () => {
    const tabKeys = keys('subject');
    expect(tabKeys).not.toContain('attendance');
    expect(tabKeys).not.toContain('write-ups');
    // Timeline and Settings ARE included for 'subject' — both are
    // explicitly "all capabilities may see it" (Phase 5 brief for Timeline;
    // Phase 6 for Settings, since the note is scoped to the caller's own
    // row by RLS and the order preference is a personal display toggle),
    // unlike attendance and write-ups which stay adviser/oversight-only.
    expect(tabKeys).toEqual([
      'overview',
      'grades',
      'students',
      'timeline',
      'settings',
    ]);
  });

  it('an adviser capability sees every tab', () => {
    expect(keys('adviser')).toEqual([
      'overview',
      'grades',
      'students',
      'attendance',
      'write-ups',
      'timeline',
      'settings',
    ]);
  });

  it('an oversight capability sees every tab', () => {
    expect(keys('oversight')).toEqual([
      'overview',
      'grades',
      'students',
      'attendance',
      'write-ups',
      'timeline',
      'settings',
    ]);
  });

  it('no capability yields no tabs at all', () => {
    expect(keys(null)).toEqual([]);
  });

  // Relief teachers (migrations 112/113). A substitute covering a form adviser
  // works the class — attendance, marks, roster — but the regular adviser still
  // writes the write-ups while they are away. The write-ups PAGE 404s for a
  // substitute, so per KD #173 the tab that links to it must not render either;
  // offering a tab that immediately 404s is the exact dead end that rule exists
  // to prevent.
  it('a substitute covering an adviser gets attendance but not write-ups', () => {
    const tabKeys = keys('adviser', null);
    expect(tabKeys).toContain('attendance');
    expect(tabKeys).toContain('grades');
    expect(tabKeys).toContain('students');
    expect(tabKeys).not.toContain('write-ups');
  });

  it('the regular adviser keeps write-ups while someone covers for them', () => {
    // Cover does not take anything away from the person being covered.
    expect(keys('adviser', 'adviser')).toContain('write-ups');
  });
});

describe('classroomTabHref', () => {
  it('builds the index route for overview with the term id appended', () => {
    const [overview] = tabsForCapability('adviser', 'adviser');
    expect(classroomTabHref('sec-1', overview, 'term-9')).toBe(
      '/classroom/sec-1?term_id=term-9'
    );
  });

  it('builds a nested sub-route href', () => {
    const grades = tabsForCapability('adviser', 'adviser').find(
      (t) => t.key === 'grades'
    )!;
    expect(classroomTabHref('sec-1', grades, 'term-9')).toBe(
      '/classroom/sec-1/grades?term_id=term-9'
    );
  });

  it('omits the query string entirely when there is no resolvable term', () => {
    const [overview] = tabsForCapability('adviser', 'adviser');
    expect(classroomTabHref('sec-1', overview, null)).toBe('/classroom/sec-1');
  });
});
