import { NextResponse, type NextRequest } from 'next/server';

import { requireCapability } from '@/lib/auth/require-capability';
import { logAction } from '@/lib/audit/log-action';
import { createServiceClient } from '@/lib/supabase/service';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';

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
