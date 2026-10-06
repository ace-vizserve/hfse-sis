import { beforeEach, describe, expect, it, vi } from 'vitest';

// ONE ANSWER TO "WHAT LEVEL IS THIS CHILD IN?" — on the Records surfaces.
//
// An application stores the parent-facing level name ("Year 10"); the enrolment
// form options map it to the SIS level it counts as (`level_aliases`). Every
// Records loader that SHOWS, GROUPS, FILTERS, SORTS or COUNTS a level must hand
// back the resolved label — `classLevel` once set, else the resolved name — so
// a "Year 10" child is counted under Secondary Three, not in a bucket of its own.

vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
  revalidateTag: vi.fn(),
}));

type Row = Record<string, unknown>;
let db: Record<string, Row[]> = {};

// A minimal chainable PostgREST stand-in: filters `.eq` / `.in` on plain
// columns, slices `.range`, ignores ordering and embedded-path filters.
function fakeClient() {
  return {
    from(table: string) {
      let rows = [...(db[table] ?? [])];
      let single = false;
      const builder = {
        select: () => builder,
        order: () => builder,
        neq: (col: string, val: unknown) => {
          rows = rows.filter((r) => r[col] !== val);
          return builder;
        },
        eq: (col: string, val: unknown) => {
          if (!col.includes('.')) rows = rows.filter((r) => r[col] === val);
          return builder;
        },
        in: (col: string, vals: unknown[]) => {
          rows = rows.filter((r) => vals.includes(r[col]));
          return builder;
        },
        range: (from: number, to: number) => {
          rows = rows.slice(from, to + 1);
          return builder;
        },
        maybeSingle: () => {
          single = true;
          return builder;
        },
        then: (
          resolve: (v: { data: unknown; error: null }) => unknown,
          reject?: (e: unknown) => unknown
        ) =>
          Promise.resolve({
            data: single ? (rows[0] ?? null) : rows,
            error: null,
          }).then(resolve, reject),
      };
      return builder;
    },
  };
}

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => fakeClient(),
}));

import {
  getClassAssignmentReadiness,
  getLevelDistribution,
} from '@/lib/sis/dashboard';
import { buildLifecycleDrillRows } from '@/lib/sis/drill';
import { listStudents } from '@/lib/sis/queries';
import { getStpCohort } from '@/lib/sis/cohorts';

const LEVELS: Row[] = [
  {
    id: 'l-p1',
    code: 'P1',
    label: 'Primary One',
    level_type: 'primary',
    sort_order: 10,
    next_level_id: null,
    is_core: true,
  },
  {
    id: 'l-s3',
    code: 'S3',
    label: 'Secondary Three',
    level_type: 'secondary',
    sort_order: 90,
    next_level_id: null,
    is_core: true,
  },
];

beforeEach(() => {
  db = {
    levels: LEVELS,
    level_aliases: [{ raw_label: 'Year 10', level_id: 'l-s3' }],
    academic_years: [{ id: 'ay-1', ay_code: 'AY2026' }],
    sections: [{ id: 'sec-1', academic_year_id: 'ay-1' }],
    section_students: [],
  };
});

describe('Records level resolution', () => {
  it('counts a "Year 10" child under Secondary Three in the level donut', async () => {
    db.ay2026_enrolment_status = [
      { enroleeNumber: 'E1', classLevel: null, applicationStatus: 'Enrolled' },
      {
        enroleeNumber: 'E2',
        classLevel: 'Secondary Three',
        applicationStatus: 'Enrolled',
      },
      { enroleeNumber: 'E3', classLevel: null, applicationStatus: 'Enrolled' },
      { enroleeNumber: 'E4', classLevel: null, applicationStatus: 'Enrolled' },
    ];
    db.ay2026_enrolment_applications = [
      { enroleeNumber: 'E1', levelApplied: 'Year 10' },
      { enroleeNumber: 'E2', levelApplied: 'Year 10' },
      { enroleeNumber: 'E3', levelApplied: 'Primary One' },
      { enroleeNumber: 'E4', levelApplied: 'Mystery Level' },
    ];

    const out = await getLevelDistribution('AY2026');
    // Level order, an unmapped name after the known levels — and no
    // "Year 10" bucket.
    expect(out).toEqual([
      { level: 'Primary One', count: 1 },
      { level: 'Secondary Three', count: 2 },
      { level: 'Mystery Level', count: 1 },
    ]);
  });

  it('lists a classless "Year 10" child at Secondary Three on the class-assignment card', async () => {
    db.ay2026_enrolment_status = [
      {
        enroleeNumber: 'E1',
        applicationStatus: 'Enrolled',
        applicationUpdatedDate: null,
        classLevel: null,
        classSection: null,
        levelApplied: 'Year 10',
      },
    ];
    db.ay2026_enrolment_applications = [
      {
        enroleeNumber: 'E1',
        enroleeFullName: 'Ada Lovelace',
        levelApplied: 'Year 10',
        created_at: null,
      },
    ];

    const out = await getClassAssignmentReadiness('AY2026');
    expect(out).toHaveLength(1);
    expect(out[0].level).toBe('Secondary Three');
  });

  it('gives the student list a resolved `level` beside the raw name', async () => {
    db.ay2026_enrolment_applications = [
      { enroleeNumber: 'E1', levelApplied: 'Year 10' },
      { enroleeNumber: 'E2', levelApplied: 'Year 10' },
    ];
    db.ay2026_enrolment_status = [
      { enroleeNumber: 'E1', classLevel: null },
      // classLevel wins once set.
      { enroleeNumber: 'E2', classLevel: 'Primary One' },
    ];

    const out = await listStudents('AY2026');
    const byEnrolee = new Map(out.map((r) => [r.enroleeNumber, r]));
    expect(byEnrolee.get('E1')?.level).toBe('Secondary Three');
    expect(byEnrolee.get('E1')?.levelApplied).toBe('Year 10');
    expect(byEnrolee.get('E2')?.level).toBe('Primary One');
  });

  it('gives cohort rows a resolved `level`', async () => {
    db.ay2026_enrolment_applications = [
      {
        enroleeNumber: 'E1',
        enroleeFullName: 'Ada Lovelace',
        levelApplied: 'Year 10',
        stpApplicationType: 'New',
        stpApplicationStatus: 'Pending',
        residenceHistory: null,
      },
    ];
    db.ay2026_enrolment_status = [
      { enroleeNumber: 'E1', applicationStatus: 'Enrolled', classLevel: null },
    ];

    const out = await getStpCohort('AY2026', 'enrolled');
    expect(out).toHaveLength(1);
    expect(out[0].level).toBe('Secondary Three');
    expect(out[0].levelApplied).toBe('Year 10');
  });

  it('gives lifecycle drill rows a resolved `level` beside the raw name', async () => {
    db.ay2026_enrolment_applications = [
      { enroleeNumber: 'E1', levelApplied: 'Year 10', category: 'New' },
    ];
    db.ay2026_enrolment_status = [
      { enroleeNumber: 'E1', applicationStatus: 'Submitted', classLevel: null },
    ];
    db.ay2026_enrolment_documents = [];

    const out = await buildLifecycleDrillRows('AY2026', 'new-applications');
    expect(out).toHaveLength(1);
    expect(out[0].level).toBe('Secondary Three');
    expect(out[0].levelApplied).toBe('Year 10');
  });
});
