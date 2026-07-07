/**
 * Tests for kpisFrom() — the pure submission-KPI aggregator in
 * lib/evaluation/dashboard.ts.
 *
 * Guards the KD #120 numerator predicate: "submitted" requires
 * `submitted = true` AND non-empty content. An emptied-but-still-submitted
 * write-up must NOT count — the same rule the chase loader, the priority
 * panels, and the drill's status classifier apply (count == drill, KD #124).
 */

import { describe, it, expect } from 'vitest';
import { kpisFrom, type WriteupRow } from '@/lib/evaluation/dashboard';

function row(overrides: Partial<WriteupRow> = {}): WriteupRow {
  return {
    id: 'w1',
    student_id: 's1',
    section_id: 'sec1',
    term_id: 't1',
    submitted: true,
    has_content: true,
    submitted_at: '2026-03-10T02:00:00Z',
    created_at: '2026-03-01T02:00:00Z',
    updated_at: '2026-03-10T02:00:00Z',
    ...overrides,
  };
}

const FROM = '2026-01-01';
const TO = '2026-12-31';

describe('kpisFrom — submitted numerator (KD #120)', () => {
  it('counts a submitted write-up with non-empty content', () => {
    const kpis = kpisFrom([row()], FROM, TO, 10, 3);
    expect(kpis.submitted).toBe(1);
    expect(kpis.expected).toBe(30);
    expect(kpis.submissionPct).toBeCloseTo((1 / 30) * 100);
  });

  it('does NOT count an emptied-but-still-submitted write-up', () => {
    const kpis = kpisFrom(
      [row({ submitted: true, has_content: false })],
      FROM,
      TO,
      10,
      3
    );
    expect(kpis.submitted).toBe(0);
  });

  it('does NOT count a non-empty draft (submitted=false)', () => {
    const kpis = kpisFrom(
      [row({ submitted: false, has_content: true, submitted_at: null })],
      FROM,
      TO,
      10,
      3
    );
    expect(kpis.submitted).toBe(0);
  });

  it('mixed set counts only submitted + non-empty', () => {
    const rows = [
      row({ id: 'a', student_id: 's1' }), // counts
      row({ id: 'b', student_id: 's2', has_content: false }), // emptied
      row({
        id: 'c',
        student_id: 's3',
        submitted: false,
        submitted_at: null,
      }), // draft
      row({ id: 'd', student_id: 's4' }), // counts
    ];
    const kpis = kpisFrom(rows, FROM, TO, 4, 3);
    expect(kpis.submitted).toBe(2);
  });

  it('respects the date window (submitted_at anchor)', () => {
    const rows = [
      row({ id: 'in', submitted_at: '2026-03-10T02:00:00Z' }),
      row({ id: 'out', submitted_at: '2026-07-10T02:00:00Z' }),
    ];
    const kpis = kpisFrom(rows, '2026-03-01', '2026-03-31', 10, 3);
    expect(kpis.submitted).toBe(1);
  });

  it('expected=0 → 0% (no divide-by-zero)', () => {
    const kpis = kpisFrom([], FROM, TO, 0, 3);
    expect(kpis.expected).toBe(0);
    expect(kpis.submissionPct).toBe(0);
  });
});
