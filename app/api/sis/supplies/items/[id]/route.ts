import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { STUDENT_RECORD_WRITERS } from '@/lib/auth/student-record';
import { SupplyItemUpdateSchema } from '@/lib/schemas/supplies';
import {
  DUPLICATE_MESSAGE,
  bookColumns,
  findLevel,
  isDuplicate,
  supplyColumns,
  type SupplyItemColumns,
} from '@/lib/sis/supplies/items-write';
import { createServiceClient } from '@/lib/supabase/service';

// /api/sis/supplies/items/[id] — change or remove one item on a year's book
// list (plan 2026-10-28-books-supplies-tracker.md, Phase 4; migration 199).
//
//   PATCH  the item's fields (its kind never changes; a book keeps its level)
//   DELETE the item — refused with 409 once any student has been given it,
//          because deleting it would delete those handovers with it (the
//          foreign key cascades). Edit it instead.

type StoredItem = {
  id: string;
  kind: 'book' | 'supply';
  level_id: string | null;
  class_type: string | null;
  subject: string | null;
  title: string;
  publisher: string | null;
  isbn: string | null;
  academic_year: { ay_code: string } | { ay_code: string }[] | null;
};

const IdSchema = z.string().uuid();

async function loadItem(
  service: ReturnType<typeof createServiceClient>,
  id: string
): Promise<StoredItem | null> {
  const { data, error } = await service
    .from('supply_items')
    .select(
      'id, kind, level_id, class_type, subject, title, publisher, isbn, academic_year:academic_years(ay_code)'
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Item lookup failed: ${error.message}`);
  return (data as StoredItem | null) ?? null;
}

function ayCodeOf(item: StoredItem): string | null {
  const ay = Array.isArray(item.academic_year)
    ? item.academic_year[0]
    : item.academic_year;
  return ay?.ay_code ?? null;
}

const notFound = () =>
  NextResponse.json(
    { error: 'That item is no longer on the list.' },
    { status: 404 }
  );

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole([...STUDENT_RECORD_WRITERS]);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const parsed = SupplyItemUpdateSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!IdSchema.safeParse(id).success || !parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid payload',
        ...(parsed.success ? {} : { details: parsed.error.flatten() }),
      },
      { status: 400 }
    );
  }
  const input = parsed.data;
  const service = createServiceClient();

  let before: StoredItem | null;
  let columns: SupplyItemColumns;
  try {
    before = await loadItem(service, id);
    if (!before) return notFound();
    if (before.kind !== input.kind) {
      return NextResponse.json(
        { error: `This item is a ${before.kind}, not a ${input.kind}.` },
        { status: 400 }
      );
    }
    if (input.kind === 'book') {
      const level = before.level_id
        ? await findLevel(service, { id: before.level_id })
        : null;
      columns = bookColumns(input, level?.levelType ?? 'primary');
    } else {
      let levelId: string | null = null;
      if (input.youngstartersOnly) {
        const ys = await findLevel(service, { code: 'YS' });
        if (!ys) {
          return NextResponse.json(
            { error: 'There is no Youngstarters level.' },
            { status: 400 }
          );
        }
        levelId = ys.id;
      }
      columns = supplyColumns(input, levelId);
    }
  } catch (e) {
    console.error('[supplies item PATCH]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }

  const { data: updated, error } = await service
    .from('supply_items')
    .update({ ...columns, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id');
  if (error) {
    if (isDuplicate(error)) {
      return NextResponse.json({ error: DUPLICATE_MESSAGE }, { status: 409 });
    }
    console.error('[supplies item PATCH] update failed:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!updated?.length) return notFound();

  await logAction({
    service,
    actor: {
      id: auth.user.id,
      email: auth.user.email ?? null,
      role: auth.role,
    },
    action: 'sis.supplies.item_update',
    entityType: 'supply_item',
    entityId: id,
    context: {
      ay_code: ayCodeOf(before),
      kind: before.kind,
      before: {
        subject: before.subject,
        title: before.title,
        publisher: before.publisher,
        isbn: before.isbn,
        class_type: before.class_type,
        level_id: before.level_id,
      },
      after: columns,
    },
  });

  revalidatePath('/admissions/book-list');
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole([...STUDENT_RECORD_WRITERS]);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  if (!IdSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid item id' }, { status: 400 });
  }
  const service = createServiceClient();

  let item: StoredItem | null;
  try {
    item = await loadItem(service, id);
  } catch (e) {
    console.error('[supplies item DELETE]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
  if (!item) return notFound();

  const { count, error: countErr } = await service
    .from('supply_handovers')
    .select('id', { count: 'exact', head: true })
    .eq('item_id', id);
  if (countErr) {
    return NextResponse.json({ error: countErr.message }, { status: 500 });
  }
  if ((count ?? 0) > 0) {
    const n = count ?? 0;
    return NextResponse.json(
      {
        error: `${n} ${n === 1 ? 'student has' : 'students have'} been given this, so it can't be removed. Edit it instead.`,
        code: 'item_given',
        given: n,
      },
      { status: 409 }
    );
  }

  const { error } = await service.from('supply_items').delete().eq('id', id);
  if (error) {
    console.error('[supplies item DELETE] delete failed:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logAction({
    service,
    actor: {
      id: auth.user.id,
      email: auth.user.email ?? null,
      role: auth.role,
    },
    action: 'sis.supplies.item_delete',
    entityType: 'supply_item',
    entityId: id,
    context: {
      ay_code: ayCodeOf(item),
      kind: item.kind,
      subject: item.subject,
      title: item.title,
      publisher: item.publisher,
      isbn: item.isbn,
      class_type: item.class_type,
      level_id: item.level_id,
    },
  });

  revalidatePath('/admissions/book-list');
  return NextResponse.json({ ok: true });
}
