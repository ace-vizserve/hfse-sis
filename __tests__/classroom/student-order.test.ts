import { describe, expect, it } from 'vitest';

import {
  DEFAULT_STUDENT_ORDER,
  parseStudentOrder,
  sortRosterByOrder,
  studentOrderStorageKey,
  type OrderableStudentRow,
} from '@/lib/classroom/student-order';

describe('parseStudentOrder', () => {
  it('accepts a recognized value', () => {
    expect(parseStudentOrder('alphabetical')).toBe('alphabetical');
    expect(parseStudentOrder('index')).toBe('index');
  });

  it('falls back to the default for null, undefined, or garbage', () => {
    expect(parseStudentOrder(null)).toBe(DEFAULT_STUDENT_ORDER);
    expect(parseStudentOrder(undefined)).toBe(DEFAULT_STUDENT_ORDER);
    expect(parseStudentOrder('')).toBe(DEFAULT_STUDENT_ORDER);
    expect(parseStudentOrder('DROP TABLE students')).toBe(
      DEFAULT_STUDENT_ORDER
    );
  });
});

describe('studentOrderStorageKey', () => {
  it('namespaces the key per section so two classes never collide', () => {
    expect(studentOrderStorageKey('sec-1')).toBe(
      'classroom:sec-1:student-order'
    );
    expect(studentOrderStorageKey('sec-1')).not.toBe(
      studentOrderStorageKey('sec-2')
    );
  });
});

describe('sortRosterByOrder', () => {
  const rows: OrderableStudentRow[] = [
    { index_number: 3, student_name: 'Cruz, Ana' },
    { index_number: 1, student_name: 'Santos, Ben' },
    { index_number: 2, student_name: 'Aquino, Cid' },
  ];

  it('sorts by index_number ascending under "index"', () => {
    expect(sortRosterByOrder(rows, 'index').map((r) => r.index_number)).toEqual(
      [1, 2, 3]
    );
  });

  it('sorts by student_name (last-name-first) under "alphabetical"', () => {
    expect(
      sortRosterByOrder(rows, 'alphabetical').map((r) => r.student_name)
    ).toEqual(['Aquino, Cid', 'Cruz, Ana', 'Santos, Ben']);
  });

  it('does not mutate the input array', () => {
    const original = [...rows];
    sortRosterByOrder(rows, 'alphabetical');
    expect(rows).toEqual(original);
  });

  it('returns a new array reference, not the same one', () => {
    expect(sortRosterByOrder(rows, 'index')).not.toBe(rows);
  });
});
