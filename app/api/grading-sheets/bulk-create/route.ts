import { NextResponse, type NextRequest } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { logAction } from '@/lib/audit/log-action';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/grading-sheets/bulk-create
// Body: either { ay_id: uuid } or { section_id: uuid } (exactly one).
//
// Delegates to the matching RPC from migration 016. Idempotent â€” safe to
// re-click after manual additions; existing sheets are untouched.
//
// Registrar+ only. No class_type gate / no subject allowlist â€” bulk create
// creates every sheet the `subject_configs` matrix says should exist.
export async function POST(request: NextRequest) {
  const auth = await requireRole(['registrar', 'school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const body = (await request.json().catch(() => null)) as
    | { ay_id?: string; section_id?: string }
    | null;

  const ayId = body?.ay_id ?? null;
  const sectionId = body?.section_id ?? null;

  const hasAy = typeof ayId === 'string' && ayId.length > 0;
  const hasSection = typeof sectionId === 'string' && sectionId.length > 0;

  if (hasAy === hasSection) {
    return NextResponse.json(
      { error: 'Provide exactly one of ay_id or section_id' },
      { status: 400 },
    );
  }

  const service = createServiceClient();

  const rpcName = hasAy ? 'create_grading_sheets_for_ay' : 'create_grading_sheets_for_section';
  const rpcArgs = hasAy ? { p_ay_id: ayId } : { p_section_id: sectionId };

  const { data, error } = await service.rpc(rpcName, rpcArgs);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const r = (typeof data === 'object' && data ? data : {}) as Record<string, unknown>;
  const inserted = Number(r.inserted ?? 0);
  const repairedUnconfigured = Number(r.repaired_unconfigured_sheets ?? 0);
  const resizedEntries = Number(r.resized_entry_arrays ?? 0);
  const sheetsSeeded = Number(r.sheets_seeded ?? 0);

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'sheet.bulk_create',
    entityType: 'grading_sheet',
    entityId: hasAy ? ayId : sectionId,
    context: {
      scope: hasAy ? 'ay' : 'section',
      ay_id: ayId,
      section_id: sectionId,
      inserted,
      repaired_unconfigured_sheets: repairedUnconfigured,
      resized_entry_arrays: resizedEntries,
      sheets_seeded: sheetsSeeded,
    },
  });

  return NextResponse.json({
    ok: true,
    inserted,
    repaired_unconfigured_sheets: repairedUnconfigured,
    resized_entry_arrays: resizedEntries,
    sheets_seeded: sheetsSeeded,
  });
}
