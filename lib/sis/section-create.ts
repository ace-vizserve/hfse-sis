import type { SupabaseClient } from '@supabase/supabase-js';

import {
  getCurrentAcademicYear,
  getUpcomingAcademicYear,
  type CurrentAcademicYear,
} from '@/lib/academic-year';
import type { SectionClassType } from '@/lib/schemas/section';
import { applyTrackBundle } from '@/lib/sis/section-track';

// The year a section may be created in. No ?ay= means the current year, as
// it always did. Otherwise only the current year or the upcoming one (taking
// applications): admissions places next year's children before that year is
// current, and a section added to a closed year is far likelier a mistake
// than a need.
export async function resolveSectionTargetAy(
  requested: string | null
): Promise<{ ay: CurrentAcademicYear } | { error: string; status: number }> {
  const [current, upcoming] = await Promise.all([
    getCurrentAcademicYear(),
    getUpcomingAcademicYear(),
  ]);
  const ay = !requested
    ? current
    : [current, upcoming].find((y) => y?.ay_code === requested);
  if (ay) return { ay };
  return requested
    ? {
        error: `Sections can only be added to the current or upcoming academic year, not ${requested}.`,
        status: 400,
      }
    : { error: 'no current academic year', status: 500 };
}

// What happens to a section right after its row is inserted — shared by
// POST /api/sections (one section by hand) and POST /api/sections/copy (a
// year's worth at once), so a copied section comes out exactly like one
// created by hand.
//
// The section starts with zero subjects attached — no level-wide default
// seeding happens here. The registrar attaches what applies, explicitly,
// via the Section Subjects panel (or, for Secondary, by flagging the
// section's track). Track bundle-apply is the only automatic attachment:
// when the section is flagged Global/Standard, attach that track's static
// subject bundle now.
//
// Then bulk-create the grading sheets that should exist for the section (one
// per subject in the level × every term in the AY). Best-effort — if either
// step fails the section is kept and the hiccup is returned for the audit
// row; the registrar can run "Create all sheets" on /markbook/grading as a
// fallback.
export type NewSectionFollowUp = {
  trackBundleInserted: number;
  trackBundleError: string | null;
  sheetsInserted: number;
  sheetsError: string | null;
};

export async function finishNewSection(
  service: SupabaseClient,
  {
    sectionId,
    academicYearId,
    classType,
  }: {
    sectionId: string;
    academicYearId: string;
    classType: SectionClassType | null;
  }
): Promise<NewSectionFollowUp> {
  let trackBundleInserted = 0;
  let trackBundleError: string | null = null;
  if (classType) {
    try {
      const bundleResult = await applyTrackBundle(service, {
        sectionId,
        academicYearId,
        classType,
      });
      trackBundleInserted = bundleResult.inserted;
    } catch (e) {
      trackBundleError = e instanceof Error ? e.message : String(e);
      console.error('[sections] track bundle-apply failed:', trackBundleError);
    }
  }

  let sheetsInserted = 0;
  const { data: bulkResult, error: bulkErr } = await service.rpc(
    'create_grading_sheets_for_section',
    { p_section_id: sectionId }
  );
  if (bulkErr) {
    console.error('[sections] bulk-sheet RPC failed:', bulkErr.message);
  } else if (
    bulkResult &&
    typeof bulkResult === 'object' &&
    'inserted' in bulkResult
  ) {
    sheetsInserted = Number(
      (bulkResult as { inserted: unknown }).inserted ?? 0
    );
  }

  return {
    trackBundleInserted,
    trackBundleError,
    sheetsInserted,
    sheetsError: bulkErr?.message ?? null,
  };
}
