/**
 * An approved declaration's Excused days are audited by the code that writes
 * them — `lib/declarations/register.ts`.
 *
 * Until migration 166 the only trace of those marks was the
 * `attendance_daily_audit` trigger, which runs inside a service-role insert
 * with no signed-in caller and so logged them as 'system', about no child.
 * 166 makes the trigger step aside for service-role writers. These tests pin
 * the rows that replace it: one per day, the approver as actor, the child and
 * class named, and the marks still logged when a rollup after them fails.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

type AuditRow = {
  action: string;
  entityType: string;
  entityId: string | null;
  context: Record<string, unknown>;
};

const logActions = vi.fn(
  (_service: unknown, _actor: unknown, _rows: AuditRow[]) => Promise.resolve()
);
const logAction = vi.fn((_args: unknown) => Promise.resolve());
vi.mock('@/lib/audit/log-action', () => ({
  logActions: (service: unknown, actor: unknown, rows: AuditRow[]) =>
    logActions(service, actor, rows),
  logAction: (args: unknown) => logAction(args),
}));

let rollupFails = false;
const writeDailyBatch = vi.fn((_service: unknown, _inputs: unknown[]) =>
  rollupFails
    ? Promise.reject(new RollupError('recompute failed'))
    : Promise.resolve(new Map())
);
class RollupError extends Error {}
vi.mock('@/lib/attendance/mutations', () => ({
  get MarksWrittenRollupFailedError() {
    return RollupError;
  },
  writeDailyBatch: (service: unknown, inputs: unknown[]) =>
    writeDailyBatch(service, inputs),
}));

vi.mock('@/lib/attendance/school-days', () => ({
  expandSchoolDays: vi.fn(() =>
    Promise.resolve([
      { date: '2026-09-02', termId: 'term-3' },
      { date: '2026-09-03', termId: 'term-3' },
    ])
  ),
}));

vi.mock('@/lib/dates', () => ({ sgToday: () => '2026-09-03' }));

const DECLARATION = {
  id: 'decl-1',
  declaration_type: 'absence',
  section_student_id: 'ss-1',
  section_id: 'sec-1',
  academic_year_id: 'ay-1',
  start_date: '2026-09-02',
  end_date: '2026-09-03',
  status: 'approved',
};

function chain(result: unknown) {
  const obj: Record<string, unknown> = {};
  const self = () => obj;
  Object.assign(obj, {
    select: self,
    eq: self,
    in: self,
    order: self,
    maybeSingle: () => Promise.resolve(result),
    then: (resolve: (v: unknown) => unknown) => resolve(result),
  });
  return obj;
}

function buildService(): SupabaseClient {
  return {
    from(table: string) {
      if (table === 'student_declarations') {
        const obj = chain({ data: DECLARATION, error: null });
        obj.update = () => ({ eq: () => Promise.resolve({ error: null }) });
        return obj;
      }
      if (table === 'sections') {
        return chain({
          data: { name: 'Diligence', levels: { code: 'P4' } },
          error: null,
        });
      }
      if (table === 'section_students') {
        return chain({
          data: {
            student: {
              student_number: 'H250123',
              first_name: 'Ana',
              last_name: 'Reyes',
            },
          },
          error: null,
        });
      }
      if (table === 'attendance_daily') {
        return chain({
          data: [
            {
              date: '2026-09-02',
              status: 'A',
              ex_note: 'teacher note',
              recorded_at: '2026-09-02T01:00:00Z',
            },
          ],
          error: null,
        });
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;
}

const APPROVER = { id: 'u-oic', email: 'oic@hfse.test', role: 'school_admin' };

beforeEach(() => {
  vi.clearAllMocks();
  rollupFails = false;
});

describe('writeRegisterForDeclaration — audit', () => {
  it('logs one row per excused day, as the approver, naming the child', async () => {
    const { writeRegisterForDeclaration } =
      await import('@/lib/declarations/register');
    const result = await writeRegisterForDeclaration(
      buildService(),
      'decl-1',
      APPROVER
    );

    expect(result).toMatchObject({ ok: true, written: 2 });
    expect(logActions).toHaveBeenCalledTimes(1);
    const [, actor, rows] = logActions.mock.calls[0];
    expect(actor).toEqual(APPROVER);
    expect(rows).toHaveLength(2);

    // A day before today is a correction; today is an update — the same rule
    // the daily route and the trigger use.
    expect(rows.map((r) => r.action)).toEqual([
      'attendance.daily.correct',
      'attendance.daily.update',
    ]);
    expect(rows[0].context).toMatchObject({
      section_student_id: 'ss-1',
      section_id: 'sec-1',
      section_name: 'Diligence',
      student_number: 'H250123',
      student_name: 'Ana Reyes',
      term_id: 'term-3',
      date: '2026-09-02',
      status: 'EX',
      prior_status: 'A',
      ex_reason: 'mc',
      ex_note_changed: true,
      source: 'declaration_approval',
      declaration_id: 'decl-1',
      declaration_type: 'absence',
    });
    // No prior mark on the second day, so no transition to claim.
    expect('prior_status' in rows[1].context).toBe(false);
    expect(JSON.stringify(rows)).not.toContain('teacher note');
  });

  it('still logs the marks when a rollup after them fails', async () => {
    rollupFails = true;
    const { writeRegisterForDeclaration } =
      await import('@/lib/declarations/register');
    const result = await writeRegisterForDeclaration(
      buildService(),
      'decl-1',
      APPROVER
    );

    expect(result.ok).toBe(false);
    expect(logActions).toHaveBeenCalledTimes(1);
    const rows = logActions.mock.calls[0][2];
    expect(rows).toHaveLength(2);
    expect(rows[0].context).toMatchObject({
      partial: true,
      failed_step: 'rollup',
    });
  });

  it('logs with no person when the repair script passes a null actor', async () => {
    const { writeRegisterForDeclaration } =
      await import('@/lib/declarations/register');
    await writeRegisterForDeclaration(buildService(), 'decl-1', null);

    expect(logActions).not.toHaveBeenCalled();
    expect(logAction).toHaveBeenCalledTimes(2);
    expect(logAction.mock.calls[0][0]).toMatchObject({
      actor: { id: null, email: null, role: null },
      action: 'attendance.daily.correct',
    });
  });
});
