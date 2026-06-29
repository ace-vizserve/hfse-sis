/**
 * Tests for lib/sis/index-ordering.ts — the pure TS mirror of migration 072
 * (generate_section_index_numbers, section-tenure-date bucketing).
 *
 * These tests ARE the EXECUTABLE SPECIFICATION of the SQL RPC's ordering
 * and burned-number rules. They do NOT run against the actual Postgres RPC —
 * no DB-integration harness exists in this test suite (deliberate: accepted
 * tradeoff per the plan's "out of scope" section). The negative-index-staging
 * concurrency logic in the RPC is intentionally NOT mirrored or tested here.
 *
 * Cross-reference: supabase/migrations/072_generate_index_section_tenure.sql
 */

import { describe, it, expect } from 'vitest';
import {
  computeIndexAssignments,
  nextIndexForSection,
  type IndexRow,
} from '@/lib/sis/index-ordering';

const T1_START = '2026-01-05'; // first day of the school year

// Helper: build a row with common defaults.
function row(
  id: string,
  last: string,
  first: string,
  middle: string | null,
  status: IndexRow['enrollment_status'],
  enrollmentDate: string | null = null,
  indexNumber: number | null = null
): IndexRow {
  return {
    id,
    enrollment_status: status,
    enrollment_date: enrollmentDate,
    index_number: indexNumber,
    last_name: last,
    first_name: first,
    middle_name: middle,
  };
}

// ─── computeIndexAssignments ─────────────────────────────────────────────────

