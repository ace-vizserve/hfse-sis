import { revalidateTag } from 'next/cache';
import { NextResponse, type NextRequest } from 'next/server';
import { requireRole } from '@/lib/auth/require-role';
import { createServiceClient } from '@/lib/supabase/service';
import { logAction } from '@/lib/audit/log-action';
import { loadOneSheetAuditLabels } from '@/lib/grading/sheet-audit-labels';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { SHEET_TYPES, type SheetType } from '@/lib/grading/term4-framework';

// PATCH /api/grading-sheets/[id]/sheet-type   body: { sheet_type }
//
// Switches a grading sheet between Standard and Term 4 framework (KD #230
// update, Mr Ace 2026-10-08). The whole switch is one database transaction
// (switch_grading_sheet_type, migration 185): it refuses a locked sheet, a
// framework sheet outside Term 4 or for a subject without a number grade,
// reshapes the sheet and clears every score on it. What it cleared comes back
// and goes into the `sheet.switch_type` audit row, so nothing is lost.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole([
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const { id: sheetId } = await params;
  const body = (await request.json().catch(() => null)) as {
    sheet_type?: unknown;
  } | null;
  const sheetType = body?.sheet_type;
  if (
    typeof sheetType !== 'string' ||
    !(SHEET_TYPES as readonly string[]).includes(sheetType)
  ) {
    return NextResponse.json({ error: 'Unknown sheet type' }, { status: 400 });
  }

  const service = createServiceClient();

  const { data: result, error: rpcErr } = await service.rpc(
    'switch_grading_sheet_type',
    { p_sheet_id: sheetId, p_sheet_type: sheetType }
  );
  if (rpcErr) {
    return NextResponse.json(
      { error: rpcErr.message },
      { status: rpcErr.code === 'HFT4F' ? 400 : 500 }
    );
  }
  const switched = (result ?? {}) as {
    cleared?: unknown[];
    cleared_count?: number;
    slot_labels?: unknown;
    from?: SheetType;
    to?: SheetType;
  };

  const [labels, { data: sheet }] = await Promise.all([
    loadOneSheetAuditLabels(service, sheetId),
    service
      .from('grading_sheets')
      .select(
        'term_id, section_id, subject_id, section:sections(academic_year_id)'
      )
      .eq('id', sheetId)
      .maybeSingle(),
  ]);
  const section = (
    Array.isArray(sheet?.section) ? sheet?.section[0] : sheet?.section
  ) as { academic_year_id: string } | null | undefined;
  let ayCode: string | null = null;
  if (section?.academic_year_id) {
    const { data: ayRow } = await service
      .from('academic_years')
      .select('ay_code')
      .eq('id', section.academic_year_id)
      .maybeSingle();
    ayCode = (ayRow as { ay_code: string } | null)?.ay_code ?? null;
  }

  await logAction({
    service,
    actor: {
      id: auth.user.id,
      email: auth.user.email ?? null,
      role: auth.role,
    },
    action: 'sheet.switch_type',
    entityType: 'grading_sheet',
    entityId: sheetId,
    context: {
      ...labels,
      term_id: sheet?.term_id ?? null,
      section_id: sheet?.section_id ?? null,
      subject_id: sheet?.subject_id ?? null,
      academic_year_id: section?.academic_year_id ?? null,
      ay_code: ayCode,
      from: switched.from ?? null,
      to: switched.to ?? sheetType,
      cleared_count: switched.cleared_count ?? 0,
      cleared: switched.cleared ?? [],
      // The activity labels described the assessments that were cleared.
      slot_labels: switched.slot_labels ?? null,
    },
  });

  // The same caches removing a sheet busts: the markbook drills, and SIS —
  // subject setup lists each class's sheets.
  if (ayCode) {
    invalidateDrillTags('markbook', ayCode);
    revalidateTag(`sis:${ayCode}`, 'max');
  }

  return NextResponse.json({
    ok: true,
    from: switched.from ?? null,
    to: switched.to ?? sheetType,
    cleared_count: switched.cleared_count ?? 0,
  });
}
