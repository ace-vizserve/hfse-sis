import { NextResponse, type NextRequest } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { logAction } from '@/lib/audit/log-action';
import { createServiceClient } from '@/lib/supabase/service';
import { ChecklistItemCreateSchema } from '@/lib/schemas/evaluation-checklist';

// POST /api/evaluation/checklist-items — superadmin-only registration of a
// per-(term × subject × level) checklist topic. Surfaces on the SIS Admin
// `/sis/admin/evaluation-checklists` editor.
export async function POST(request: NextRequest) {
  const auth = await requireRole(['superadmin']);
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = ChecklistItemCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { termId, subjectId, levelId, itemText, sortOrder } = parsed.data;

  const service = createServiceClient();

  // Default sort_order = max existing + 10 so inserts land at the end.
  let nextSort = sortOrder ?? 0;
  if (sortOrder === undefined) {
    const { data: maxRow } = await service
      .from('evaluation_checklist_items')
      .select('sort_order')
      .eq('term_id', termId)
      .eq('subject_id', subjectId)
      .eq('level_id', levelId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();
    nextSort = (maxRow?.sort_order ?? -10) + 10;
  }

  const { data: inserted, error } = await service
    .from('evaluation_checklist_items')
    .insert({
      term_id: termId,
      subject_id: subjectId,
      level_id: levelId,
      item_text: itemText,
      sort_order: nextSort,
      created_by: auth.user.id,
    })
    .select('id, sort_order')
    .single();
  if (error || !inserted) {
    return NextResponse.json({ error: error?.message ?? 'create failed' }, { status: 500 });
  }

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'evaluation.checklist_item.create',
    entityType: 'evaluation_checklist_item',
    entityId: inserted.id,
    context: { term_id: termId, subject_id: subjectId, level_id: levelId, item_text: itemText },
  });

  return NextResponse.json({ ok: true, id: inserted.id, sortOrder: inserted.sort_order });
}
