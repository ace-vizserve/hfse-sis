/**
 * buildFormAdviserNameMap() — pure batch resolver for the masterfile's
 * dual-source-drift fix: form advisers must resolve from LIVE
 * teacher_assignments rows, never the denormalized
 * `sections.form_class_adviser` mirror (best-effort-written on assign,
 * never cleared on unassign — see app/api/teacher-assignments/*). Mirrors
 * the same rationale as lib/markbook/publish-readiness.ts and the
 * build-report-card.ts fix.
 *
 * Extracted as a pure function (no Supabase mocking needed) — same spirit
 * as readiness.ts's resolveSubjectWeightsStep/resolveAdvisersStep split
 * from their DB-fetching siblings.
 */

import { describe, expect, it } from 'vitest';
import { buildFormAdviserNameMap } from '@/lib/markbook/masterfile';

describe('buildFormAdviserNameMap', () => {
  it('resolves each assigned section to its adviser display name', () => {
    const map = buildFormAdviserNameMap(
      [
        { section_id: 'sec-1', teacher_user_id: 'user-1' },
        { section_id: 'sec-2', teacher_user_id: 'user-2' },
      ],
      [
        ['user-1', 'Maria T.'],
        ['user-2', 'Daniel L.'],
      ]
    );
    expect(map.get('sec-1')).toBe('Maria T.');
    expect(map.get('sec-2')).toBe('Daniel L.');
  });

  it('a section with no teacher_assignments row is absent from the map (caller resolves to null)', () => {
    const map = buildFormAdviserNameMap(
      [{ section_id: 'sec-1', teacher_user_id: 'user-1' }],
      [['user-1', 'Maria T.']]
    );
    expect(map.has('sec-unassigned')).toBe(false);
    expect(map.get('sec-unassigned') ?? null).toBeNull();
  });

  it('falls back to the raw teacher_user_id when no staff name entry matches (defensive — should not happen)', () => {
    const map = buildFormAdviserNameMap(
      [{ section_id: 'sec-1', teacher_user_id: 'ghost-user' }],
      []
    );
    expect(map.get('sec-1')).toBe('ghost-user');
  });

  it('never reads a denormalized mirror value — only the assignments + staff-name inputs decide the result', () => {
    // No `form_class_adviser` field appears anywhere in this function's
    // inputs — this test documents that by construction: the function
    // signature has no way to receive it.
    const map = buildFormAdviserNameMap(
      [{ section_id: 'sec-1', teacher_user_id: 'user-1' }],
      [['user-1', 'Live Adviser Name']]
    );
    expect(map.get('sec-1')).toBe('Live Adviser Name');
  });
});
