// The parent portal's year picker (`GET /api/parent/v2/academic-years`).
//
// Pure shaping only — no Supabase, no cache — so the rule for which years a
// parent may see is testable on its own. The loader lives in
// `parent-academic-years-loader.ts`.
//
// A year is listed when EITHER programme is open for it: HFSE through
// `accepting_applications` (KD #77/#118 — the current year is always open),
// VizSchool through `vizschool_accepting_applications` (migration 176). Test
// years (`AY9…`) are never listed, whatever their flags say.

/** The cache tag every writer of either flag, or of `is_current`, busts. */
export const PARENT_ACADEMIC_YEARS_TAG = 'parent-academic-years';

export type AcademicYearFlagsRow = {
  ay_code: string;
  is_current: boolean;
  accepting_applications: boolean;
  vizschool_accepting_applications: boolean;
};

export type ParentAcademicYear = {
  ayCode: string;
  isCurrent: boolean;
  /** HFSE parents can apply for this year. */
  hfseOpen: boolean;
  /** VizSchool parents can apply for this year. */
  vizschoolOpen: boolean;
};

function isTestYear(ayCode: string): boolean {
  return /^AY9/i.test(ayCode);
}

/**
 * The years a parent may apply for, oldest first. Unknown extra columns on the
 * row never reach the output — only the four named fields go out.
 */
export function toParentAcademicYears(
  rows: ReadonlyArray<AcademicYearFlagsRow>
): ParentAcademicYear[] {
  return rows
    .filter(
      (r) =>
        !isTestYear(r.ay_code) &&
        (r.accepting_applications || r.vizschool_accepting_applications)
    )
    .map((r) => ({
      ayCode: r.ay_code,
      isCurrent: r.is_current,
      hfseOpen: r.accepting_applications,
      vizschoolOpen: r.vizschool_accepting_applications,
    }))
    .sort((a, b) => (a.ayCode < b.ayCode ? -1 : a.ayCode > b.ayCode ? 1 : 0));
}
