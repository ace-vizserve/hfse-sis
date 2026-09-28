/**
 * A class can be CHOSEN at any application status; a child JOINS it only once
 * the application is Enrolled or Enrolled (Conditional).
 *
 * Two paths carry that rule and both are pinned here:
 *   * `syncOneStudent` — the per-child sync behind the stage route, the
 *     assign-section route and the nightly auto-sync. Refuses with the stable
 *     NOT_ENROLLED_REASON, which callers treat as "chosen, waiting".
 *   * `buildSyncPlan` — the bulk planner. The gate is in the PLANNER, not in a
 *     narrower admissions fetch, because the planner withdraws every active
 *     roster row it does not see. Some children already sit in a class with a
 *     Submitted application (placed before this rule — ~15 in AY2026); leaving
 *     them out of the input would have withdrawn every one of them. The tests
 *     below prove such a child is neither withdrawn nor moved.
 */
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { AdmissionsRow } from '@/lib/supabase/admissions';
import {
  buildSyncPlan,
  isEnrolledApplicationStatus,
  NOT_ENROLLED_REASON,
  syncOneStudent,
  type GradingSnapshot,
} from '@/lib/sync/students';

// ── Planner fixtures ─────────────────────────────────────────────────────────

const LEVEL = { id: 'lvl-p1', label: 'Primary One' };
const PATIENCE = { id: 'sec-pat', level_id: 'lvl-p1', name: 'Patience' };
const RESPECT = { id: 'sec-res', level_id: 'lvl-p1', name: 'Respect' };

function row(overrides: Partial<AdmissionsRow> = {}): AdmissionsRow {
  return {
    student_number: 'H270001',
    last_name: 'Cruz',
    first_name: 'Ana',
    middle_name: null,
    class_level: 'Primary One',
    class_section: 'Patience',
    class_ay: 'AY2026',
    enrolee_number: 'E270001',
    application_status: 'Enrolled',
    ...overrides,
  };
}

// One child already in Patience at #1 — the "placed before the rule" shape.
function rosteredSnapshot(
  status: 'active' | 'late_enrollee' | 'withdrawn' = 'active'
): GradingSnapshot {
  return {
    levels: [LEVEL],
    sections: [PATIENCE, RESPECT],
    students: [
      {
        id: 'stu-1',
        student_number: 'H270001',
        last_name: 'Cruz',
        first_name: 'Ana',
        middle_name: null,
      },
    ],
    enrollments: [
      {
        id: 'enr-1',
        section_id: 'sec-pat',
        student_id: 'stu-1',
        index_number: 1,
        enrollment_status: status,
      },
    ],
  };
}

const emptySnapshot: GradingSnapshot = {
  levels: [LEVEL],
  sections: [PATIENCE, RESPECT],
  students: [],
  enrollments: [],
};

describe('isEnrolledApplicationStatus', () => {
  it('accepts the two Enrolled application statuses, trimmed', () => {
    expect(isEnrolledApplicationStatus('Enrolled')).toBe(true);
    expect(isEnrolledApplicationStatus('Enrolled (Conditional)')).toBe(true);
    expect(isEnrolledApplicationStatus(' Enrolled ')).toBe(true);
  });

  it('refuses everything else, including the roster statuses', () => {
    for (const s of [
      'Submitted',
      'Processing',
      'Cancelled',
      'Withdrawn',
      'active',
      '',
      null,
      undefined,
    ]) {
      expect(isEnrolledApplicationStatus(s)).toBe(false);
    }
  });
});

describe('buildSyncPlan — the Enrolled gate on the bulk path', () => {
  it('does not newly enrol a Submitted child with a chosen class', () => {
    const plan = buildSyncPlan(
      [row({ application_status: 'Submitted' })],
      emptySnapshot
    );
    expect(plan.student_upserts).toEqual([]);
    expect(plan.enrollment_inserts).toEqual([]);
    expect(plan.errors).toEqual([]);
    expect(plan.waiting_for_enrolment).toEqual([
      { row_index: 0, student_number: 'H270001', reason: NOT_ENROLLED_REASON },
    ]);
    expect(plan.stats.waiting_for_enrolment).toBe(1);
  });

  it('still enrols Enrolled and Enrolled (Conditional) children', () => {
    const plan = buildSyncPlan(
      [
        row(),
        row({
          student_number: 'H270002',
          enrolee_number: 'E270002',
          application_status: 'Enrolled (Conditional)',
        }),
      ],
      emptySnapshot
    );
    expect(plan.enrollment_inserts.map((e) => e.student_number)).toEqual([
      'H270001',
      'H270002',
    ]);
    expect(plan.waiting_for_enrolment).toEqual([]);
  });

  it('leaves an already-rostered Submitted child in their class — no withdrawal', () => {
    const plan = buildSyncPlan(
      [row({ application_status: 'Submitted' })],
      rosteredSnapshot()
    );
    expect(plan.enrollment_status_changes).toEqual([]);
    expect(plan.enrollment_inserts).toEqual([]);
    expect(plan.stats.enrollments_to_withdraw).toBe(0);
  });

  it('does not MOVE a rostered Submitted child whose chosen class changed', () => {
    // Admissions now says Respect; the roster says Patience. Before enrolment
    // that is a choice, not a move: no new row, and Patience is not withdrawn.
    const plan = buildSyncPlan(
      [row({ application_status: 'Submitted', class_section: 'Respect' })],
      rosteredSnapshot()
    );
    expect(plan.enrollment_inserts).toEqual([]);
    expect(plan.enrollment_status_changes).toEqual([]);
    expect(plan.waiting_for_enrolment).toHaveLength(1);
  });

  it('does not reactivate a withdrawn roster row for a Submitted child', () => {
    const plan = buildSyncPlan(
      [row({ application_status: 'Processing' })],
      rosteredSnapshot('withdrawn')
    );
    expect(plan.enrollment_status_changes).toEqual([]);
    expect(plan.enrollment_inserts).toEqual([]);
    expect(plan.waiting_for_enrolment).toHaveLength(1);
  });

  it('still refreshes the name of a rostered Submitted child, as before', () => {
    const plan = buildSyncPlan(
      [row({ application_status: 'Submitted', last_name: 'Cruz-Reyes' })],
      rosteredSnapshot()
    );
    expect(plan.student_upserts).toMatchObject([
      { kind: 'update', existing_id: 'stu-1', last_name: 'Cruz-Reyes' },
    ]);
    expect(plan.enrollment_status_changes).toEqual([]);
  });

  it('keeps the Enrolled move behaviour unchanged', () => {
    // Control: an ENROLLED child whose class changed moves as it always has.
    const plan = buildSyncPlan(
      [row({ class_section: 'Respect' })],
      rosteredSnapshot()
    );
    expect(plan.enrollment_inserts).toMatchObject([
      { section_id: 'sec-res', student_number: 'H270001' },
    ]);
    expect(plan.enrollment_status_changes).toMatchObject([
      { enrollment_id: 'enr-1', to: 'withdrawn' },
    ]);
  });
});

