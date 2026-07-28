import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { logAction } from '@/lib/audit/log-action';
import {
  buildProfileUpdateSchema,
  PROFILE_GATED_FIELDS,
  ProfileUpdateSchema,
  type ProfileUpdateInput,
} from '@/lib/schemas/sis';
import { createServiceClient } from '@/lib/supabase/service';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';

// PATCH /api/sis/students/[enroleeNumber]/profile?ay=AY2026
//
// Updates demographic / preference fields on ay{YY}_enrolment_applications.
// Stable IDs (enroleeNumber, studentNumber) are not in the schema and would
// be rejected if sent. Audit-logged with a per-field diff.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ enroleeNumber: string }> }
) {
  // Per KD #74: admissions is the operational writer; school_admin is read-only oversight.
  const auth = await requireRole([
    'admissions',
    'academic_coordinator',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const { enroleeNumber } = await params;
  if (!enroleeNumber.trim()) {
    return NextResponse.json(
      { error: 'Missing enroleeNumber' },
      { status: 400 }
    );
  }

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

  // Pre-fetch BEFORE validating, so we can tell which of the format-gated
  // fields (KD pending — student-profile validation-parity) actually
  // changed vs. are pre-existing legacy values the registrar didn't touch.
  // The strict schema must only reject a NEW write of a bad value.
  //
  // Keys are filtered to the schema's own shape first: this select() runs
  // BEFORE zod parsing (which is what normally strips unknown keys), so an
  // unexpected key in the body would otherwise reach Postgrest as a column
  // name and 500 the whole save.
  const allowedCols = new Set(Object.keys(ProfileUpdateSchema.shape));
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
    console.error('[sis profile PATCH] pre-fetch failed:', beforeErr.message);
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

  const changedFields = new Set(
    PROFILE_GATED_FIELDS.filter(
      (f) => (bodyRecord[f] ?? null) !== (beforeRow[f] ?? null)
    )
  );
  const schema = buildProfileUpdateSchema(changedFields);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const update = parsed.data as ProfileUpdateInput;

  const { error: upErr } = await supabase
    .from(appsTable)
    .update(update)
    .eq('enroleeNumber', enroleeNumber);
  if (upErr) {
    console.error('[sis profile PATCH] update failed:', upErr.message);
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  // Shared-profile name sync (KD #147). The student NAME is denormalized into
  // `public.students` (the grading schema's copy that section_students /
  // grade_entries FK to). When a name field is edited here — including from the
  // Records surface — mirror it so the two records can't disagree. Best-effort +
  // non-fatal: the apps row is the source of truth; a sync miss is warned, never
  // 500s. `first_name`/`last_name` are NOT NULL in `public.students`, so only
  // real values are mirrored (a cleared name never nulls the grading copy);
  // `middle_name` is nullable.
  const NAME_COLS: Record<string, 'first_name' | 'middle_name' | 'last_name'> =
    {
      firstName: 'first_name',
      middleName: 'middle_name',
      lastName: 'last_name',
    };
  const namePatch: Record<string, string | null> = {};
  for (const [field, col] of Object.entries(NAME_COLS)) {
    if (!(field in update)) continue;
    const v = (update as Record<string, unknown>)[field];
    const str = typeof v === 'string' && v.trim() ? v.trim() : null;
    if (col === 'middle_name') namePatch[col] = str;
    else if (str) namePatch[col] = str;
  }
  if (Object.keys(namePatch).length > 0) {
    const { data: idRow } = await supabase
      .from(appsTable)
      .select('"studentNumber"')
      .eq('enroleeNumber', enroleeNumber)
      .maybeSingle();
    const studentNumber =
      (idRow as { studentNumber: string | null } | null)?.studentNumber ?? null;
    if (studentNumber) {
      const { error: nameErr } = await supabase
        .from('students')
        .update(namePatch)
        .eq('student_number', studentNumber);
      if (nameErr) {
        console.warn(
          '[sis profile PATCH] name sync to public.students failed:',
          nameErr.message
        );
      }
    }
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
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'sis.profile.update',
    entityType: 'enrolment_application',
    entityId: enroleeNumber,
    context: { ay_code: ayCode, changes },
  });

  revalidateTag(`sis:${ayCode}`, 'max');
  invalidateDrillTags('admissions', ayCode);
  return NextResponse.json({ ok: true, changed: changes.length });
}
