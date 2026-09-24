import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

import { STAFF_SCHEDULE_LABEL } from '@/lib/admissions/options';
import { admissionOptionsTag } from '@/lib/admissions/options-loader';
import {
  ensureLevelAliasForOption,
  findAcademicYear,
} from '@/lib/admissions/options-write';
import { getCurrentAcademicYear } from '@/lib/academic-year';
import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { ENROLMENT_PLACEMENT_WRITERS } from '@/lib/auth/student-record';
import { invalidateAllOperationalDrills } from '@/lib/cache/invalidate-drill-tags';
import { AdmissionOptionCreateSchema } from '@/lib/schemas/admission-options';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/sis/admission-options
// Body: { ayCode, levelLabel, levelId, classTypeLabel, track, schedules[] }
//
// Adds one (level name, class type) combination to what the enrolment forms
// offer for a year — one `admission_options` row per chosen session, all open
// (migration 174). The level name is also recorded as a level alias so an
// application carrying it resolves to `levelId`; a name that already means a
// different level is refused with 409 before anything is written
// (lib/admissions/options-write.ts).
export async function POST(request: Request) {
  const auth = await requireRole([...ENROLMENT_PLACEMENT_WRITERS]);
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = AdmissionOptionCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { ayCode, levelLabel, levelId, classTypeLabel, track, schedules } =
    parsed.data;

  const service = createServiceClient();
  const actor = {
    id: auth.user.id,
    email: auth.user.email ?? null,
    role: auth.role,
  };

  const ay = await findAcademicYear(service, ayCode);
  if (!ay) {
    return NextResponse.json(
      { error: `There is no academic year ${ayCode}.` },
      { status: 404 }
    );
  }

  // Refuse a clash up front, so no half of the combination is ever saved.
  const { data: clash, error: clashErr } = await service
    .from('admission_options')
    .select('schedule')
    .eq('academic_year_id', ay.id)
    .eq('level_label', levelLabel)
    .eq('class_type_label', classTypeLabel);
  if (clashErr) {
    return NextResponse.json({ error: clashErr.message }, { status: 500 });
  }
  if ((clash ?? []).length > 0) {
    return NextResponse.json(
      {
        error: `"${levelLabel}" with "${classTypeLabel}" is already on the forms for ${ayCode}. Edit that row to change it, or switch its sessions on.`,
        code: 'duplicate_admission_option',
      },
      { status: 409 }
    );
  }

  const alias = await ensureLevelAliasForOption(
    service,
    levelLabel,
    levelId,
    actor
  );
  if (!alias.ok) {
    return NextResponse.json(
      { error: alias.error, code: 'level_name_taken' },
      { status: alias.status }
    );
  }

  // New rows go after everything already in the year; the page orders by SIS
  // level first, so this only decides the order within a level.
  const { data: last } = await service
    .from('admission_options')
    .select('sort_order')
    .eq('academic_year_id', ay.id)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const base = ((last as { sort_order: number } | null)?.sort_order ?? 0) + 10;

  const rows = schedules.map((schedule, i) => ({
    academic_year_id: ay.id,
    level_label: levelLabel,
    level_id: levelId,
    class_type_label: classTypeLabel,
    track,
    schedule,
    is_open: true,
    sort_order: base + i * 10,
  }));

  const { data: inserted, error: insErr } = await service
    .from('admission_options')
    .insert(rows)
    .select('id');
  if (insErr) {
    if (insErr.code === '23505') {
      return NextResponse.json(
        {
          error: `"${levelLabel}" with "${classTypeLabel}" is already on the forms for ${ayCode}.`,
          code: 'duplicate_admission_option',
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  const ids = ((inserted ?? []) as { id: string }[]).map((r) => r.id);
  await logAction({
    service,
    actor,
    action: 'admission_option.create',
    entityType: 'admission_option',
    entityId: ids[0] ?? null,
    context: {
      ay_code: ayCode,
      level_label: levelLabel,
      class_type_label: classTypeLabel,
      counts_as_label: alias.level.label,
      counts_as_code: alias.level.code,
      track,
      schedules,
      schedule_labels: schedules.map((s) => STAFF_SCHEDULE_LABEL[s]),
      option_ids: ids,
    },
  });

  revalidateTag(admissionOptionsTag(ayCode), 'max');
  if (alias.created) {
    // A new alias moves what /records/level-mismatches counts — same bust the
    // level-aliases route does after saving one.
    const current = await getCurrentAcademicYear();
    if (current) await invalidateAllOperationalDrills(current.ay_code);
  }

  return NextResponse.json({ ok: true, ids });
}
