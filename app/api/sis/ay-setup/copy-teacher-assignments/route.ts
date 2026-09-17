import { NextResponse, type NextRequest } from 'next/server';

import { requireCapability } from '@/lib/auth/require-capability';
import { classLabel } from '@/lib/audit/assignment-context';
import { logAction } from '@/lib/audit/log-action';
import { createServiceClient } from '@/lib/supabase/service';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';

type One<T> = T | T[] | null;
const one = <T>(v: One<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

// Every assignment in the target year, with the labels an audit row needs.
// Returns null on a read error.
async function readTargetAssignments(
  service: ReturnType<typeof createServiceClient>,
  ayId: string
): Promise<Array<{
  id: string;
  teacher_user_id: string;
  role: string;
  section_id: string;
  class_label: string | null;
  subject_code: string | null;
}> | null> {
  const { data, error } = await service
    .from('teacher_assignments')
    .select(
      `id, teacher_user_id, role, section_id,
       section:sections!inner(academic_year_id, name, level:levels(code)),
       subject:subjects(code)`
    )
    .eq('section.academic_year_id', ayId);
  if (error) return null;
  return (
    (data ?? []) as unknown as Array<{
      id: string;
      teacher_user_id: string;
      role: string;
      section_id: string;
      section: One<{
        name: string | null;
        level: One<{ code: string | null }>;
      }>;
      // CODE, not name — identity, unaffected by a per-year rename.
      subject: One<{ code: string | null }>;
    }>
  ).map((r) => {
    const section = one(r.section);
    return {
      id: r.id,
      teacher_user_id: r.teacher_user_id,
      role: r.role,
      section_id: r.section_id,
      class_label: classLabel(section?.name, one(section?.level ?? null)?.code),
      subject_code: one(r.subject)?.code ?? null,
    };
  });
}

// POST /api/sis/ay-setup/copy-teacher-assignments
// Body: { sourceAyCode, targetAyCode }
//
// Delegates to the `copy_teacher_assignments` RPC from migration 017.
// Returns the per-bucket counts verbatim so the UI can show a "N copied,
// M skipped (no section), K already existed" summary.
export async function POST(request: NextRequest) {
  // academic_year.edit, NOT staff.edit_assignments: this is the AY-rollover step
  // that carries last year's assignments forward, and it admits school_admin +
  // superadmin only, whereas assigning a teacher to a class day-to-day also
  // admits the academic coordinator. Mapping it to the staff capability would
  // have widened it.
  const auth = await requireCapability('academic_year.edit');
  if ('error' in auth) return auth.error;

  const body = (await request.json().catch(() => null)) as {
    sourceAyCode?: string;
    targetAyCode?: string;
  } | null;
  const sourceAyCode = body?.sourceAyCode?.trim().toUpperCase();
  const targetAyCode = body?.targetAyCode?.trim().toUpperCase();
  if (!sourceAyCode || !targetAyCode) {
    return NextResponse.json(
      { error: 'sourceAyCode and targetAyCode are required' },
      { status: 400 }
    );
  }
  if (sourceAyCode === targetAyCode) {
    return NextResponse.json(
      { error: 'Source and target AY must differ' },
      { status: 400 }
    );
  }
  if (!/^AY\d{4}$/.test(sourceAyCode) || !/^AY\d{4}$/.test(targetAyCode)) {
    return NextResponse.json(
      { error: 'AY codes must match AY####' },
      { status: 400 }
    );
  }

  const service = createServiceClient();

  // Resolve AY codes â†’ ids.
  const { data: rows, error: lookupErr } = await service
    .from('academic_years')
    .select('id, ay_code')
    .in('ay_code', [sourceAyCode, targetAyCode]);
  if (lookupErr)
    return NextResponse.json({ error: lookupErr.message }, { status: 500 });

  const sourceRow = (rows ?? []).find(
    (r) => (r as { ay_code: string }).ay_code === sourceAyCode
  ) as { id: string } | undefined;
  const targetRow = (rows ?? []).find(
    (r) => (r as { ay_code: string }).ay_code === targetAyCode
  ) as { id: string } | undefined;
  if (!sourceRow || !targetRow) {
    return NextResponse.json({ error: 'Unknown AY code' }, { status: 404 });
  }

  // The RPC returns counts only. To say WHICH assignments it created, the
  // target year's assignment ids are read before and after and diffed. A
  // failed "before" read only costs the audit row its list, never the copy.
  const beforeRes = await readTargetAssignments(service, targetRow.id);
  const beforeIds = beforeRes ? new Set(beforeRes.map((r) => r.id)) : null;

  const { data, error } = await service.rpc('copy_teacher_assignments', {
    p_source_ay: sourceRow.id,
    p_target_ay: targetRow.id,
  });
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  const result = (data ?? {}) as {
    copied?: number;
    skipped_no_section?: number;
    skipped_already_existed?: number;
    source_total?: number;
  };

  let created: Array<Record<string, unknown>> | null = null;
  if (beforeIds) {
    const afterRes = await readTargetAssignments(service, targetRow.id);
    if (afterRes) {
      const nameById = await import('@/lib/auth/staff-list')
        .then(async (m) => new Map(await m.getStaffDisplayNameById()))
        .catch(() => new Map<string, string>());
      created = afterRes
        .filter((r) => !beforeIds.has(r.id))
        .map((r) => ({
          assignment_id: r.id,
          teacher_user_id: r.teacher_user_id,
          teacher_name: nameById.get(r.teacher_user_id) ?? null,
          role: r.role,
          section_id: r.section_id,
          class_label: r.class_label,
          subject_code: r.subject_code,
        }));
    }
  }

  await logAction({
    service,
    actor: {
      id: auth.user.id,
      email: auth.user.email ?? null,
      role: auth.role,
    },
    action: 'ay.copy_teacher_assignments',
    entityType: 'academic_year',
    entityId: targetRow.id,
    context: {
      source_ay: sourceAyCode,
      target_ay: targetAyCode,
      ...result,
      ...(created
        ? {
            created_assignment_ids: created.map((c) => c.assignment_id),
            created_assignments: created,
          }
        : { created_assignments_unavailable: true }),
    },
  });

  // Bulk-copied assignments scope the target AY's grading-sheet lists,
  // evaluation sections, and attendance section drills — bust those tags so the
  // newly-assigned teachers show up immediately (not after the 60s TTL).
  invalidateDrillTags('markbook', targetAyCode);
  invalidateDrillTags('evaluation', targetAyCode);
  invalidateDrillTags('attendance', targetAyCode);

  return NextResponse.json({ ok: true, ...result });
}
