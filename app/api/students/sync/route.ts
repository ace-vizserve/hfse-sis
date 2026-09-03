import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/require-role';
import { createServiceClient } from '@/lib/supabase/service';
import { sgToday } from '@/lib/dates';
import { fetchAdmissionsRoster } from '@/lib/supabase/admissions';
import { loadGradingSnapshot } from '@/lib/sync/snapshot';
import { buildSyncPlan } from '@/lib/sync/students';
import { logAction } from '@/lib/audit/log-action';
import { requireCurrentAyCode } from '@/lib/academic-year';
import { invalidateAllOperationalDrills } from '@/lib/cache/invalidate-drill-tags';

// Commit endpoint â€” applies the sync plan to the grading DB.
// Hard rules:
//   * index_number is append-only (never reassigned) â€” enforced by the planner
//     always using max(index)+1 per section.
//   * Withdrawn students keep their row; enrollment_status flips to 'withdrawn'.
//   * Never delete; every mutation goes through update/insert only.
export async function POST(request: Request) {
  const auth = await requireRole([
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const service = createServiceClient();

  try {
    const body = await request.json().catch(() => ({}));
    const ayCode: string =
      body?.ayCode ?? (await requireCurrentAyCode(service));
    const [snapshot, rows] = await Promise.all([
      loadGradingSnapshot(service, ayCode),
      fetchAdmissionsRoster(ayCode),
    ]);
    const plan = buildSyncPlan(rows, snapshot);

    // 1) Student upserts â€” split by insert vs update for clarity.
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
      if (error) throw new Error(`student insert failed: ${error.message}`);
      for (const r of (data ?? []) as Array<{
        id: string;
        student_number: string;
      }>) {
        idByNumber.set(r.student_number, r.id);
      }
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
      if (error) throw new Error(`student update failed: ${error.message}`);
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
          throw new Error(`missing student_id for ${e.student_number}`);
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
      if (error) throw new Error(`enrollment insert failed: ${error.message}`);
    }

    // 3) Status changes — batch by change type to avoid N+1 updates.
    const withdrawals = plan.enrollment_status_changes.filter(
      (c) => c.to === 'withdrawn'
    );
    const reactivations = plan.enrollment_status_changes.filter(
      (c) => c.to !== 'withdrawn'
    );
    const today = sgToday();

    const statusBatches: Promise<void>[] = [];
    if (withdrawals.length > 0) {
      statusBatches.push(
        (async () => {
          const { error } = await service.from('section_students').upsert(
            withdrawals.map((c) => ({
              id: c.enrollment_id,
              enrollment_status: 'withdrawn',
              withdrawal_date: today,
            })),
            { onConflict: 'id' }
          );
          if (error)
            throw new Error(`enrollment withdrawal failed: ${error.message}`);
        })()
      );
    }
    if (reactivations.length > 0) {
      statusBatches.push(
        (async () => {
          const { error } = await service.from('section_students').upsert(
            reactivations.map((c) => ({
              id: c.enrollment_id,
              enrollment_status: c.to,
            })),
            { onConflict: 'id' }
          );
          if (error)
            throw new Error(`enrollment reactivation failed: ${error.message}`);
        })()
      );
    }
    await Promise.all(statusBatches);

    await logAction({
      service,
      actor: {
        id: auth.user.id,
        email: auth.user.email ?? null,
        role: auth.role,
      },
      action: 'student.sync',
      entityType: 'sync_batch',
      entityId: null,
      context: {
        ay_code: ayCode,
        added: plan.stats.students_to_add,
        updated: plan.stats.students_to_update,
        enrolled: plan.stats.enrollments_to_add,
        withdrawn: plan.stats.enrollments_to_withdraw,
        reactivated: plan.stats.enrollments_to_reactivate,
        errors: plan.errors.length,
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
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
