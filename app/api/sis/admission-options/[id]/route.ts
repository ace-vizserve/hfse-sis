import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

import {
  STAFF_SCHEDULE_LABEL,
  type AdmissionSchedule,
} from '@/lib/admissions/options';
import { admissionOptionsTag } from '@/lib/admissions/options-loader';
import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { ENROLMENT_PLACEMENT_WRITERS } from '@/lib/auth/student-record';
import { AdmissionOptionToggleSchema } from '@/lib/schemas/admission-options';
import { createServiceClient } from '@/lib/supabase/service';

// PATCH /api/sis/admission-options/[id]
// Body: { isOpen: boolean }
//
// Opens or closes ONE session (one row of `admission_options`, migration 174).
// Closing is how an option is withdrawn — there is no delete — so the row
// stays and the switch on /sis/admin/admission-options can turn it back on.
// A closed row drops out of GET /api/parent/v2/admission-options once the
// `admission-options:<ay>` tag is busted, which this route does.

type OptionRow = {
  id: string;
  level_label: string;
  class_type_label: string;
  schedule: AdmissionSchedule;
  is_open: boolean;
  academic_years: { ay_code: string } | { ay_code: string }[] | null;
};

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole([...ENROLMENT_PLACEMENT_WRITERS]);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'Option not found' }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = AdmissionOptionToggleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { isOpen } = parsed.data;

  const service = createServiceClient();
  const { data: before, error: readErr } = await service
    .from('admission_options')
    .select(
      'id, level_label, class_type_label, schedule, is_open, academic_years(ay_code)'
    )
    .eq('id', id)
    .maybeSingle();
  if (readErr) {
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }
  if (!before) {
    return NextResponse.json(
      { error: 'That option no longer exists. Reload the page.' },
      { status: 404 }
    );
  }
  const row = before as unknown as OptionRow;
  const ay = Array.isArray(row.academic_years)
    ? row.academic_years[0]
    : row.academic_years;
  const ayCode = ay?.ay_code ?? '';

  // Already in the state asked for — a double click, or a second tab. Nothing
  // changes, so no audit row; the answer is still success.
  if (row.is_open === isOpen) {
    return NextResponse.json({ ok: true, changed: false });
  }

  const { error: updErr } = await service
    .from('admission_options')
    .update({ is_open: isOpen })
    .eq('id', id);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  await logAction({
    service,
    actor: {
      id: auth.user.id,
      email: auth.user.email ?? null,
      role: auth.role,
    },
    action: isOpen ? 'admission_option.open' : 'admission_option.close',
    entityType: 'admission_option',
    entityId: id,
    context: {
      ay_code: ayCode,
      level_label: row.level_label,
      class_type_label: row.class_type_label,
      schedule: row.schedule,
      schedule_label: STAFF_SCHEDULE_LABEL[row.schedule],
      before: row.is_open,
      after: isOpen,
    },
  });

  if (ayCode) revalidateTag(admissionOptionsTag(ayCode), 'max');
  return NextResponse.json({ ok: true, changed: true });
}
