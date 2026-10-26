import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Task 17: a WARNING when grading sheets are made for a class with no approved
 * scheme of work this term. Pinned:
 *   1. Sheets are still created when a scheme is missing (never a block).
 *   2. The list names only the classes missing one; a reopened scheme (draft
 *      with an approved snapshot) still counts as approved.
 *   3. A failing scheme lookup does not fail creation.
 *   4. The lookup is a handful of queries however many pairs there are.
 */

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

let tables: Tables = {};
let queries: string[] = [];
let failTable: string | null = null;
let rpcCalled = 0;

function fakeService() {
  return {
    from(table: string) {
      queries.push(table);
      const filters: Array<(r: Row) => boolean> = [];
      const exec = () => {
        if (failTable === table)
          return { data: null, error: { message: 'boom' } };
        const rows = (tables[table] ?? []).filter((r) =>
          filters.every((f) => f(r))
        );
        return { data: rows, error: null };
      };
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
        in: (c: string, v: unknown[]) => (
          filters.push((r) => v.includes(r[c])),
          q
        ),
        not: (c: string, _op: string, v: unknown) => (
          filters.push((r) => r[c] !== v),
          q
        ),
        range: () => q,
        order: () => q,
        maybeSingle: async () => ({ data: exec().data?.[0] ?? null }),
        single: async () => ({ data: exec().data?.[0] ?? null }),
        then: (res: (v: unknown) => unknown) => res(exec()),
      };
      return q;
    },
    rpc: async () => {
      rpcCalled += 1;
      return { data: { inserted: 3 }, error: null };
    },
  };
}

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => fakeService(),
}));
vi.mock('@/lib/auth/require-role', () => ({
  requireRole: async () => ({
    user: { id: 'u1', email: 'a@b.c' },
    role: 'school_admin',
  }),
}));
vi.mock('@/lib/academic-year', () => ({
  requireCurrentAyCode: async () => 'AY2027',
}));
vi.mock('@/lib/audit/log-action', () => ({ logAction: async () => {} }));
vi.mock('@/lib/cache/invalidate-drill-tags', () => ({
  invalidateDrillTags: () => {},
}));
vi.mock('next/cache', () => ({ revalidateTag: () => {} }));
vi.mock('@/lib/grading/sheet-audit-labels', () => ({
  loadSheetAuditLabels: async () => new Map(),
}));

import { listClassesWithoutApprovedSow } from '@/lib/sow/missing';
import { sowMissingMessage } from '@/lib/sow/missing-message';
import { POST } from '@/app/api/grading-sheets/bulk-create/route';

const T1 = 'term-1';

function seed() {
  tables = {
    sections: [
      // A section's own name carries no level ("Courtesy"); the toast adds it.
      {
        id: 'sec-a',
        name: 'Patience',
        level_id: 'lvl-1',
        academic_year_id: 'ay',
        level: { code: 'P1' },
      },
      {
        id: 'sec-b',
        name: 'Courtesy',
        level_id: 'lvl-1',
        academic_year_id: 'ay',
        level: { code: 'P1' },
      },
    ],
    subjects: [
      { id: 'sub-m', name: 'Math' },
      { id: 'sub-e', name: 'English' },
    ],
    subject_configs: [
      { id: 'cfg-m', subject_id: 'sub-m', academic_year_id: 'ay' },
      { id: 'cfg-e', subject_id: 'sub-e', academic_year_id: 'ay' },
    ],
    section_subjects: [
      { section_id: 'sec-a', subject_config_id: 'cfg-m' },
      { section_id: 'sec-a', subject_config_id: 'cfg-e' },
      { section_id: 'sec-b', subject_config_id: 'cfg-m' },
    ],
    terms: [{ id: T1, academic_year_id: 'ay', is_current: true }],
    academic_years: [{ id: 'ay', ay_code: 'AY2027' }],
    grading_sheets: [],
    schemes_of_work: [
      // Math: approved, covers sec-a only.
      {
        id: 'sow-m',
        term_id: T1,
        subject_id: 'sub-m',
        approved_snapshot: { v: 1 },
        state: 'approved',
      },
      // English: reopened (draft) but with an approved snapshot, covers sec-a.
      {
        id: 'sow-e',
        term_id: T1,
        subject_id: 'sub-e',
        approved_snapshot: { v: 1 },
        state: 'draft',
      },
      // A draft never approved for Math, covers sec-b: must NOT count.
      {
        id: 'sow-m2',
        term_id: T1,
        subject_id: 'sub-m',
        approved_snapshot: null,
        state: 'draft',
      },
    ],
    scheme_of_work_classes: [
      { sow_id: 'sow-m', section_id: 'sec-a' },
      { sow_id: 'sow-e', section_id: 'sec-a' },
      { sow_id: 'sow-m2', section_id: 'sec-b' },
    ],
  };
  queries = [];
  failTable = null;
  rpcCalled = 0;
}

const req = (body: unknown) =>
  new Request('http://x/api/grading-sheets/bulk-create', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0];

beforeEach(seed);

describe('listClassesWithoutApprovedSow', () => {
  it('names only the classes with no approved scheme', async () => {
    const out = await listClassesWithoutApprovedSow(
      fakeService() as never,
      T1,
      [
        { sectionId: 'sec-a', subjectId: 'sub-m' },
        { sectionId: 'sec-a', subjectId: 'sub-e' },
        { sectionId: 'sec-b', subjectId: 'sub-m' },
      ]
    );
    expect(out).toEqual([
      {
        sectionId: 'sec-b',
        subjectId: 'sub-m',
        sectionName: 'P1 Courtesy',
        subjectName: 'Math',
      },
    ]);
  });

  it('uses a fixed handful of queries however many pairs', async () => {
    const pairs = ['sec-a', 'sec-b'].flatMap((sectionId) =>
      ['sub-m', 'sub-e'].map((subjectId) => ({ sectionId, subjectId }))
    );
    await listClassesWithoutApprovedSow(fakeService() as never, T1, pairs);
    expect(queries.length).toBeLessThanOrEqual(5);
  });

  it('returns nothing for no pairs', async () => {
    expect(
      await listClassesWithoutApprovedSow(fakeService() as never, T1, [])
    ).toEqual([]);
  });
});

describe('bulk-create route', () => {
  it('still creates the sheets and reports the classes missing a scheme', async () => {
    const res = (await POST(req({ ay_id: 'ay' })))!;
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(rpcCalled).toBe(1);
    expect(json.inserted).toBe(3);
    expect(json.reason).toBe('created');
    expect(json.sowMissing).toEqual([
      expect.objectContaining({
        sectionName: 'P1 Courtesy',
        subjectName: 'Math',
      }),
    ]);
  });

  it('does not fail creation when the scheme lookup fails', async () => {
    failTable = 'schemes_of_work';
    const res = (await POST(req({ ay_id: 'ay' })))!;
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.inserted).toBe(3);
    expect(json.sowMissing).toEqual([]);
  });
});

describe('sowMissingMessage', () => {
  it('is null when nothing is missing', () => {
    expect(sowMissingMessage([])).toBeNull();
  });
  it('lists "Section · Subject" and caps the list', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      sectionName: `S${i}`,
      subjectName: 'Math',
    }));
    const msg = sowMissingMessage(many)!;
    expect(msg).toContain(
      'These classes have no approved scheme of work for this term: S0 · Math'
    );
    expect(msg).toContain('S9 · Math');
    expect(msg).not.toContain('S10 · Math');
    expect(msg).toContain('and 2 more');
  });
});
