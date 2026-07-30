import { NextResponse, type NextRequest } from 'next/server';
import { requireCapability } from '@/lib/auth/require-capability';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { logAction } from '@/lib/audit/log-action';
import { SectionCreateSchema } from '@/lib/schemas/section';
import { invalidateAllOperationalDrills } from '@/lib/cache/invalidate-drill-tags';
import { applyTrackBundle } from '@/lib/sis/section-track';

// List sections for the current academic year, annotated with enrolment counts.
export async function GET() {
  // sections.read includes `teacher` — `sections` is reference data migration
  // 005 calls "read-only UI scaffolding", and teachers need the list to pick a
  // class. Same four roles the array named.
  const auth = await requireCapability('sections.read');
  if ('error' in auth) return auth.error;

  const supabase = await createClient();

  const { data: ay, error: ayErr } = await supabase
    .from('academic_years')
    .select('id, ay_code')
    .eq('is_current', true)
    .single();
  if (ayErr || !ay) {
    return NextResponse.json(
      { error: 'no current academic year' },
      { status: 500 }
    );
  }

  const { data: sections, error: secErr } = await supabase
    .from('sections')
    .select('id, name, level:levels(id, code, label, level_type)')
    .eq('academic_year_id', ay.id)
    .order('name');
  if (secErr)
    return NextResponse.json({ error: secErr.message }, { status: 500 });

  const ids = (sections ?? []).map((s) => s.id);
  const counts: Record<string, { active: number; withdrawn: number }> = {};
  if (ids.length > 0) {
    const { data: enrolments, error } = await supabase
      .from('section_students')
      .select('section_id, enrollment_status')
      .in('section_id', ids);
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    for (const row of enrolments ?? []) {
      const bucket = (counts[row.section_id] ??= { active: 0, withdrawn: 0 });
      if (row.enrollment_status === 'withdrawn') bucket.withdrawn++;
      else bucket.active++;
    }
  }

  return NextResponse.json({
    ay_code: ay.ay_code,
    sections: (sections ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      level: s.level,
      active_count: counts[s.id]?.active ?? 0,
      withdrawn_count: counts[s.id]?.withdrawn ?? 0,
    })),
  });
}

// POST /api/sections â€” mid-year section create under the current AY.
export async function POST(request: NextRequest) {
  const auth = await requireCapability('sections.create');
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = SectionCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { name, level_id, class_type } = parsed.data;

  const service = createServiceClient();

  const { data: ay, error: ayErr } = await service
    .from('academic_years')
    .select('id, ay_code')
    .eq('is_current', true)
    .maybeSingle();
  if (ayErr || !ay) {
    return NextResponse.json(
      { error: 'no current academic year' },
      { status: 500 }
    );
  }

  // `class_type` doubles as the Secondary "track" picker (see
  // lib/schemas/section.ts) — Secondary-only, always-explicit at the
  // application layer, never inferred from level code, never defaulted
  // (the direct lesson from `sections.curriculum_track`, migration 058).
  // The DB column itself stays nullable/no-default; this is the
  // enforcement point.
  const { data: level } = await service
    .from('levels')
    .select('level_type')
    .eq('id', level_id)
    .maybeSingle();
  if (level?.level_type === 'secondary' && !class_type) {
    return NextResponse.json(
      {
        error: 'Track (Global or Standard) is required for Secondary sections',
      },
      { status: 422 }
    );
  }
  if (level?.level_type !== 'secondary' && class_type) {
    return NextResponse.json(
      { error: 'Track only applies to Secondary sections' },
      { status: 422 }
    );
  }

  const { data: inserted, error: insertErr } = await service
    .from('sections')
    .insert({
      academic_year_id: ay.id,
      level_id,
      name,
      class_type: class_type ?? null,
    })
    .select('id, name, level_id, class_type')
    .single();

  if (insertErr) {
    // 23505 = unique_violation (academic_year_id, level_id, name)
    if ((insertErr as { code?: string }).code === '23505') {
      return NextResponse.json(
        {
          error: `A section named "${name}" already exists in this level for ${ay.ay_code}.`,
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  // The section starts with zero subjects attached — no level-wide default
  // seeding happens here. The registrar attaches what applies, explicitly,
  // via the Section Subjects panel (or, for Secondary, by flagging the
  // section's track below). Track bundle-apply is the only automatic
  // attachment: when the registrar flagged this Secondary section
  // Global/Standard (via `class_type`) at creation, attach that track's
  // static subject bundle now. Otherwise the section stays empty until the
  // registrar attaches subjects via the Section Subjects panel.
  let trackBundleInserted = 0;
  if (class_type) {
    try {
      const bundleResult = await applyTrackBundle(service, {
        sectionId: inserted.id,
        academicYearId: ay.id,
        classType: class_type,
      });
      trackBundleInserted = bundleResult.inserted;
    } catch (e) {
      console.error(
        '[sections POST] track bundle-apply failed:',
        e instanceof Error ? e.message : e
      );
    }
  }

  // Bulk-create the grading sheets that should exist for this new section
  // (one per subject in the level Ã— every term in the AY). Best-effort â€” if
  // the RPC fails we still keep the section and log the hiccup; registrar
  // can run "Create all sheets" on /markbook/grading as a fallback.
  let sheetsInserted = 0;
  const { data: bulkResult, error: bulkErr } = await service.rpc(
    'create_grading_sheets_for_section',
    { p_section_id: inserted.id }
  );
  if (bulkErr) {
    console.error('[sections POST] bulk-sheet RPC failed:', bulkErr.message);
  } else if (
    bulkResult &&
    typeof bulkResult === 'object' &&
    'inserted' in bulkResult
  ) {
    sheetsInserted = Number(
      (bulkResult as { inserted: unknown }).inserted ?? 0
    );
  }

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'section.create',
    entityType: 'section',
    entityId: inserted.id,
    context: {
      academic_year_id: ay.id,
      ay_code: ay.ay_code,
      name,
      level_id,
      class_type: class_type ?? null,
      track_bundle_inserted: trackBundleInserted,
      grading_sheets_created: sheetsInserted,
    },
  });

  // New section affects every operational module's roster/drill rollups.
  invalidateAllOperationalDrills(ay.ay_code);

  return NextResponse.json({
    ok: true,
    id: inserted.id,
    name: inserted.name,
    grading_sheets_created: sheetsInserted,
  });
}
