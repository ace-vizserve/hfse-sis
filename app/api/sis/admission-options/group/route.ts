import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

import type { AdmissionTrack } from '@/lib/admissions/options';
import { admissionOptionsTag } from '@/lib/admissions/options-loader';
import {
  ensureLevelAliasForOption,
  findAcademicYear,
  recountLevelNameForOption,
} from '@/lib/admissions/options-write';
import { getCurrentAcademicYear } from '@/lib/academic-year';
import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { ENROLMENT_PLACEMENT_WRITERS } from '@/lib/auth/student-record';
import { invalidateAllOperationalDrills } from '@/lib/cache/invalidate-drill-tags';
import { AdmissionOptionGroupEditSchema } from '@/lib/schemas/admission-options';
import { createServiceClient } from '@/lib/supabase/service';

// PATCH /api/sis/admission-options/group
// Body: { ayCode, fromLevelLabel, fromClassTypeLabel,
//         levelLabel, levelId, classTypeLabel, track }
//
// Edits one (level name, class type) combination for a year — every session
// row it has changes together, so Morning and Afternoon can never drift apart
// on what they are called or which level they count as. Whether each session
// is open is untouched; that is the switch's job (./[id]/route.ts).
//
// A renamed level name is recorded as a level alias exactly as a new one is,
// and refused with 409 when it already means a different level. The OLD name's
// alias is left in place: past applications still carry it (plan: "level_aliases
// is not retired").
//
// Keeping the name and changing "Counts as" is the correction case: every
// option carrying the name, in every year, moves to the new level and the
// name's alias is re-pointed (audited `level.alias.remap`). Refused only when
// the name is a level's own label — see recountLevelNameForOption.
export async function PATCH(request: Request) {
  const auth = await requireRole([...ENROLMENT_PLACEMENT_WRITERS]);
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = AdmissionOptionGroupEditSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const {
    ayCode,
    fromLevelLabel,
    fromClassTypeLabel,
    levelLabel,
    levelId,
    classTypeLabel,
    track,
  } = parsed.data;

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

  const { data: existing, error: readErr } = await service
    .from('admission_options')
    .select('id, level_id, track, levels(label)')
    .eq('academic_year_id', ay.id)
    .eq('level_label', fromLevelLabel)
    .eq('class_type_label', fromClassTypeLabel);
  if (readErr) {
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }
  const rows = (existing ?? []) as unknown as Array<{
    id: string;
    level_id: string;
    track: AdmissionTrack;
    levels: { label: string } | { label: string }[] | null;
  }>;
  if (rows.length === 0) {
    return NextResponse.json(
      { error: 'That option no longer exists. Reload the page.' },
      { status: 404 }
    );
  }

  const first = rows[0];
  const prevLevel = Array.isArray(first.levels)
    ? first.levels[0]
    : first.levels;
  const renamed =
    levelLabel !== fromLevelLabel || classTypeLabel !== fromClassTypeLabel;
  const unchanged =
    !renamed && rows.every((r) => r.level_id === levelId && r.track === track);
  if (unchanged) return NextResponse.json({ ok: true, changed: false });

  // Renaming onto a combination the year already has would collide on the
  // unique key halfway through; say so plainly instead.
  if (renamed) {
    const { data: clash, error: clashErr } = await service
      .from('admission_options')
      .select('id')
      .eq('academic_year_id', ay.id)
      .eq('level_label', levelLabel)
      .eq('class_type_label', classTypeLabel)
      .limit(1);
    if (clashErr) {
      return NextResponse.json({ error: clashErr.message }, { status: 500 });
    }
    if ((clash ?? []).length > 0) {
      return NextResponse.json(
        {
          error: `"${levelLabel}" with "${classTypeLabel}" is already on the forms for ${ayCode}. Choose a different name.`,
          code: 'duplicate_admission_option',
        },
        { status: 409 }
      );
    }
  }

  // Same name, different "Counts as": the correction case. What a name counts
  // as is global (one alias per name), so EVERY option carrying the name — any
  // year, any class type — moves to the new level and the alias is re-pointed.
  // Refused only when the name is a level's own label (lib/admissions/options.ts,
  // planCountsAsChange). Every other edit takes the ordinary path.
  const recount =
    levelLabel === fromLevelLabel && rows.some((r) => r.level_id !== levelId);
  const recounted = recount
    ? await recountLevelNameForOption(service, {
        label: levelLabel,
        newLevelId: levelId,
        actor,
      })
    : null;
  const alias =
    recounted ??
    (await ensureLevelAliasForOption(service, levelLabel, levelId, actor));
  if (!alias.ok) {
    return NextResponse.json(
      { error: alias.error, code: 'level_name_taken' },
      { status: alias.status }
    );
  }

  const { error: updErr } = await service
    .from('admission_options')
    .update({
      level_label: levelLabel,
      level_id: levelId,
      class_type_label: classTypeLabel,
      track,
    })
    .in(
      'id',
      rows.map((r) => r.id)
    );
  if (updErr) {
    if (updErr.code === '23505') {
      return NextResponse.json(
        {
          error: `"${levelLabel}" with "${classTypeLabel}" is already on the forms for ${ayCode}. Choose a different name.`,
          code: 'duplicate_admission_option',
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  await logAction({
    service,
    actor,
    action: 'admission_option.update',
    entityType: 'academic_year',
    entityId: ay.id,
    context: {
      ay_code: ayCode,
      from_level_label: fromLevelLabel,
      from_class_type_label: fromClassTypeLabel,
      level_label: levelLabel,
      class_type_label: classTypeLabel,
      counts_as_label: alias.level.label,
      counts_as_code: alias.level.code,
      previous_counts_as_label: prevLevel?.label ?? null,
      track,
      previous_track: first.track,
      option_ids: rows.map((r) => r.id),
      ...(recounted?.ok
        ? {
            recount_rows_updated: recounted.rowsUpdated,
            recount_ay_codes: recounted.touchedAyCodes,
          }
        : {}),
    },
  });

  revalidateTag(admissionOptionsTag(ayCode), 'max');
  // A re-count moves rows in other years too; each of those years' endpoint
  // answers is now stale.
  if (recounted?.ok) {
    for (const code of recounted.touchedAyCodes) {
      if (code && code !== ayCode) {
        revalidateTag(admissionOptionsTag(code), 'max');
      }
    }
  }
  if (alias.created) {
    const current = await getCurrentAcademicYear();
    if (current) await invalidateAllOperationalDrills(current.ay_code);
  }

  return NextResponse.json({ ok: true, changed: true });
}
