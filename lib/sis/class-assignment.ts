import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveLevelId } from '@/lib/sis/levels';

// Max active students per section. Mirrors Hard Rule #5. Kept as a local
// constant so this helper is self-contained without pulling a central
// constants module.
const MAX_ACTIVE_PER_SECTION = 50;

export type ClassAssignment = {
  section_id: string;
  classLevel: string;
  classSection: string;
};

export type ClassAssignmentError = {
  error: string;
};

type ApplicationLite = {
  levelApplied: string | null;
  classType: string | null;
  preferredSchedule: string | null;
};

/**
 * Picks the best section for a newly-enrolled applicant.
 *
 * Algorithm:
 *   1. Resolve the AY + level. Refuse if levelApplied doesn't match any level.
 *   2. Load sections at that level with their active-enrolment counts.
 *   3. Filter out sections at capacity (< 50 active per Hard Rule #5).
 *   4. Score remaining sections on classType + preferredSchedule matching.
 *   5. Pick highest score, tiebreaker = least-loaded, then alphabetical name.
 *
 * Scoring (higher is better):
 *   - classType exact match (case-insensitive):               +10
 *   - classType both null (neutral):                          +3
 *   - classType one-sided null:                               +1
 *   - classType set on both but different:                    +0
 *   - preferredSchedule matches section.schedule (structured):  +5
 *       · `whole_day` sections satisfy ANY preference (no AM/PM split).
 *       · when section.schedule is null (legacy / not-yet-applied), falls back
 *         to the old name/class_type substring grep so those AYs don't regress.
 *
 * Schedule is a SOFT preference; capacity (step 3) is hard. A full preferred
 * section is dropped before scoring, so the applicant lands in the best
 * available section rather than overfilling or hard-failing.
 */
export async function pickSectionForApplicant(
  service: SupabaseClient,
  ayCode: string,
  application: ApplicationLite
): Promise<ClassAssignment | ClassAssignmentError> {
  if (!application.levelApplied) {
    return {
      error: 'Application has no levelApplied value — cannot assign class',
    };
  }

  // 1. Resolve AY + level.
  const { data: ayRow, error: ayErr } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode)
    .maybeSingle();
  if (ayErr || !ayRow) {
    return { error: `Academic year ${ayCode} not found` };
  }
  const ayId = (ayRow as { id: string }).id;

  // Resolves canonical labels, the legacy digit-form fallback, AND any
  // staff-defined alias for a portal naming variant (migration 088, KD
  // level-alias reconciliation). A null here means genuinely unresolved —
  // the applicant surfaces in /records/level-mismatches for a registrar to
  // map once, which then resolves every future application with the same
  // raw string automatically.
  const levelId = await resolveLevelId(service, application.levelApplied);
  if (!levelId) {
    return { error: `Level ${application.levelApplied} has no section` };
  }
  const { data: levelRow, error: levelErr } = await service
    .from('levels')
    .select('id, code, label')
    .eq('id', levelId)
    .maybeSingle();
  if (levelErr || !levelRow) {
    return { error: `Level ${application.levelApplied} has no section` };
  }
  const level = levelRow as { id: string; code: string; label: string };

  // 2. Load sections + active counts.
  const { data: sectionRows, error: sectionsErr } = await service
    .from('sections')
    .select('id, name, class_type, schedule')
    .eq('academic_year_id', ayId)
    .eq('level_id', level.id);
  if (sectionsErr) {
    return { error: `Section lookup failed: ${sectionsErr.message}` };
  }
  const sections = (sectionRows ?? []) as Array<{
    id: string;
    name: string;
    class_type: string | null;
    schedule: string | null;
  }>;
  if (sections.length === 0) {
    return { error: `No sections configured at ${level.label} for ${ayCode}` };
  }

  const sectionIds = sections.map((s) => s.id);
  const { data: enrolmentRows, error: enrErr } = await service
    .from('section_students')
    .select('section_id')
    .eq('enrollment_status', 'active')
    .in('section_id', sectionIds);
  if (enrErr) {
    return { error: `Enrolment count lookup failed: ${enrErr.message}` };
  }
  const activeCountBySection = new Map<string, number>();
  for (const row of (enrolmentRows ?? []) as Array<{ section_id: string }>) {
    activeCountBySection.set(
      row.section_id,
      (activeCountBySection.get(row.section_id) ?? 0) + 1
    );
  }

  // 3. Capacity filter.
  const candidates = sections
    .map((s) => ({ ...s, activeCount: activeCountBySection.get(s.id) ?? 0 }))
    .filter((s) => s.activeCount < MAX_ACTIVE_PER_SECTION);
  if (candidates.length === 0) {
    return {
      error: `All sections at ${level.label} are at capacity (${MAX_ACTIVE_PER_SECTION} active)`,
    };
  }

  // 4. Score.
  const scored = candidates.map((s) => ({
    ...s,
    score: scoreSection(s, application),
  }));

  // 5. Sort + pick.
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.activeCount - b.activeCount ||
      a.name.localeCompare(b.name)
  );
  const winner = scored[0];

  // Write back the WORD-form label to `classLevel` to match migration 029's
  // post-state on `ay{YY}_enrolment_status.classLevel`. Writing the short
  // code here would silently corrupt the data shape for every downstream
  // consumer that expects "Primary One"/"Secondary Two"/etc.
  return {
    section_id: winner.id,
    classLevel: level.label,
    classSection: winner.name,
  };
}

export function scoreSection(
  section: { name: string; class_type: string | null; schedule: string | null },
  app: ApplicationLite
): number {
  let score = 0;

  // classType match.
  const secType = section.class_type?.trim().toLowerCase() ?? '';
  const appType = app.classType?.trim().toLowerCase() ?? '';
  if (secType && appType) {
    if (secType === appType) score += 10;
    // both set, different → 0
  } else if (!secType && !appType) {
    score += 3;
  } else {
    score += 1;
  }

  // preferredSchedule match. `app.preferredSchedule` is the human form
  // ('Morning' / 'Afternoon' / 'Whole Day'); `section.schedule` is the
  // normalized enum ('morning' / 'afternoon' / 'whole_day').
  const rawPref = app.preferredSchedule?.trim().toLowerCase() ?? '';
  if (rawPref) {
    const secSched = section.schedule?.trim().toLowerCase() ?? '';
    if (secSched) {
      // Structured match: normalize the preference's spaces to underscores
      // ('whole day' → 'whole_day'). A whole-day section has no AM/PM split, so
      // it satisfies ANY preference.
      const pref = rawPref.replace(/\s+/g, '_');
      if (secSched === pref || secSched === 'whole_day') score += 5;
    } else {
      // Fallback for sections without a structured schedule (legacy AYs, or any
      // not yet re-applied from the template): the old name/class_type grep,
      // using the raw space-form preference to match names like "… | Morning".
      const haystack =
        `${section.name} ${section.class_type ?? ''}`.toLowerCase();
      if (haystack.includes(rawPref)) score += 5;
    }
  }

  return score;
}
