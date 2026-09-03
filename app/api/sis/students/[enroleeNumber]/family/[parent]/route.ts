import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { STUDENT_RECORD_WRITERS } from '@/lib/auth/student-record';
import { logAction } from '@/lib/audit/log-action';
import {
  buildFatherUpdateSchema,
  buildGuardianUpdateSchema,
  buildMotherUpdateSchema,
  FATHER_GATED_FIELDS,
  FatherUpdateSchema,
  GUARDIAN_GATED_FIELDS,
  GuardianUpdateSchema,
  MOTHER_GATED_FIELDS,
  MotherUpdateSchema,
  PARENT_SLOTS,
  type ParentSlot,
} from '@/lib/schemas/sis';
import { createServiceClient } from '@/lib/supabase/service';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';

// PATCH /api/sis/students/[enroleeNumber]/family/[parent]?ay=AY2026
//
// Updates one parent slot's columns on ay{YY}_enrolment_applications.
// `parent` must be one of: father / mother / guardian. Unknown columns are
// 400'd by the per-slot zod schema.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ enroleeNumber: string; parent: string }> }
) {
  // Who may write the shared student record — see lib/auth/student-record.ts.
  // school_admin was added 2026-07-31 (KD #173): both pages that render these
  // editors already admitted her, so every save 403'd against a form that had
  // opened for her.
  const auth = await requireRole([...STUDENT_RECORD_WRITERS]);
  if ('error' in auth) return auth.error;

  const { enroleeNumber, parent: rawParent } = await params;
  if (!enroleeNumber.trim()) {
    return NextResponse.json(
      { error: 'Missing enroleeNumber' },
      { status: 400 }
    );
  }
  if (!(PARENT_SLOTS as readonly string[]).includes(rawParent)) {
    return NextResponse.json(
      { error: `Unknown parent slot: ${rawParent}` },
      { status: 400 }
    );
  }
  const parent = rawParent as ParentSlot;

  const url = new URL(request.url);
  const ayCode = (url.searchParams.get('ay') ?? '').trim();
  if (!/^AY\d{4}$/i.test(ayCode)) {
    return NextResponse.json(
      { error: 'Invalid or missing ay query param' },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const prefix = `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
  const appsTable = `${prefix}_enrolment_applications`;
  const supabase = createServiceClient();

  // Keys are filtered to the chosen parent slot's schema shape first: this
  // select() runs BEFORE zod parsing (which is what normally strips unknown
  // keys), so an unexpected key in the body would otherwise reach Postgrest
  // as a column name and 500 the whole save.
  const strictSchemaByParent = {
    father: FatherUpdateSchema,
    mother: MotherUpdateSchema,
    guardian: GuardianUpdateSchema,
  } as const;
  const allowedCols = new Set(Object.keys(strictSchemaByParent[parent].shape));
  const rawKeys = Object.keys(body as Record<string, unknown>).filter((k) =>
    allowedCols.has(k)
  );
  if (rawKeys.length === 0) {
    return NextResponse.json({ ok: true, changed: 0 });
  }
  const { data: before, error: beforeErr } = await supabase
    .from(appsTable)
    .select(rawKeys.join(', '))
    .eq('enroleeNumber', enroleeNumber)
    .maybeSingle();
  if (beforeErr) {
    console.error('[sis family PATCH] pre-fetch failed:', beforeErr.message);
    return NextResponse.json(
      { error: 'Application lookup failed' },
      { status: 500 }
    );
  }
  if (!before) {
    return NextResponse.json(
      { error: 'No application row for this enrolee in this AY' },
      { status: 404 }
    );
  }
  const beforeRow = before as unknown as Record<string, unknown>;
  const bodyRecord = body as Record<string, unknown>;

  const gatedFieldsByParent: Record<ParentSlot, readonly string[]> = {
    father: FATHER_GATED_FIELDS,
    mother: MOTHER_GATED_FIELDS,
    guardian: GUARDIAN_GATED_FIELDS,
  };
  const buildSchemaByParent = {
    father: buildFatherUpdateSchema,
    mother: buildMotherUpdateSchema,
    guardian: buildGuardianUpdateSchema,
  } as const;

  const changedFields = new Set(
    gatedFieldsByParent[parent].filter(
      (f) => (bodyRecord[f] ?? null) !== (beforeRow[f] ?? null)
    )
  );
  const parsed = buildSchemaByParent[parent](changedFields).safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const update = parsed.data as Record<string, unknown>;

  const { error: upErr } = await supabase
    .from(appsTable)
    .update(update)
    .eq('enroleeNumber', enroleeNumber);
  if (upErr) {
    console.error('[sis family PATCH] update failed:', upErr.message);
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  const changes: Array<{ field: string; from: unknown; to: unknown }> = [];
  for (const [col, next] of Object.entries(update)) {
    const prev = beforeRow[col] ?? null;
    if ((prev ?? null) !== (next ?? null)) {
      changes.push({ field: col, from: prev, to: next });
    }
  }

  await logAction({
    service: supabase,
    actor: {
      id: auth.user.id,
      email: auth.user.email ?? null,
      role: auth.role,
    },
    action: 'sis.family.update',
    entityType: 'enrolment_application',
    entityId: enroleeNumber,
    context: { ay_code: ayCode, parent, changes },
  });

  revalidateTag(`sis:${ayCode}`, 'max');
  invalidateDrillTags('admissions', ayCode);
  return NextResponse.json({ ok: true, changed: changes.length });
}