// ── syncOneStudent ───────────────────────────────────────────────────────────
//
// A minimal chainable stand-in for the two Supabase clients. Every builder
// method returns the builder; awaiting it (or `.maybeSingle()`) resolves to
// what `respond` says for that table + operation. Writes are recorded so the
// refusal cases can prove nothing was written.

type Call = { table: string; op: 'select' | 'insert' | 'update' };

function fakeClient(
  respond: (c: Call) => { data: unknown; error: null },
  writes: Call[]
): SupabaseClient {
  const from = (table: string) => {
    const call: Call = { table, op: 'select' };
    const result = () => Promise.resolve(respond(call));
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    for (const m of ['select', 'eq', 'in', 'range', 'order', 'not']) {
      builder[m] = chain;
    }
    builder.insert = () => {
      call.op = 'insert';
      writes.push({ ...call });
      return builder;
    };
    builder.update = () => {
      call.op = 'update';
      writes.push({ ...call });
      return builder;
    };
    builder.maybeSingle = result;
    builder.then = (
      ok: (v: unknown) => unknown,
      err?: (e: unknown) => unknown
    ) => result().then(ok, err);
    return builder;
  };
  return { from } as unknown as SupabaseClient;
}

function admissionsFor(applicationStatus: string): SupabaseClient {
  return fakeClient((c) => {
    if (c.table.endsWith('_enrolment_applications')) {
      return {
        data: {
          enroleeNumber: 'E270001',
          studentNumber: 'H270001',
          lastName: 'Cruz',
          firstName: 'Ana',
          middleName: null,
        },
        error: null,
      };
    }
    return {
      data: {
        enroleeNumber: 'E270001',
        classLevel: 'Primary One',
        classSection: 'Patience',
        classAY: 'AY2027',
        applicationStatus,
      },
      error: null,
    };
  }, []);
}

// A grading side with the level + section and no student yet.
function gradingService(writes: Call[]): SupabaseClient {
  return fakeClient((c) => {
    if (c.table === 'levels') return { data: [LEVEL], error: null };
    if (c.table === 'sections') {
      return {
        data: [{ ...PATIENCE, academic_year: { ay_code: 'AY2027' } }],
        error: null,
      };
    }
    if (c.table === 'students') {
      return c.op === 'insert'
        ? { data: [{ id: 'stu-new' }], error: null }
        : { data: null, error: null };
    }
    // section_students: no rows read, inserts succeed.
    return { data: c.op === 'select' ? [] : null, error: null };
  }, writes);
}

describe('syncOneStudent — the Enrolled gate', () => {
  it.each(['Submitted', 'Processing'])(
    'refuses a %s application with NOT_ENROLLED_REASON and writes nothing',
    async (status) => {
      const writes: Call[] = [];
      const result = await syncOneStudent(
        gradingService(writes),
        admissionsFor(status),
        'E270001',
        'AY2027'
      );
      expect(result).toEqual({
        ok: false,
        change: 'skipped',
        reason: NOT_ENROLLED_REASON,
      });
      expect(writes).toEqual([]);
    }
  );

  it.each(['Enrolled', 'Enrolled (Conditional)'])(
    'still places a %s child in their class',
    async (status) => {
      const writes: Call[] = [];
      const result = await syncOneStudent(
        gradingService(writes),
        admissionsFor(status),
        'E270001',
        'AY2027'
      );
      expect(result).toEqual({ ok: true, change: 'enrolled' });
      expect(writes).toEqual([
        { table: 'students', op: 'insert' },
        { table: 'section_students', op: 'insert' },
      ]);
    }
  );
});