describe('computeIndexAssignments', () => {
  describe('on-time bucket — alphabetical order', () => {
    it('pure alphabetical by last name', () => {
      const rows: IndexRow[] = [
        row('c', 'Cruz', 'Ana', null, 'active'),
        row('a', 'Abad', 'Pedro', null, 'active'),
        row('b', 'Bautista', 'Jose', null, 'active'),
      ];
      const result = computeIndexAssignments(rows, T1_START);
      const byId = Object.fromEntries(
        result.map((r) => [r.id, r.index_number])
      );
      expect(byId['a']).toBe(1); // Abad
      expect(byId['b']).toBe(2); // Bautista
      expect(byId['c']).toBe(3); // Cruz
    });

    it('first-name tiebreaker when last names match', () => {
      const rows: IndexRow[] = [
        row('b', 'Reyes', 'Zara', null, 'active'),
        row('a', 'Reyes', 'Ana', null, 'active'),
      ];
      const result = computeIndexAssignments(rows, T1_START);
      const byId = Object.fromEntries(
        result.map((r) => [r.id, r.index_number])
      );
      expect(byId['a']).toBe(1); // Ana before Zara
      expect(byId['b']).toBe(2);
    });

    it('middle-name tiebreaker when last + first names match', () => {
      const rows: IndexRow[] = [
        row('b', 'Santos', 'Maria', 'Zenaida', 'active'),
        row('a', 'Santos', 'Maria', 'Alma', 'active'),
      ];
      const result = computeIndexAssignments(rows, T1_START);
      const byId = Object.fromEntries(
        result.map((r) => [r.id, r.index_number])
      );
      expect(byId['a']).toBe(1); // Alma before Zenaida
      expect(byId['b']).toBe(2);
    });

    it('null enrollment_date is treated as on-time', () => {
      const rows: IndexRow[] = [
        row('b', 'Cruz', 'Ana', null, 'active', null),
        row('a', 'Abad', 'Pedro', null, 'active', null),
      ];
      const result = computeIndexAssignments(rows, T1_START);
      const byId = Object.fromEntries(
        result.map((r) => [r.id, r.index_number])
      );
      expect(byId['a']).toBe(1);
      expect(byId['b']).toBe(2);
    });

    it('null t1Start → all rows treated on-time (sorted alphabetically)', () => {
      // Even though student C has an enrollment_date that would be mid-year
      // if t1Start were set, null t1Start means no split → alphabetical only.
      const rows: IndexRow[] = [
        row('b', 'Cruz', 'Ana', null, 'active', '2026-06-15'),
        row('a', 'Abad', 'Pedro', null, 'active', null),
      ];
      const result = computeIndexAssignments(rows, null);
      const byId = Object.fromEntries(
        result.map((r) => [r.id, r.index_number])
      );
      expect(byId['a']).toBe(1); // Abad still first
      expect(byId['b']).toBe(2);
    });
  });

  describe('mid-year bucket — pinned after on-time, sorted by arrival', () => {
    it('single mid-year row goes after all on-time rows', () => {
      const rows: IndexRow[] = [
        row('b', 'Bautista', 'Jose', null, 'active'),
        row('a', 'Abad', 'Pedro', null, 'active'),
        row('c', 'Cruz', 'Ana', null, 'active', '2026-04-01', 3),
      ];
      const result = computeIndexAssignments(rows, T1_START);
      const byId = Object.fromEntries(
        result.map((r) => [r.id, r.index_number])
      );
      expect(byId['a']).toBe(1);
      expect(byId['b']).toBe(2);
      expect(byId['c']).toBe(3);
    });

    it('two mid-year rows sorted by enrollment_date ASC (earlier arrival first)', () => {
      const rows: IndexRow[] = [
        row('a', 'Abad', 'Pedro', null, 'active'),
        row('c', 'Later', 'T', null, 'active', '2026-06-15', 3), // later
        row('d', 'Earlier', 'T', null, 'active', '2026-04-20', 4), // earlier
      ];
      const result = computeIndexAssignments(rows, T1_START);
      const byId = Object.fromEntries(
        result.map((r) => [r.id, r.index_number])
      );
      expect(byId['a']).toBe(1);
      expect(byId['d']).toBe(2); // earlier arrival date
      expect(byId['c']).toBe(3); // later arrival date
    });

    it('tie on enrollment_date → existing index_number ASC as tiebreaker', () => {
      const rows: IndexRow[] = [
        row('b', 'Second', 'T', null, 'active', '2026-04-10', 5),
        row('a', 'First', 'T', null, 'active', '2026-04-10', 3),
      ];
      const result = computeIndexAssignments(rows, T1_START);
      const sorted = [...result].sort(
        (x, y) => x.index_number - y.index_number
      );
      expect(sorted[0].id).toBe('a'); // index_number 3 < 5
      expect(sorted[1].id).toBe('b');
    });

    it('late_enrollee status with mid-year date is bottom-pinned', () => {
      const rows: IndexRow[] = [
        row('a', 'Abad', 'Pedro', null, 'active'),
        row('b', 'Late', 'Student', null, 'late_enrollee', '2026-03-10', 2),
      ];
      const result = computeIndexAssignments(rows, T1_START);
      const byId = Object.fromEntries(
        result.map((r) => [r.id, r.index_number])
      );
      expect(byId['a']).toBe(1);
      expect(byId['b']).toBe(2);
    });
  });

  describe('withdrawn number burned — never reassigned', () => {
    it('single burned number is skipped', () => {
      const rows: IndexRow[] = [
        row('w', 'Gone', 'Student', null, 'withdrawn', null, 1), // burns #1
        row('a', 'Abad', 'Pedro', null, 'active'),
        row('b', 'Bautista', 'Jose', null, 'active'),
      ];
      const result = computeIndexAssignments(rows, T1_START);
      // Withdrawn row not returned
      expect(result.find((r) => r.id === 'w')).toBeUndefined();
      // Active rows get #2 and #3 (skipping burned #1)
      const byId = Object.fromEntries(
        result.map((r) => [r.id, r.index_number])
      );
      expect(byId['a']).toBe(2);
      expect(byId['b']).toBe(3);
    });

    it('multiple non-consecutive burned numbers are all skipped', () => {
      const rows: IndexRow[] = [
        row('w1', 'A', 'X', null, 'withdrawn', null, 1), // burns #1
        row('w2', 'B', 'X', null, 'withdrawn', null, 3), // burns #3
        row('a', 'Abad', 'Pedro', null, 'active'),
        row('b', 'Bautista', 'Jose', null, 'active'),
        row('c', 'Cruz', 'Ana', null, 'active'),
      ];
      const result = computeIndexAssignments(rows, T1_START);
      const byId = Object.fromEntries(
        result.map((r) => [r.id, r.index_number])
      );
      expect(byId['a']).toBe(2); // #1 burned
      expect(byId['b']).toBe(4); // #3 burned
      expect(byId['c']).toBe(5);
    });

    it('all withdrawn → no assignments', () => {
      const rows: IndexRow[] = [
        row('w1', 'A', 'X', null, 'withdrawn', null, 1),
        row('w2', 'B', 'X', null, 'withdrawn', null, 2),
      ];
      expect(computeIndexAssignments(rows, T1_START)).toHaveLength(0);
    });
  });

  describe('mixed roster', () => {
    it('on-time + mid-year + withdrawn — all rules combined', () => {
      const rows: IndexRow[] = [
        row('w', 'Prior', 'Student', null, 'withdrawn', null, 2), // burns #2
        row('a', 'Abad', 'Pedro', null, 'active'), // on-time
        row('b', 'Cruz', 'Ana', null, 'active'), // on-time
        row('c', 'Transfer', 'T', null, 'active', '2026-04-10', 4), // mid-year
      ];
      const result = computeIndexAssignments(rows, T1_START);
      // Withdrawn not returned
      expect(result.find((r) => r.id === 'w')).toBeUndefined();
      // #2 burned → assign #1, #3, #4
      const byId = Object.fromEntries(
        result.map((r) => [r.id, r.index_number])
      );
      expect(byId['a']).toBe(1); // Abad = on-time, first alpha
      expect(byId['b']).toBe(3); // Cruz = on-time, second alpha (#2 burned)
      expect(byId['c']).toBe(4); // Transfer = mid-year, bottom
    });
  });

  describe('edge cases', () => {
    it('empty section returns empty array', () => {
      expect(computeIndexAssignments([], T1_START)).toHaveLength(0);
    });

    it('single active student gets index #1', () => {
      const result = computeIndexAssignments(
        [row('a', 'Abad', 'Pedro', null, 'active')],
        T1_START
      );
      expect(result).toEqual([{ id: 'a', index_number: 1 }]);
    });

    it('withdrawn row with null index_number does not burn anything', () => {
      const rows: IndexRow[] = [
        row('w', 'Gone', 'S', null, 'withdrawn', null, null), // null — nothing burned
        row('a', 'Abad', 'Pedro', null, 'active'),
      ];
      const result = computeIndexAssignments(rows, T1_START);
      expect(result).toEqual([{ id: 'a', index_number: 1 }]); // #1 not burned
    });
  });
});

// ─── nextIndexForSection ─────────────────────────────────────────────────────

describe('nextIndexForSection', () => {
  it('returns max + 1 for a non-empty list', () => {
    expect(nextIndexForSection([1, 2, 3])).toBe(4);
    expect(nextIndexForSection([3, 1, 5])).toBe(6);
    expect(nextIndexForSection([10])).toBe(11);
  });

  it('returns 1 when the section has no enrolled students yet', () => {
    expect(nextIndexForSection([])).toBe(1);
  });

  it('ignores order of elements (uses max, not last)', () => {
    expect(nextIndexForSection([5, 2, 8, 1])).toBe(9);
  });
});
