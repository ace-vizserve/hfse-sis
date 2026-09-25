/**
 * `transferStudentSection` refuses a move into a different level, always.
 * The `allowLevelChange` opt-in it once had (2026-09-24) is gone — a level
 * is fixed once the student is in a class (lib/sis/level-lock.ts).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Each `from(table)` call takes the next queued response for that table. The
// builder is chainable and thenable, and `maybeSingle()` resolves the same
// response, which covers every call shape the transfer makes.
function fakeClient(queues: Record<string, unknown[]>) {
  const calls: Array<{ table: string; update?: unknown }> = [];
  const from = (table: string) => {
    const response = queues[table]?.shift() ?? { data: null, error: null };
    const call: { table: string; update?: unknown } = { table };
    calls.push(call);
    const builder: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'neq', 'in', 'filter']) {
      builder[m] = () => builder;
    }
    builder.update = (patch: unknown) => {
      call.update = patch;
      return builder;
    };
    builder.maybeSingle = () => Promise.resolve(response);
    builder.then = (resolve: (v: unknown) => unknown) => resolve(response);
    return builder;
  };
  const rpc = vi.fn(() => Promise.resolve({ data: {}, error: null }));
  return { client: { from, rpc }, calls, rpc };
}

let admissions: ReturnType<typeof fakeClient>;

vi.mock('@/lib/supabase/admissions', () => ({
  createAdmissionsClient: () => admissions.client,
}));
vi.mock('@/lib/dates', () => ({ sgToday: () => '2026-09-24' }));
vi.mock('@/lib/sis/terms', () => ({
  getTermForDate: () => Promise.resolve(null),
}));

import { transferStudentSection } from '@/lib/sis/section-transfer';

const P1 = { label: 'Primary One' };
const P2 = { label: 'Primary Two' };

function serviceFor() {
  return fakeClient({
    academic_years: [{ data: { id: 'ay' }, error: null }],
    sections: [
      // target section (Primary Two)
      {
        data: {
          id: 'p2-sec',
          name: 'Kindness',
          level_id: 'p2',
          academic_year_id: 'ay',
          levels: P2,
        },
        error: null,
      },
      // every section in the AY
      {
        data: [
          { id: 'p1-sec', level_id: 'p1', name: 'Respect', levels: P1 },
          { id: 'p2-sec', level_id: 'p2', name: 'Kindness', levels: P2 },
        ],
        error: null,
      },
    ],
    students: [
      {
        data: { id: 'stu', first_name: 'A', middle_name: null, last_name: 'B' },
        error: null,
      },
    ],
    section_students: [
      // the student's enrolments this AY
      {
        data: [
          {
            id: 'enr',
            section_id: 'p1-sec',
            enrollment_status: 'active',
            enrollment_date: null,
            late_enrollee_term_number: null,
          },
        ],
        error: null,
      },
      // target headcount
      { count: 3, error: null },
    ],
  });
}

const params = {
  ayCode: 'AY2026',
  enroleeNumber: 'E260535',
  targetSectionId: 'p2-sec',
  actorEmail: 'staff@hfse.edu.sg',
};

describe('transferStudentSection across levels', () => {
  beforeEach(() => {
    admissions = fakeClient({
      ay2026_enrolment_applications: [
        { data: { studentNumber: 'S1' }, error: null },
      ],
      ay2026_enrolment_status: [{ data: null, error: null }],
    });
  });

  it('refuses a level change', async () => {
    const service = serviceFor();
    const result = await transferStudentSection(
      service.client as unknown as SupabaseClient,
      params
    );
    expect(result).toMatchObject({ ok: false, status: 422 });
    expect(!result.ok && result.error).toContain('same level only');
    expect(service.rpc).not.toHaveBeenCalled();
  });

  it('refuses it even when a caller still sends the old opt-in', async () => {
    const service = serviceFor();
    const result = await transferStudentSection(
      service.client as unknown as SupabaseClient,
      { ...params, allowLevelChange: true } as typeof params
    );
    expect(result).toMatchObject({ ok: false, status: 422 });
    expect(service.rpc).not.toHaveBeenCalled();
    expect(
      admissions.calls.some((c) => c.table === 'ay2026_enrolment_status')
    ).toBe(false);
  });
});
