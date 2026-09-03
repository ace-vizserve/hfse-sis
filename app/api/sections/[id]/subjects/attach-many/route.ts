import { NextResponse, type NextRequest } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireCapability } from '@/lib/auth/require-capability';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/sections/[id]/subjects/attach-many
// Body: { subjectConfigIds: string[] }
//
// Attaches a specific set of subjects to ONE section in a single round
// trip — the write behind the simplified Subject Setup page's "check
// subjects, pick sections, Attach" flow (replaces an earlier per-section
// track-flagging + checklist design that was rejected as overengineered).
// Unlike POST /api/sections/[id]/subjects (single-subject; 422s when the
// section's level has no subject_level_offerings row yet), this route
// treats attaching a subject to a section as the deliberate act of
// declaring it applies there — it upserts the missing offering row itself
// instead of requiring a separate "Offered" step the simplified page has
// no UI for. Additive only: never detaches, never touches an existing
// offering for a different subject/level.
//
// Registrar+ only — same gate as every other section-mutation route.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireCapability('sections.edit');
  if ('error' in auth) return auth.error;

  const { id: sectionId } = await params;
  const body = (await request.json().catch(() => null)) as {
    subjectConfigIds?: unknown;
  } | null;
  const subjectConfigIds = Array.isArray(body?.subjectConfigIds)
    ? body.subjectConfigIds.filter((v): v is string => typeof v === 'string')
    : [];
  if (subjectConfigIds.length === 0) {
    return NextResponse.json(
      { error: 'subjectConfigIds required' },
      { status: 400 }
    );
  }

  const service = createServiceClient();

  const { data: section } = await service
    .from('sections')
    .select(
      'id, name, level_id, academic_year_id, academic_years!inner(ay_code)'
    )
    .eq('id', sectionId)
    .maybeSingle();
  if (!section) {
    return NextResponse.json({ error: 'Section not found' }, { status: 404 });
  }
  const ayJoin = section.academic_years as unknown as
    | { ay_code: string }
    | { ay_code: string }[];
  const ayCode = Array.isArray(ayJoin) ? ayJoin[0]?.ay_code : ayJoin?.ay_code;

  const { data: configRows } = await service
    .from('subject_configs')
    // `code` only. The audit row below records subject CODES, and a code never
    // changes with a rename — so there is nothing here that a per-year name
    // would improve, and fetching one would invite somebody to use it.
    .select('id, subject_id, academic_year_id, subject:subjects(code)')
    .in('id', subjectConfigIds)
    .eq('academic_year_id', section.academic_year_id);
  const configs = (configRows ?? []) as Array<{
    id: string;
    subject_id: string;
    academic_year_id: string;
    subject:
      | { code: string; name: string }
      | { code: string; name: string }[]
      | null;
  }>;
  if (configs.length === 0) {
    return NextResponse.json(
      {
        error: "None of those subjects are configured for this section's AY",
      },
      { status: 422 }
    );
  }

  // Attaching declares these subjects apply at this section's level —
  // ensure the offering rows exist rather than 422ing on a step the
  // simplified page has no separate UI for (idempotent upsert, never
  // touches an existing row for a different subject/level).
  const { error: offeringErr } = await service
    .from('subject_level_offerings')
    .upsert(
      configs.map((c) => ({
        subject_id: c.subject_id,
        level_id: section.level_id,
        academic_year_id: section.academic_year_id,
      })),
      {
        onConflict: 'subject_id,level_id,academic_year_id',
        ignoreDuplicates: true,
      }
    );
  if (offeringErr) {
    return NextResponse.json({ error: offeringErr.message }, { status: 500 });
  }

  const { data: existing } = await service
    .from('section_subjects')
    .select('subject_config_id')
    .eq('section_id', sectionId);
  const existingIds = new Set(
    ((existing ?? []) as Array<{ subject_config_id: string }>).map(
      (r) => r.subject_config_id
    )
  );
  const missing = configs.filter((c) => !existingIds.has(c.id));

  let inserted = 0;
  if (missing.length > 0) {
    const { error: insertErr } = await service.from('section_subjects').insert(
      missing.map((c) => ({
        section_id: sectionId,
        subject_config_id: c.id,
      }))
    );
    if (insertErr) {
      // 23505 = unique_violation — a concurrent identical request beat us to
      // one of these rows. The JS pre-check above cannot prevent that (both
      // requests read the same "already attached" snapshot before either
      // wrote), so tolerate it as a partial success rather than surfacing a
      // raw 500 for what is really a no-op. Mirrors applyTrackBundle in
      // lib/sis/section-track.ts, which has handled this correctly all along.
      if ((insertErr as { code?: string }).code !== '23505') {
        return NextResponse.json({ error: insertErr.message }, { status: 500 });
      }
    }
    inserted = missing.length;
  }

  let sheetsInserted = 0;
  if (inserted > 0) {
    const { data: bulkResult, error: bulkErr } = await service.rpc(
      'create_grading_sheets_for_section',
      { p_section_id: sectionId }
    );
    if (bulkErr) {
      console.error(
        '[sections/[id]/subjects/attach-many POST] bulk-sheet RPC failed:',
        bulkErr.message
      );
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
      actor: {
        id: auth.user.id,
        email: auth.user.email ?? null,
        role: auth.role,
      },
      action: 'section.subjects.attach_many',
      entityType: 'section',
      entityId: sectionId,
      context: {
        sectionName: section.name,
        subjectCodes: missing.map((c) => {
          const s = Array.isArray(c.subject) ? c.subject[0] : c.subject;
          return s?.code ?? null;
        }),
        inserted,
        sheetsInserted,
      },
    });
    if (ayCode) invalidateDrillTags('markbook', ayCode);
  }

  return NextResponse.json({ ok: true, inserted, sheetsInserted });
}
