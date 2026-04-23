import { NextResponse, type NextRequest } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { logAction } from '@/lib/audit/log-action';
import { createServiceClient } from '@/lib/supabase/service';
import { ChecklistItemUpdateSchema } from '@/lib/schemas/evaluation-checklist';

// PATCH /api/evaluation/checklist-items/[id] — rename or reorder.
// Superadmin only. Audit records before/after for whichever field changed.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(['superadmin']);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = ChecklistItemUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { itemText, sortOrder } = parsed.data;

  const service = createServiceClient();

  const { data: before, error: loadErr } = await service
    .from('evaluation_checklist_items')
    .select('id, term_id, subject_id, level_id, item_text, sort_order')
    .eq('id', id)
    .maybeSingle();
  if (loadErr) return NextResponse.json({ error: loadErr.message }, { status: 500 });
  if (!before) return NextResponse.json({ error: 'item not found' }, { status: 404 });

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (itemText !== undefined) updates.item_text = itemText;
  if (sortOrder !== undefined) updates.sort_order = sortOrder;

  const { error: updateErr } = await service
    .from('evaluation_checklist_items')
    .update(updates)
    .eq('id', id);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'evaluation.checklist_item.update',
    entityType: 'evaluation_checklist_item',
    entityId: id,
    context: {
      term_id: before.term_id,
      subject_id: before.subject_id,
      level_id: before.level_id,
      before: { item_text: before.item_text, sort_order: before.sort_order },
      after: {
        item_text: itemText ?? before.item_text,
        sort_order: sortOrder ?? before.sort_order,
      },
    },
  });

  return NextResponse.json({ ok: true });
}

// DELETE /api/evaluation/checklist-items/[id] — hard delete. Cascade drops
// any responses on this item (per migration 023 FK).
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(['superadmin']);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const service = createServiceClient();

  const { data: before } = await service
    .from('evaluation_checklist_items')
    .select('id, term_id, subject_id, level_id, item_text')
    .eq('id', id)
    .maybeSingle();
  if (!before) return NextResponse.json({ error: 'item not found' }, { status: 404 });

  const { error } = await service
    .from('evaluation_checklist_items')
    .delete()
    .eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'evaluation.checklist_item.delete',
    entityType: 'evaluation_checklist_item',
    entityId: id,
    context: {
      term_id: before.term_id,
      subject_id: before.subject_id,
      level_id: before.level_id,
      item_text: before.item_text,
    },
  });

  return NextResponse.json({ ok: true });
}
