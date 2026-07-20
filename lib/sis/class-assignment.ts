import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveLevelId } from '@/lib/sis/levels';

// Section-assignment support — level/section lookups shared by every place
// a section gets assigned to a student. Per
// docs/superpowers/specs/2026-07-20-manual-section-assignment-design.md,
// there is deliberately no auto-pick anywhere in the system: this module
// only surfaces state (which sections exist, how full each is); a
// registrar always makes the actual choice. Consolidates what used to be
// three independent implementations (this file's old auto-pick,
// records-lite-page.tsx's private loadAvailableSections, and three
// separate hardcoded copies of the 50-student cap).

export const MAX_ACTIVE_PER_SECTION = 50;

export type AssignableSection = {
  id: string;
  name: string;
  activeCount: number;
};

export type AssignableLevel = {
  id: string;
  code: string;
  label: string;
  levelType: 'primary' | 'secondary';
};

/**
 * Every section at the applicant's level, with live active headcounts.
 * Returns every section regardless of capacity — callers (the picker UI)
 * show full sections as disabled rather than hiding them, so the registrar
 * has full visibility into state before deciding. `level` is null when the
 * raw label doesn't resolve (canonical, legacy digit-form, or alias) —
 * callers should point the registrar at /records/level-mismatches in that
 * case rather than showing an empty section list.
 */
export async function listAssignableSections(
  service: SupabaseClient,
  ayCode: string,
  levelApplied: string | null
): Promise<{ level: AssignableLevel | null; sections: AssignableSection[] }> {
  if (!levelApplied) return { level: null, sections: [] };

  const { data: ayRow } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode)
    .maybeSingle();
  if (!ayRow) return { level: null, sections: [] };
  const ayId = (ayRow as { id: string }).id;

  const levelId = await resolveLevelId(service, levelApplied);
  if (!levelId) return { level: null, sections: [] };

  const { data: levelRow } = await service
    .from('levels')
    .select('id, code, label, level_type')
    .eq('id', levelId)
    .maybeSingle();
  if (!levelRow) return { level: null, sections: [] };
  const level: AssignableLevel = {
    id: (levelRow as { id: string }).id,
    code: (levelRow as { code: string }).code,
    label: (levelRow as { label: string }).label,
    levelType: (levelRow as { level_type: 'primary' | 'secondary' }).level_type,
  };

  const { data: sectionRows } = await service
    .from('sections')
    .select('id, name')
    .eq('academic_year_id', ayId)
    .eq('level_id', levelId);
  const sections = (sectionRows ?? []) as Array<{ id: string; name: string }>;
  if (sections.length === 0) return { level, sections: [] };

  const sectionIds = sections.map((s) => s.id);
  const { data: activeRows } = await service
    .from('section_students')
    .select('section_id')
    .eq('enrollment_status', 'active')
    .in('section_id', sectionIds);
  const activeCountById = new Map<string, number>();
  for (const r of (activeRows ?? []) as Array<{ section_id: string }>) {
    activeCountById.set(
      r.section_id,
      (activeCountById.get(r.section_id) ?? 0) + 1
    );
  }

  return {
    level,
    sections: sections
      .map((s) => ({
        id: s.id,
        name: s.name,
        activeCount: activeCountById.get(s.id) ?? 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/**
 * Server-side validation for a registrar-chosen section — shared by the
 * assign-section route and the stage route's Enrolled-flip. Confirms the
 * section exists, belongs to the given AY, matches the applicant's level
 * (when `expectedLevelApplied` is supplied), and isn't at capacity at write
 * time (a second student could fill it between page-load and confirm).
 */
export async function validateSectionChoice(
  service: SupabaseClient,
  sectionId: string,
  ayCode: string,
  expectedLevelApplied?: string | null
): Promise<
  | {
      section: {
        id: string;
        name: string;
        levelId: string;
        levelLabel: string;
      };
    }
  | { error: string }
> {
  const { data: sectionRow, error: sectionErr } = await service
    .from('sections')
    .select(
      'id, name, level_id, levels!inner(label), academic_years!inner(ay_code)'
    )
    .eq('id', sectionId)
    .maybeSingle();
  if (sectionErr)
    return { error: `Section lookup failed: ${sectionErr.message}` };
  if (!sectionRow) return { error: 'Section not found' };

  const row = sectionRow as unknown as {
    id: string;
    name: string;
    level_id: string;
    levels: { label: string } | null;
    academic_years: { ay_code: string } | null;
  };
  if (row.academic_years?.ay_code !== ayCode) {
    return { error: 'Section does not belong to this academic year' };
  }
  if (!row.levels?.label) {
    return { error: 'Section has no level label' };
  }

  if (expectedLevelApplied != null && expectedLevelApplied.trim()) {
    const expectedLevelId = await resolveLevelId(service, expectedLevelApplied);
    if (!expectedLevelId) {
      return {
        error: `The applicant's level ("${expectedLevelApplied}") isn't recognized — resolve it at /records/level-mismatches before assigning a section.`,
      };
    }
    if (expectedLevelId !== row.level_id) {
      return {
        error: `This section's level doesn't match the applicant's level (${expectedLevelApplied}).`,
      };
    }
  }

  const { count, error: countErr } = await service
    .from('section_students')
    .select('*', { count: 'exact', head: true })
    .eq('section_id', sectionId)
    .eq('enrollment_status', 'active');
  if (countErr) return { error: `Capacity check failed: ${countErr.message}` };
  if ((count ?? 0) >= MAX_ACTIVE_PER_SECTION) {
    return { error: 'This section is at capacity (50 students)' };
  }

  return {
    section: {
      id: row.id,
      name: row.name,
      levelId: row.level_id,
      levelLabel: row.levels.label,
    },
  };
}
