import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/require-role';
import { createServiceClient } from '@/lib/supabase/service';
import { sgToday } from '@/lib/dates';
import { fetchAdmissionsRoster } from '@/lib/supabase/admissions';
import { loadGradingSnapshot } from '@/lib/sync/snapshot';
import { buildSyncPlan, describeSyncPlanChanges } from '@/lib/sync/students';
import { logAction } from '@/lib/audit/log-action';
import { requireCurrentAyCode } from '@/lib/academic-year';
import { invalidateAllOperationalDrills } from '@/lib/cache/invalidate-drill-tags';

// Commit endpoint — applies the sync plan to the grading DB.
// Hard rules:
//   * index_number is append-only (never reassigned) — enforced by the planner
//     always using max(index)+1 per section.
//   * Withdrawn students keep their row; enrollment_status flips to 'withdrawn'.
//   * Never delete; every mutation goes through update/insert only.
//
// AUDIT: one `student.sync` row per run, and it names every student the run
// touched (`changes`: student number, name, class, index number, what
// changed). Until 2026-09-17 it carried only totals, so "42 withdrawn" could
// not be traced to a single child. When a step fails part-way the row is still
// written, with `partial: true` and the steps that HAD committed — the writes
// below are separate statements, so a failure leaves the earlier ones in place.
export async function POST(request: Request) {
  const auth = await requireRole([
    'admissions',
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const service = createServiceClient();
  const actor = {
    id: auth.user.id,
    email: auth.user.email ?? null,
    role: auth.role,
  };

  // Steps that committed, in order — read by the failure path.
  const committed: string[] = [];
  let ayCodeForLog: string | null = null;
  let changesForLog: ReturnType<typeof describeSyncPlanChanges> = [];

  try {
    const body = await request.json().catch(() => ({}));
    const ayCode: string =
      body?.ayCode ?? (await requireCurrentAyCode(service));
    ayCodeForLog = ayCode;
    const [snapshot, rows] = await Promise.all([
      loadGradingSnapshot(service, ayCode),
      fetchAdmissionsRoster(ayCode),
    ]);
    const plan = buildSyncPlan(rows, snapshot);
    changesForLog = describeSyncPlanChanges(plan, snapshot);

    // 1) Student upserts — split by insert vs update for clarity.
    const inserts = plan.student_upserts.filter((u) => u.kind === 'insert');
    const updates = plan.student_upserts.filter((u) => u.kind === 'update');

    // Every id an enrolment insert can need is already knowable without a
    // second read: a student the planner did NOT plan to insert was in the
    // snapshot (that is exactly how the planner decided), and one it DID plan
    // to insert hands back its generated uuid on the insert itself. Seed from
    // the snapshot, then fill in the fresh ones below.
    const idByNumber = new Map<string, string>(
      snapshot.students.map((s) => [s.student_number, s.id])
    );

    const now = new Date().toISOString();
    if (inserts.length > 0) {
      const { data, error } = await service
        .from('students')
        .insert(
          inserts.map((u) => ({
            student_number: u.student_number,
            last_name: u.last_name,
            first_name: u.first_name,
            middle_name: u.middle_name,
          }))
        )
        .select('id, student_number');
      if (error) throw new SyncStepError('student_insert', error.message);
      for (const r of (data ?? []) as Array<{
        id: string;
        student_number: string;
      }>) {
        idByNumber.set(r.student_number, r.id);
      }
      committed.push('student_insert');
    }
    if (updates.length > 0) {
      const { error } = await service.from('students').upsert(
        updates.map((u) => ({
          id: u.existing_id!,
          last_name: u.last_name,
          first_name: u.first_name,
          middle_name: u.middle_name,
          updated_at: now,
        })),
        { onConflict: 'id' }
      );
      if (error) throw new SyncStepError('student_update', error.message);
      committed.push('student_update');
    }

    // 2) Enrollment inserts. `idByNumber` was settled above — the re-select
    //    that used to sit here asked the database to tell us ids it had just
    //    handed back on the insert. The `missing student_id` guard below still
    //    stands: it now fails on a planner/snapshot disagreement rather than on
    //    a read that raced the write.
    if (plan.enrollment_inserts.length > 0) {
      const payload = plan.enrollment_inserts.map((e) => {
        const student_id = idByNumber.get(e.student_number);
        if (!student_id) {
          throw new SyncStepError(
            'enrollment_insert',
            `missing student_id for ${e.student_number}`
          );
        }
        return {
          section_id: e.section_id,
          student_id,
          index_number: e.index_number,
          enrollment_status: 'active' as const,
          enrollment_date: sgToday(),
          // Stamp the admissions key (twin of the syncOneStudent fix) so
          // enrolee_number-keyed lookups resolve bulk-synced rows too (KD #135).
          enrolee_number: e.enrolee_number,
        };
      });
      const { error } = await service.from('section_students').insert(payload);
      if (error) throw new SyncStepError('enrollment_insert', error.message);
      committed.push('enrollment_insert');
    }

    // 3) Status changes — batch by change type to avoid N+1 updates.
    const withdrawals = plan.enrollment_status_changes.filter(
      (c) => c.to === 'withdrawn'
    );
    const reactivations = plan.enrollment_status_changes.filter(
      (c) => c.to !== 'withdrawn'
    );

    // Sequential rather than parallel so the failure path can say exactly
    // which of the two committed.
    if (withdrawals.length > 0) {
      const { error } = await service.from('section_students').upsert(
        withdrawals.map((c) => ({
          id: c.enrollment_id,
          enrollment_status: 'withdrawn',
          // 🔴 NOT TODAY. This used to stamp `sgToday()`, which recorded the
          // day a sync ran as the child's last day at school (migration 163).
          // A sync only knows the student left the admissions roster — not
          // when they stopped attending — so the date is left blank for the
          // registrar to enter from the class roster.
          withdrawal_date: null,
          withdrawal_approved_date: null,
        })),
        { onConflict: 'id' }
      );
      if (error) throw new SyncStepError('enrollment_withdraw', error.message);
      committed.push('enrollment_withdraw');
    }
    if (reactivations.length > 0) {
      const { error } = await service.from('section_students').upsert(
        reactivations.map((c) => ({
          id: c.enrollment_id,
          enrollment_status: c.to,
          // A returning student's row must not keep the previous spell's
          // dates — a later withdrawal reads them as its own. The withdrawal
          // that set them has its own audit row.
          withdrawal_date: null,
          withdrawal_approved_date: null,
        })),
        { onConflict: 'id' }
      );
      if (error)
        throw new SyncStepError('enrollment_reactivate', error.message);
      committed.push('enrollment_reactivate');
    }

    await logAction({
      service,
      actor,
      action: 'student.sync',
      entityType: 'sync_batch',
      entityId: null,
      context: {
        ay_code: ayCode,
        trigger: 'bulk',
        added: plan.stats.students_to_add,
        updated: plan.stats.students_to_update,
        enrolled: plan.stats.enrollments_to_add,
        withdrawn: plan.stats.enrollments_to_withdraw,
        reactivated: plan.stats.enrollments_to_reactivate,
        errors: plan.errors.length,
        changes: changesForLog,
        skipped: plan.errors,
      },
    });

    // Sync may have added/withdrawn/reactivated students, all of which
    // affect every operational module's roster-based drill rollups.
    if (
      plan.stats.students_to_add +
        plan.stats.students_to_update +
        plan.stats.enrollments_to_add +
        plan.stats.enrollments_to_withdraw +
        plan.stats.enrollments_to_reactivate >
      0
    ) {
      invalidateAllOperationalDrills(ayCode);
    }

    return NextResponse.json({
      success: true,
      ay_code: ayCode,
      summary: {
        added: plan.stats.students_to_add,
        updated: plan.stats.students_to_update,
        enrolled: plan.stats.enrollments_to_add,
        withdrawn: plan.stats.enrollments_to_withdraw,
        reactivated: plan.stats.enrollments_to_reactivate,
      },
      stats: plan.stats,
      errors: plan.errors,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown error';
    const failedStep = e instanceof SyncStepError ? e.step : 'plan';
    // Anything already committed stays committed — record it, so the log does
    // not show a clean run that never happened, or nothing at all.
    if (committed.length > 0 && ayCodeForLog) {
      invalidateAllOperationalDrills(ayCodeForLog);
    }
    if (ayCodeForLog) {
      await logAction({
        service,
        actor,
        action: 'student.sync',
        entityType: 'sync_batch',
        entityId: null,
        context: {
          ay_code: ayCodeForLog,
          trigger: 'bulk',
          partial: committed.length > 0,
          committed,
          failed_step: failedStep,
          error: message,
          // What the run PLANNED. Only the steps listed in `committed` landed.
          changes: changesForLog,
        },
      });
    }
    return NextResponse.json(
      { error: message, committed, failed_step: failedStep },
      { status: 500 }
    );
  }
}

class SyncStepError extends Error {
  readonly step: string;
  constructor(step: string, message: string) {
    super(`${step.replace(/_/g, ' ')} failed: ${message}`);
    this.step = step;
  }
}
