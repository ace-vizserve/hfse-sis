import { NextResponse, type NextRequest } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { logAction } from '@/lib/audit/log-action';
import { createServiceClient } from '@/lib/supabase/service';
import { EvaluationTermConfigSchema } from '@/lib/schemas/evaluation';

// PUT /api/evaluation/terms/[termId]/config — open or close the evaluation
// window for a term. Registrar / school_admin / admin / superadmin only.
// Upserts `evaluation_terms` (one row per term, unique key on term_id).
//
// Opening does NOT require a virtue theme — that's a separate soft gate
// in the UI. Closing sets `is_open=false` but preserves `opened_at` history.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ termId: string }> },
) {
  const auth = await requireRole(['registrar', 'school_admin', 'admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const { termId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = EvaluationTermConfigSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { isOpen } = parsed.data;

  const service = createServiceClient();

  const { data: before } = await service
    .from('evaluation_terms')
    .select('id, is_open, opened_at')
    .eq('term_id', termId)
    .maybeSingle();

  const nowIso = new Date().toISOString();
  const row = {
    term_id: termId,
    is_open: isOpen,
    // Stamp opened_at on the first open; keep the historical first-open
    // timestamp across re-opens so we can audit when the term was FIRST
    // exposed to teachers.
    opened_at:
      isOpen && !before?.opened_at
        ? nowIso
        : before?.opened_at ?? null,
    opened_by: isOpen && !before?.opened_at ? auth.user.id : undefined,
    updated_at: nowIso,
  };

  const { data: saved, error } = await service
    .from('evaluation_terms')
    .upsert(row, { onConflict: 'term_id' })
    .select('id')
    .single();
  if (error || !saved) {
    return NextResponse.json({ error: error?.message ?? 'save failed' }, { status: 500 });
  }

  // Only emit an audit row when the state actually flipped.
  if ((before?.is_open ?? false) !== isOpen) {
    await logAction({
      service,
      actor: { id: auth.user.id, email: auth.user.email ?? null },
      action: isOpen ? 'evaluation.term.open' : 'evaluation.term.close',
      entityType: 'evaluation_term',
      entityId: saved.id,
      context: { term_id: termId, was_open: before?.is_open ?? false, is_open: isOpen },
    });
  }

  return NextResponse.json({ ok: true, id: saved.id, isOpen });
}
