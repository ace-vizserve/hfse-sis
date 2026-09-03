import { NextResponse, type NextRequest } from 'next/server';

import { requireCurrentAyCode } from '@/lib/academic-year';
import { logAction } from '@/lib/audit/log-action';
import { requireCapability } from '@/lib/auth/require-capability';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { SubjectCreateSchema } from '@/lib/schemas/subject';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/sis/admin/subjects/catalog
//
// Adds a new subject to the global `public.subjects` catalog. Brand-new
// subjects added here flow into new AYs only after the superadmin enables
// them at the desired levels (via the matrix POST). The subject row itself
// is global, not AY-scoped — every AY's subject_configs references it via
// subject_id.
//
// Code is normalized to uppercase + restricted to A-Z 0-9 _ - via the
// Zod schema. Duplicate code → 409 with the existing id so the UI can
// jump to it instead of silently failing.
export async function POST(request: NextRequest) {
  const auth = await requireCapability('subjects.create');
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = SubjectCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { code, name, is_examinable, grading_method } = parsed.data;

  const service = createServiceClient();

  // Duplicate-code pre-check. The DB has UNIQUE(code) as a backstop; this
  // pre-check just gives us a nicer error + lets us return the existing id.
  const { data: existing } = await service
    .from('subjects')
    .select('id')
    .eq('code', code)
    .maybeSingle();
  if (existing) {
    return NextResponse.json(
      {
        error: `Subject with code ${code} already exists`,
        existingId: (existing as { id: string }).id,
      },
      { status: 409 }
    );
  }

  const { data: inserted, error: insertErr } = await service
    .from('subjects')
    .insert({ code, name, is_examinable, grading_method })
    .select('id, code, name, is_examinable, grading_method')
    .single();
  if (insertErr || !inserted) {
    return NextResponse.json(
      { error: insertErr?.message ?? 'insert failed' },
      { status: 500 }
    );
  }
  const row = inserted as {
    id: string;
    code: string;
    name: string;
    is_examinable: boolean;
    grading_method: string;
  };

  await logAction({
    service,
    actor: {
      id: auth.user.id,
      email: auth.user.email ?? null,
      role: auth.role,
    },
    action: 'subject.create',
    entityType: 'subject',
    entityId: row.id,
    context: {
      code: row.code,
      name: row.name,
      is_examinable: row.is_examinable,
      grading_method: row.grading_method,
    },
  });

  // The catalogue is read through `unstable_cache` two modules down —
  // `lib/markbook/overview-data.ts` (`markbook:${ay}`) and
  // `lib/markbook/drill.ts` — so a subject added here stays invisible to the
  // dashboards that list subjects until the entry expires on its own. Same
  // call the two sibling routes in this folder already make.
  //
  // ⚠ The catalogue itself is AY-INDEPENDENT — a subject is not owned by a
  // year — but every cached READER is keyed by one, so the current year is
  // what has to be busted.
  invalidateDrillTags('markbook', await requireCurrentAyCode(service));

  return NextResponse.json({ ok: true, ...row });
}
