import { describe, expect, it } from 'vitest';

import { buildAttentionRows } from '@/lib/sis/hub-attention';
import type { ClassAssignmentReadinessRow } from '@/lib/sis/dashboard';
import type { LevelDemandRow } from '@/lib/sis/level-demand';

function unplaced(
  overrides: Partial<ClassAssignmentReadinessRow> = {}
): ClassAssignmentReadinessRow {
  return {
    enroleeNumber: 'E-0001',
    fullName: 'Test Student',
    level: 'P3',
    enrollmentDate: '2026-01-05',
    daysSinceEnrollment: 3,
    ...overrides,
  };
}

function demandRow(overrides: Partial<LevelDemandRow> = {}): LevelDemandRow {
  return {
    label: 'Cambridge Stage 1',
    levelId: null,
    count: 2,
    offered: false,
    ...overrides,
  };
}

describe('buildAttentionRows', () => {
  it('empty inputs produce an empty row list', () => {
    expect(
      buildAttentionRows({
        unassigned: [],
        pendingChangeRequests: 0,
        levelDemand: [],
        acceptingAyCode: 'AY2026',
      })
    ).toEqual([]);
  });

  it('unplaced students row is destructive and groups meta by level', () => {
    const rows = buildAttentionRows({
      unassigned: [
        unplaced({ level: 'P3' }),
        unplaced({ level: 'P3' }),
        unplaced({ level: 'S1' }),
      ],
      pendingChangeRequests: 0,
      levelDemand: [],
      acceptingAyCode: 'AY2026',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].severity).toBe('destructive');
    expect(rows[0].text).toContain('3 enrolled students have no class yet');
    expect(rows[0].meta).toContain('P3 ×2');
    expect(rows[0].meta).toContain('S1');
    expect(rows[0].href).toBe('/records/unsynced');
  });

  it('singular phrasing for exactly one unplaced student', () => {
    const rows = buildAttentionRows({
      unassigned: [unplaced()],
      pendingChangeRequests: 0,
      levelDemand: [],
      acceptingAyCode: 'AY2026',
    });
    expect(rows[0].text).toBe('1 enrolled student has no class yet');
  });

  it('pending change requests row only appears when count > 0', () => {
    const none = buildAttentionRows({
      unassigned: [],
      pendingChangeRequests: 0,
      levelDemand: [],
      acceptingAyCode: 'AY2026',
    });
    expect(none).toEqual([]);

    const some = buildAttentionRows({
      unassigned: [],
      pendingChangeRequests: 4,
      levelDemand: [],
      acceptingAyCode: 'AY2026',
    });
    expect(some).toHaveLength(1);
    expect(some[0].severity).toBe('amber');
    expect(some[0].text).toBe('4 grade changes are waiting on an approver');
    expect(some[0].href).toBe('/markbook/change-requests');
  });

  it('level demand rows are filtered to un-offered/unknown with count > 0', () => {
    const rows = buildAttentionRows({
      unassigned: [],
      pendingChangeRequests: 0,
      levelDemand: [
        demandRow({ label: 'Cambridge Stage 1', offered: false, count: 2 }),
        demandRow({ label: 'Primary Three', offered: true, count: 40 }), // offered — excluded
        demandRow({ label: 'Grade 99', offered: false, count: 0 }), // zero — excluded
      ],
      acceptingAyCode: 'AY2027',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].severity).toBe('amber');
    expect(rows[0].text).toContain('2 applicants chose Cambridge Stage 1');
    expect(rows[0].href).toBe('/sis/admin/levels');
  });

  it('level demand text + meta carry the accepting AY code, not a generic "this year"', () => {
    const rows = buildAttentionRows({
      unassigned: [],
      pendingChangeRequests: 0,
      levelDemand: [
        demandRow({ label: 'Cambridge Stage 1', offered: false, count: 2 }),
      ],
      acceptingAyCode: 'AY2027',
    });
    expect(rows[0].text).toBe(
      '2 applicants chose Cambridge Stage 1 — not offered in AY2027'
    );
    expect(rows[0].meta).toBe('AY2027');
  });

  it('merges all three signal kinds in one list', () => {
    const rows = buildAttentionRows({
      unassigned: [unplaced()],
      pendingChangeRequests: 1,
      levelDemand: [demandRow()],
      acceptingAyCode: 'AY2026',
    });
    expect(rows.map((r) => r.id)).toEqual([
      'unplaced-students',
      'pending-change-requests',
      'level-demand-Cambridge Stage 1',
    ]);
  });
});
