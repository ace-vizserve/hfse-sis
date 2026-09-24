import { NextResponse, type NextRequest } from 'next/server';

import { listAyCodes } from '@/lib/academic-year';
import { logAction } from '@/lib/audit/log-action';
import { requireCapability } from '@/lib/auth/require-capability';
import { invalidateAllOperationalDrills } from '@/lib/cache/invalidate-drill-tags';
import {
  SectionCopySchema,
  type SectionClassType,
} from '@/lib/schemas/section';
import {
  finishNewSection,
  resolveSectionTargetAy,
} from '@/lib/sis/section-create';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/sections/copy?ay=<target> — copy sections from another year.
//
// Exists because a year with missing sections breaks admissions silently:
// the sync skips a child whose section the SIS does not have, so AY2027
// children placed in Directus never reached Records until someone noticed.
// Setting a new year up from the last one is one action instead of twenty.
//
// Copies name, level, Global/Standard and schedule — the section's shape, not
// its people: no form class adviser, no students. A section the target year
// already has (same level + name) is skipped, so a re-run is harmless. Each
// copy then goes through the same follow-up as a hand-made section.
export async function POST(request: NextRequest) {
  const auth = await requireCapability('sections.create');
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = SectionCopySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { from_ay, section_ids } = parsed.data;

  const target = await resolveSectionTargetAy(
    new URL(request.url).searchParams.get('ay')
  );
  if ('error' in target) {
    return NextResponse.json(
      { error: target.error },
      { status: target.status }
    );
  }
  const { ay } = target;

  const service = createServiceClient();

  // Validated against the real list, never interpolated blind.
  const known = await listAyCodes(service);
  if (!known.includes(from_ay) || from_ay === ay.ay_code) {
    return NextResponse.json(
      { error: `Can't copy sections from ${from_ay} into ${ay.ay_code}.` },
      { status: 400 }
    );
  }

  const { data: fromAy, error: fromErr } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', from_ay)
    .single();
  if (fromErr || !fromAy) {
    return NextResponse.json(
      { error: 'source year not found' },
      { status: 400 }
    );
  }

  type Row = {
    id: string;
    name: string;
    level_id: string;
    class_type: SectionClassType | null;
    schedule: string | null;
  };
  const [srcRes, dstRes] = await Promise.all([
    service
      .from('sections')
      .select('id, name, level_id, class_type, schedule')
      .eq('academic_year_id', fromAy.id)
      .in('id', section_ids),
    service
      .from('sections')
      .select('name, level_id')
      .eq('academic_year_id', ay.id),
  ]);
  if (srcRes.error || dstRes.error) {
    return NextResponse.json(
      { error: (srcRes.error ?? dstRes.error)!.message },
      { status: 500 }
    );
  }
  const have = new Set(
    (dstRes.data ?? []).map((s) => `${s.level_id}::${s.name}`)
  );
  const toCopy = ((srcRes.data ?? []) as Row[]).filter(
    (s) => !have.has(`${s.level_id}::${s.name}`)
  );

  if (toCopy.length === 0) {
    return NextResponse.json({ ok: true, created: 0 });
  }

  const { data: inserted, error: insertErr } = await service
    .from('sections')
    .insert(
      toCopy.map((s) => ({
        academic_year_id: ay.id,
        level_id: s.level_id,
        name: s.name,
        class_type: s.class_type,
        schedule: s.schedule,
      }))
    )
    .select('id, name, level_id, class_type');
  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  for (const s of inserted ?? []) {
    const followUp = await finishNewSection(service, {
      sectionId: s.id,
      academicYearId: ay.id,
      classType: s.class_type as SectionClassType | null,
    });
    await logAction({
      service,
      actor: {
        id: auth.user.id,
        email: auth.user.email ?? null,
        role: auth.role,
      },
      action: 'section.create',
      entityType: 'section',
      entityId: s.id,
      context: {
        academic_year_id: ay.id,
        ay_code: ay.ay_code,
        section_name: s.name,
        level_id: s.level_id,
        class_type: s.class_type ?? null,
        copied_from_ay: from_ay,
        track_bundle_inserted: followUp.trackBundleInserted,
        ...(followUp.trackBundleError
          ? { track_bundle_error: followUp.trackBundleError }
          : {}),
        grading_sheets_created: followUp.sheetsInserted,
        ...(followUp.sheetsError
          ? { grading_sheets_error: followUp.sheetsError }
          : {}),
      },
    });
  }

  invalidateAllOperationalDrills(ay.ay_code);

  return NextResponse.json({ ok: true, created: inserted?.length ?? 0 });
}
