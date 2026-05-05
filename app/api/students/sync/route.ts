import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/require-role';
import { createServiceClient } from '@/lib/supabase/service';
import { fetchAdmissionsRoster } from '@/lib/supabase/admissions';
import { loadGradingSnapshot } from '@/lib/sync/snapshot';
import { buildSyncPlan } from '@/lib/sync/students';
import { logAction } from '@/lib/audit/log-action';
import { requireCurrentAyCode } from '@/lib/academic-year';

// Commit endpoint â€” applies the sync plan to the grading DB.
// Hard rules:
//   * index_number is append-only (never reassigned) â€” enforced by the planner
//     always using max(index)+1 per section.
//   * Withdrawn students keep their row; enrollment_status flips to 'withdrawn'.
//   * Never delete; every mutation goes through update/insert only.
export async function POST() {
  const auth = await requireRole(['registrar', 'school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const service = createServiceClient();

  try {
    const ayCode = await requireCurrentAyCode(service);
    const [snapshot, rows] = await Promise.all([
      loadGradingSnapshot(service, ayCode),
      fetchAdmissionsRoster(ayCode),
    ]);
    const plan = buildSyncPlan(rows, snapshot);

    // 1) Student upserts â€” split by insert vs update for clarity.
    const inserts = plan.student_upserts.filter(u => u.kind === 'insert');
    const updates = plan.student_upserts.filter(u => u.kind === 'update');

    if (inserts.length > 0) {
      const { error } = await service.from('students').insert(
        inserts.map(u => ({
          student_number: u.student_number,
          last_name: u.last_name,
          first_name: u.first_name,
          middle_name: u.middle_name,
        })),
      );
      if (error) throw new Error(`student insert failed: ${error.message}`);
    }
    for (const u of updates) {
      const { error } = await service
        .from('students')
        .update({
          last_name: u.last_name,
          first_name: u.first_name,
          middle_name: u.middle_name,
          updated_at: new Date().toISOString(),
        })
        .eq('id', u.existing_id!);
      if (error) throw new Error(`student update failed: ${error.message}`);
    }

    // 2) Resolve student_number â†’ student_id for enrollment inserts
    //    (newly inserted students need their freshly generated UUIDs).
    const needed = new Set(plan.enrollment_inserts.map(e => e.student_number));
    let idByNumber = new Map<string, string>();
    if (needed.size > 0) {
      const { data, error } = await service
        .from('students')
        .select('id, student_number')
        .in('student_number', Array.from(needed));
      if (error) throw new Error(`student id lookup failed: ${error.message}`);
      idByNumber = new Map((data ?? []).map(r => [r.student_number as string, r.id as string]));
    }

    // 3) Enrollment inserts
    if (plan.enrollment_inserts.length > 0) {
      const payload = plan.enrollment_inserts.map(e => {
        const student_id = idByNumber.get(e.student_number);
        if (!student_id) {
          throw new Error(`missing student_id for ${e.student_number}`);
        }
        return {
          section_id: e.section_id,
          student_id,
          index_number: e.index_number,
          enrollment_status: 'active' as const,
          enrollment_date: new Date().toISOString().slice(0, 10),
        };
      });
      const { error } = await service.from('section_students').insert(payload);
      if (error) throw new Error(`enrollment insert failed: ${error.message}`);
    }

    // 4) Status changes (withdraw + reactivate)
    for (const change of plan.enrollment_status_changes) {
      const patch: Record<string, unknown> = { enrollment_status: change.to };
      if (change.to === 'withdrawn') {
        patch.withdrawal_date = new Date().toISOString().slice(0, 10);
      }
      const { error } = await service
        .from('section_students')
        .update(patch)
        .eq('id', change.enrollment_id);
      if (error) throw new Error(`enrollment status update failed: ${error.message}`);
    }

    await logAction({
      service,
      actor: { id: auth.user.id, email: auth.user.email ?? null },
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
