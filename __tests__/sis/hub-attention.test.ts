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

describe('buildAttentionRows — Phase 7 additions', () => {
  const BASE_INPUT = {
    unassigned: [],
    pendingChangeRequests: 0,
    levelDemand: [],
    acceptingAyCode: 'AY2027',
  };

  it('adds one destructive row for a section with no form adviser', () => {
    const rows = buildAttentionRows({
      ...BASE_INPUT,
      unassignedAdviserSections: [{ id: 'sec-1', name: 'S4 Excellence' }],
    });
    const row = rows.find((r) => r.id === 'unassigned-adviser-sections');
    expect(row).toMatchObject({
      severity: 'destructive',
      text: '1 section has no form adviser',
      meta: 'S4 Excellence',
    });
  });

  it('collapses multiple no-adviser sections into ONE row, not one per section', () => {
    const rows = buildAttentionRows({
      ...BASE_INPUT,
      unassignedAdviserSections: [
        { id: 'sec-1', name: 'P3 Obedience' },
        { id: 'sec-2', name: 'S1 Discipline' },
        { id: 'sec-3', name: 'S2 Integrity' },
      ],
    });
    const adviserRows = rows.filter((r) =>
      r.id.startsWith('unassigned-adviser')
    );
    expect(adviserRows).toHaveLength(1);
    expect(adviserRows[0]).toMatchObject({
      severity: 'destructive',
      text: '3 sections have no form adviser',
      meta: 'P3 Obedience · S1 Discipline · S2 Integrity',
    });
  });

  it('adds a destructive row when an approver flow is under-resourced', () => {
    const rows = buildAttentionRows({
      ...BASE_INPUT,
      approverFlowCounts: { 'markbook.change_request': 1 },
    });
    const row = rows.find(
      (r) => r.id === 'approver-flow-markbook.change_request'
    );
    expect(row?.severity).toBe('destructive'); // 1 approver = destructive per classifyApproverReadiness
  });

  it('omits an approver-flow row when the flow already has 2+ approvers', () => {
    const rows = buildAttentionRows({
      ...BASE_INPUT,
      approverFlowCounts: { 'markbook.change_request': 2 },
    });
    expect(
      rows.some((r) => r.id === 'approver-flow-markbook.change_request')
    ).toBe(false);
  });

  it('adds an amber row per level missing subjects from Structure Defaults', () => {
    const rows = buildAttentionRows({
      ...BASE_INPUT,
      subjectConfigGaps: [
        {
          levelId: 's1',
          levelLabel: 'Secondary 1',
          missingSubjectCodes: ['SCI', 'PE'],
        },
      ],
    });
    const row = rows.find((r) => r.id === 'subject-config-gap-s1');
    expect(row).toMatchObject({
      severity: 'amber',
      text: expect.stringContaining('Secondary 1'),
    });
  });

  it('omits all three new row types when their inputs are absent (backward compatible)', () => {
    const rows = buildAttentionRows(BASE_INPUT);
    expect(rows.some((r) => r.id.startsWith('unassigned-adviser-'))).toBe(
      false
    );
    expect(rows.some((r) => r.id.startsWith('approver-flow-'))).toBe(false);
    expect(rows.some((r) => r.id.startsWith('subject-config-gap-'))).toBe(
      false
    );
  });
});

describe('buildAttentionRows — severity-sorted (Serial Position Effect)', () => {
  it('sorts destructive rows before amber rows regardless of computation order', () => {
    // pendingChangeRequests (amber) is computed before unassignedAdviserSections
    // (destructive) in the function body — the sort must still put the
    // destructive row first in the returned array.
    const rows = buildAttentionRows({
      unassigned: [],
      pendingChangeRequests: 2,
      levelDemand: [],
      acceptingAyCode: 'AY2027',
      unassignedAdviserSections: [{ id: 'sec-1', name: 'P3 Obedience' }],
    });
    expect(rows.map((r) => r.severity)).toEqual(['destructive', 'amber']);
    expect(rows[0].id).toBe('unassigned-adviser-sections');
  });

  it('preserves relative order within the same severity (stable sort)', () => {
    const rows = buildAttentionRows({
      unassigned: [unplaced()],
      pendingChangeRequests: 1,
      levelDemand: [demandRow()],
      acceptingAyCode: 'AY2026',
    });
    // unplaced-students (destructive) first; the two amber rows keep their
    // original relative order (pending-change-requests before level-demand).
    expect(rows.map((r) => r.id)).toEqual([
      'unplaced-students',
      'pending-change-requests',
      'level-demand-Cambridge Stage 1',
    ]);
  });
});
