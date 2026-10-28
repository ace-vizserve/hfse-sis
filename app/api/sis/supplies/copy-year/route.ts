import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { STUDENT_RECORD_WRITERS } from '@/lib/auth/student-record';
import { SupplyCopyYearSchema } from '@/lib/schemas/supplies';
import { findAyId } from '@/lib/sis/supplies/items-write';
import { fetchAllPages } from '@/lib/supabase/paginate';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/sis/supplies/copy-year  { from, to }
//
// Fills an EMPTY year's book list with a copy of another year's: every active
// item, with its level, track, subject and place in the list (plan
// 2026-10-28-books-supplies-tracker.md, Phase 4; migration 199). Handovers are
// not copied — they belong to the year they were given in. Refused with 409
// when the target year already has items, so a copy never merges into a list
// someone has started.

type SourceRow = {
  kind: string;
  level_id: string | null;
  class_type: string | null;
  subject: string | null;
  title: string;
  publisher: string | null;
  isbn: string | null;
  sort_order: number;
};

const notEmpty = (to: string) =>
  NextResponse.json(
    {
      error: `${to} already has a book list, so nothing was copied. Change it on this page instead.`,
      code: 'target_not_empty',
    },
    { status: 409 }
  );

export async function POST(request: Request) {
  const auth = await requireRole([...STUDENT_RECORD_WRITERS]);
  if ('error' in auth) return auth.error;

  const parsed = SupplyCopyYearSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { from, to } = parsed.data;
  const service = createServiceClient();

  let fromId: string | null;
  let toId: string | null;
  try {
    [fromId, toId] = await Promise.all([
      findAyId(service, from),
      findAyId(service, to),
    ]);
  } catch (e) {
    console.error('[supplies copy-year]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
  if (!fromId || !toId) {
    return NextResponse.json(
      { error: `There is no academic year ${!fromId ? from : to}.` },
      { status: 404 }
    );
  }

  const { count, error: countErr } = await service
    .from('supply_items')
    .select('id', { count: 'exact', head: true })
    .eq('academic_year_id', toId);
  if (countErr) {
    return NextResponse.json({ error: countErr.message }, { status: 500 });
  }
  if ((count ?? 0) > 0) return notEmpty(to);

  let rows: SourceRow[];
  try {
    rows = await fetchAllPages<SourceRow>((start, end) =>
      service
        .from('supply_items')
        .select(
          'kind, level_id, class_type, subject, title, publisher, isbn, sort_order'
        )
        .eq('academic_year_id', fromId)
        .eq('is_active', true)
        .range(start, end)
    );
  } catch (e) {
    console.error('[supplies copy-year]', e instanceof Error ? e.message : e);
    return NextResponse.json(
      { error: `Reading ${from}'s list failed.` },
      { status: 500 }
    );
  }
  if (rows.length === 0) {
    return NextResponse.json(
      { error: `${from} has no book list to copy.` },
      { status: 404 }
    );
  }

  const { error: insErr } = await service
    .from('supply_items')
    .insert(rows.map((r) => ({ ...r, academic_year_id: toId })));
  if (insErr) {
    // A second click that raced the first: the unique key refuses the lot.
    if (insErr.code === '23505') return notEmpty(to);
    console.error('[supplies copy-year] insert failed:', insErr.message);
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  await logAction({
    service,
    actor: {
      id: auth.user.id,
      email: auth.user.email ?? null,
      role: auth.role,
    },
    action: 'sis.supplies.copy_year',
    entityType: 'academic_year',
    entityId: toId,
    context: {
      from_ay: from,
      to_ay: to,
      copied: rows.length,
      books: rows.filter((r) => r.kind === 'book').length,
      supplies: rows.filter((r) => r.kind === 'supply').length,
    },
  });

  revalidatePath('/admissions/book-list');
  return NextResponse.json({ ok: true, copied: rows.length });
}
