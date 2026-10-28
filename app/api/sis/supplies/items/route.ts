import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { STUDENT_RECORD_WRITERS } from '@/lib/auth/student-record';
import { SupplyItemCreateSchema } from '@/lib/schemas/supplies';
import {
  DUPLICATE_MESSAGE,
  bookColumns,
  findAyId,
  findLevel,
  isDuplicate,
  supplyColumns,
  type SupplyItemColumns,
} from '@/lib/sis/supplies/items-write';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/sis/supplies/items — add one book or supply to a year's list, on
// the Admissions Book list page (plan 2026-10-28-books-supplies-tracker.md,
// Phase 4; migration 199).
//
//   { kind: 'book', ay, levelId, subject, title, publisher, isbn, classType }
//   { kind: 'supply', ay, title, youngstartersOnly }
//
// The new item goes to the end of the year's list. A duplicate of an item
// already there (same level, track, subject and title) → 409.

export async function POST(request: Request) {
  const auth = await requireRole([...STUDENT_RECORD_WRITERS]);
  if ('error' in auth) return auth.error;

  const parsed = SupplyItemCreateSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const input = parsed.data;
  const service = createServiceClient();

  let ayId: string | null;
  let columns: SupplyItemColumns;
  try {
    ayId = await findAyId(service, input.ay);
    if (input.kind === 'book') {
      const level = await findLevel(service, { id: input.levelId });
      if (!level) {
        return NextResponse.json(
          { error: 'That level does not exist.' },
          { status: 400 }
        );
      }
      columns = { ...bookColumns(input, level.levelType), level_id: level.id };
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
    console.error('[supplies items POST]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
  if (!ayId) {
    return NextResponse.json(
      { error: `There is no academic year ${input.ay}.` },
      { status: 404 }
    );
  }

  // The end of the year's list, so a new subject's group comes after the
  // school's own and a new book sits last in its subject.
  const { data: last, error: lastErr } = await service
    .from('supply_items')
    .select('sort_order')
    .eq('academic_year_id', ayId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastErr) {
    return NextResponse.json({ error: lastErr.message }, { status: 500 });
  }
  const sortOrder =
    ((last as { sort_order: number } | null)?.sort_order ?? 0) + 1;

  const { data: row, error } = await service
    .from('supply_items')
    .insert({
      academic_year_id: ayId,
      kind: input.kind,
      sort_order: sortOrder,
      ...columns,
    })
    .select('id')
    .single();
  if (error) {
    if (isDuplicate(error)) {
      return NextResponse.json({ error: DUPLICATE_MESSAGE }, { status: 409 });
    }
    console.error('[supplies items POST] insert failed:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const id = (row as { id: string }).id;

  await logAction({
    service,
    actor: {
      id: auth.user.id,
      email: auth.user.email ?? null,
      role: auth.role,
    },
    action: 'sis.supplies.item_create',
    entityType: 'supply_item',
    entityId: id,
    context: { ay_code: input.ay, kind: input.kind, ...columns },
  });

  revalidatePath('/admissions/book-list');
  return NextResponse.json({ ok: true, id });
}
