import type { OverviewFilterSelect } from '@/components/markbook/overview-filter-bar';
import type { AcademicOverview } from '@/lib/markbook/academic-overview-compute';
import type { AwardsOverview } from '@/lib/markbook/awards-overview-compute';

// The filter sets for the school-wide Markbook pages, in one file so the shared
// axes cannot drift apart.
//
// Both pages read AY · Term · Grade level · Class. They differ in the fifth:
// Academic Summary narrows by Subject, Awards by Award category. The order is
// the same on both because a control that moves between pages is a control
// people have to re-find.

/** Class hangs off Grade level, so changing the level always drops the class. */
const CLASS_PARAM = 'class';

function scopeSelects(
  options: {
    levels: { id: string; label: string }[];
    sections: { id: string; name: string; levelId: string }[];
    terms: { termNumber: number; label: string }[];
  },
  filters: {
    levelId: string | null;
    sectionId: string | null;
    termNumber: number | null;
  }
): OverviewFilterSelect[] {
  // A class list is per level, so once a level is chosen the picker must show
  // only that level's classes — otherwise it offers a scope with no rows.
  const sectionsForLevel = filters.levelId
    ? options.sections.filter((s) => s.levelId === filters.levelId)
    : options.sections;

  return [
    {
      param: 'term',
      label: 'Term',
      value: filters.termNumber == null ? null : String(filters.termNumber),
      allLabel: 'All terms',
      widthClass: 'w-[160px]',
      options: options.terms.map((t) => ({
        value: String(t.termNumber),
        label: `Term ${t.termNumber}`,
      })),
    },
    {
      param: 'level',
      label: 'Grade level',
      chipPrefix: 'Grade level',
      value: filters.levelId,
      allLabel: 'All grade levels',
      clears: [CLASS_PARAM],
      options: options.levels.map((l) => ({ value: l.id, label: l.label })),
    },
    {
      param: CLASS_PARAM,
      label: 'Class',
      value: filters.sectionId,
      allLabel: 'All classes',
      widthClass: 'w-[190px]',
      disabled: sectionsForLevel.length === 0,
      options: sectionsForLevel.map((s) => ({ value: s.id, label: s.name })),
    },
  ];
}

export function academicSummarySelects(
  options: AcademicOverview['filterOptions'],
  filters: AcademicOverview['filters']
): OverviewFilterSelect[] {
  return [
    ...scopeSelects(options, filters),
    {
      param: 'subject',
      label: 'Subject',
      value: filters.subjectId,
      allLabel: 'All subjects',
      options: options.subjects.map((s) => ({ value: s.id, label: s.name })),
    },
  ];
}

export function awardsSelects(
  options: AwardsOverview['filterOptions'],
  filters: AwardsOverview['filters']
): OverviewFilterSelect[] {
  return [
    ...scopeSelects(options, filters),
    {
      // No `allLabel`: an award is always ONE ladder. "All award categories"
      // would mean averaging the Overall Academic Award together with each
      // Subject Award, which is not a quantity the school has ever defined.
      // Because it always carries a value it is scope, not a filter, so it
      // never shows as a removable chip.
      param: 'category',
      label: 'Award category',
      value: filters.category,
      widthClass: 'w-[230px]',
      options: options.categories.map((c) => ({
        value: c.id,
        label: c.label,
      })),
    },
  ];
}
