import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

import { admissionOptionsTag } from '@/lib/admissions/options-loader';
import { findAcademicYear } from '@/lib/admissions/options-write';
import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { ENROLMENT_PLACEMENT_WRITERS } from '@/lib/auth/student-record';
import { AdmissionOptionCopySchema } from '@/lib/schemas/admission-options';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/sis/admission-options/copy
// Body: { fromAy, toAy }
//
// Rollover in one click: fills an EMPTY year with a copy of another year's
// options — every level name, class type, track and session, each open or
// closed as it is in the source year. Refused with 409 when the target year
// already has options, so a copy can never merge into, or duplicate, a year
// someone has started setting up.
//
// No level aliases are written: every level name being copied already
// resolves (it was saved through the create / edit routes, or the seed, which
// both ensure that), and `level_aliases` is global rather than per year.

type SourceRow = {
  level_label: string;
  level_id: string;
  class_type_label: string;
  track: string;
  schedule: string;
  is_open: boolean;
  sort_order: number;
};

export async function POST(request: Request) {
  const auth = await requireRole([...ENROLMENT_PLACEMENT_WRITERS]);
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = AdmissionOptionCopySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { fromAy, toAy } = parsed.data;

  const service = createServiceClient();
  const [source, target] = await Promise.all([
    findAcademicYear(service, fromAy),
    findAcademicYear(service, toAy),
  ]);
  if (!source || !target) {
    return NextResponse.json(
      { error: `There is no academic year ${!source ? fromAy : toAy}.` },
      { status: 404 }
    );
  }

  const { count: targetCount, error: countErr } = await service
    .from('admission_options')
    .select('id', { count: 'exact', head: true })
    .eq('academic_year_id', target.id);
  if (countErr) {
    return NextResponse.json({ error: countErr.message }, { status: 500 });
  }
  if ((targetCount ?? 0) > 0) {
    return NextResponse.json(
      {
        error: `${toAy} already has enrolment form options, so nothing was copied. Change them on this page instead.`,
        code: 'target_not_empty',
      },
      { status: 409 }
    );
  }

  const { data: sourceRows, error: readErr } = await service
    .from('admission_options')
    .select(
      'level_label, level_id, class_type_label, track, schedule, is_open, sort_order'
    )
    .eq('academic_year_id', source.id)
    .order('sort_order', { ascending: true });
  if (readErr) {
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }
  const rows = (sourceRows ?? []) as SourceRow[];
  if (rows.length === 0) {
    return NextResponse.json(
      { error: `${fromAy} has no options to copy.` },
      { status: 404 }
    );
  }

  const { error: insErr } = await service
    .from('admission_options')
    .insert(rows.map((r) => ({ ...r, academic_year_id: target.id })));
  if (insErr) {
    // A second click that raced the first: the unique key refuses the lot.
    if (insErr.code === '23505') {
      return NextResponse.json(
        {
          error: `${toAy} already has enrolment form options, so nothing was copied.`,
          code: 'target_not_empty',
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  await logAction({
    service,
    actor: {
      id: auth.user.id,
      email: auth.user.email ?? null,
      role: auth.role,
    },
    action: 'admission_option.copy',
    entityType: 'academic_year',
    entityId: target.id,
    context: {
      from_ay: fromAy,
      to_ay: toAy,
      copied: rows.length,
      copied_open: rows.filter((r) => r.is_open).length,
    },
  });

  revalidateTag(admissionOptionsTag(toAy), 'max');
  return NextResponse.json({ ok: true, copied: rows.length });
}
