import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

import {
  STAFF_SCHEDULE_LABEL,
  type AdmissionSchedule,
} from '@/lib/admissions/options';
import { admissionOptionsTag } from '@/lib/admissions/options-loader';
import { findAcademicYear } from '@/lib/admissions/options-write';
import { logActions } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { ENROLMENT_PLACEMENT_WRITERS } from '@/lib/auth/student-record';
import { AdmissionOptionBulkToggleSchema } from '@/lib/schemas/admission-options';
import { createServiceClient } from '@/lib/supabase/service';

// PATCH /api/sis/admission-options/bulk
// Body: { ayCode, optionIds: uuid[] (1..200), isOpen: boolean }
//
// The matrix's bulk bar on /sis/admin/admission-options: "close Morning for
// these 7 classes" in one write instead of seven switches. Each id is one
// session row of `admission_options` (migration 174), exactly what the single
// switch (./[id]/route.ts) flips — and each changed row is audited with the
// same action and context shape that route writes, plus `bulk: true`, so the
// audit log reads the same whichever control made the change.
//
// Every id must belong to `ayCode`; one that does not (another year, or a row
// that no longer exists) refuses the whole request with 400 rather than
// writing part of it. Rows already in the state asked for are left alone and
// not audited.

type OptionRow = {
  id: string;
  level_label: string;
  class_type_label: string;
  schedule: AdmissionSchedule;
  is_open: boolean;
};

export async function PATCH(request: Request) {
  const auth = await requireRole([...ENROLMENT_PLACEMENT_WRITERS]);
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = AdmissionOptionBulkToggleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { ayCode, optionIds, isOpen } = parsed.data;

  const service = createServiceClient();
  const ay = await findAcademicYear(service, ayCode);
  if (!ay) {
    return NextResponse.json(
      { error: `There is no academic year ${ayCode}.` },
      { status: 404 }
    );
  }

  const { data: found, error: readErr } = await service
    .from('admission_options')
    .select('id, level_label, class_type_label, schedule, is_open')
    .eq('academic_year_id', ay.id)
    .in('id', optionIds);
  if (readErr) {
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }
  const rows = (found ?? []) as OptionRow[];
  if (rows.length !== optionIds.length) {
    return NextResponse.json(
      {
        error: `Some of those sessions are not ${ayCode} options any more. Reload the page and try again.`,
      },
      { status: 400 }
    );
  }

  const toChange = rows.filter((r) => r.is_open !== isOpen);
  if (toChange.length === 0) {
    return NextResponse.json({ ok: true, changed: 0 });
  }

  // `.eq('is_open', !isOpen)` so a row another tab flipped in between is not
  // counted — or audited — as changed by this request.
  const { data: updated, error: updErr } = await service
    .from('admission_options')
    .update({ is_open: isOpen })
    .in(
      'id',
      toChange.map((r) => r.id)
    )
    .eq('is_open', !isOpen)
    .select('id');
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }
  const changedIds = new Set(
    ((updated ?? []) as Array<{ id: string }>).map((r) => r.id)
  );
  const changed = toChange.filter((r) => changedIds.has(r.id));

  await logActions(
    service,
    { id: auth.user.id, email: auth.user.email ?? null, role: auth.role },
    changed.map((row) => ({
      action: isOpen
        ? ('admission_option.open' as const)
        : ('admission_option.close' as const),
      entityType: 'admission_option' as const,
      entityId: row.id,
      context: {
        ay_code: ayCode,
        level_label: row.level_label,
        class_type_label: row.class_type_label,
        schedule: row.schedule,
        schedule_label: STAFF_SCHEDULE_LABEL[row.schedule],
        before: row.is_open,
        after: isOpen,
        bulk: true,
      },
    }))
  );

  revalidateTag(admissionOptionsTag(ayCode), 'max');
  return NextResponse.json({ ok: true, changed: changed.length });
}
