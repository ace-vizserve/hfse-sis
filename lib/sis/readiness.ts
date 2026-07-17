import { unstable_cache } from 'next/cache';
import { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase/service';
import { getLevelRows } from '@/lib/sis/levels';
import { computeSubjectConfigGaps } from '@/lib/sis/subject-config-gaps';

// Order matches the user-approved 10-step AY-Setup workflow: Academic Year
// -> Calendar -> Sections -> Subject Weights -> Form Advisers -> Section
// Subjects -> Grading Sheets -> Virtue Themes -> Report-card Letterhead,
// with 'app-window' (early-bird applications) as the lone optional item
// after the core 9. The 'grade-levels' step (matching applicant-named
// levels to the catalog) was removed by migration 086 alongside the whole
// Grade Levels admin page — the level catalog is now a fixed 10 core
// levels (P1-P6, S1-S4), nothing to reconcile against applicant demand.
//
// 'sections' and 'subject-weights' are a split/decouple of an older single
// 'classes' step: 'sections' asks "does every grade level have at least one
// class section," while 'subject-weights' asks "is every grade level fully
// configured against Structure Defaults" — a genuinely independent,
// parallel task that no longer depends on sections existing (a registrar
// can configure subject weights before creating a section).
export type ReadinessStepId =
  | 'ay-setup'
  | 'calendar'
  | 'sections'
  | 'subject-weights'
  | 'advisers'
  | 'section-subjects'
  | 'grading-sheets'
  | 'virtue-themes'
  | 'letterhead'
  | 'app-window';

export type ReadinessStatus = 'done' | 'partial' | 'not_started';

export type ReadinessStep = {
  id: ReadinessStepId;
  step: number;
  label: string;
  description: string;
  href: string;
  status: ReadinessStatus;
  required: boolean;
  fraction?: { done: number; total: number };
};

export type AyReadiness = {
  ayCode: string;
  steps: ReadinessStep[];
  complete: number;
  total: number;
};

// STEP_META table (drives all step metadata)
const STEP_META: Record<
  ReadinessStepId,
  Omit<ReadinessStep, 'status' | 'fraction'>
> = {
  'ay-setup': {
    id: 'ay-setup',
    step: 1,
    label: 'Academic year & term dates',
    description: 'Set up the academic year with term start/end dates',
    href: '/sis/ay-setup',
    required: true,
  },
  calendar: {
    id: 'calendar',
    step: 2,
    label: 'School calendar',
    description: 'Add school calendar events and day types',
    href: '/sis/calendar',
    required: true,
  },
  sections: {
    id: 'sections',
    step: 3,
    label: 'Sections',
    description:
      'Create at least one class section for each grade level in use',
    href: '/sis/sections',
    required: true,
  },
  'subject-weights': {
    id: 'subject-weights',
    step: 4,
    label: 'Subject weights',
    description: 'Attach subjects and weights to every grade level in use',
    href: '/sis/admin/subjects',
    required: true,
  },
  advisers: {
    id: 'advisers',
    step: 5,
    label: 'Form advisers',
    description: 'Assign form class advisers',
    href: '/sis/sections',
    required: true,
  },
  'section-subjects': {
    id: 'section-subjects',
    step: 6,
    label: 'Section subjects',
    description: 'Confirm which subjects each section teaches',
    href: '/sis/sections',
    required: true,
  },
  'grading-sheets': {
    id: 'grading-sheets',
    step: 7,
    label: 'Grading sheets',
    description: 'Create grading sheets for all sections',
    href: '/markbook/sections',
    required: true,
  },
  'virtue-themes': {
    id: 'virtue-themes',
    step: 8,
    label: 'Virtue themes',
    description: 'Set virtue themes for each term',
    href: '/evaluation/virtue-themes',
    required: true,
  },
  letterhead: {
    id: 'letterhead',
    step: 9,
    label: 'Report-card letterhead',
    description: 'Configure school letterhead and branding',
    href: '/sis/admin/school-config',
    required: true,
  },
  'app-window': {
    id: 'app-window',
    step: 10,
    label: 'Application window',
    description: 'Open early-bird application window (optional)',
    href: '/sis/ay-setup',
    required: false,
  },
};

// Pure resolvers

export function resolveAySetupStep(input: {
  datedTermCount: number;
  totalTermCount: number;
}): ReadinessStep {
  const { datedTermCount, totalTermCount } = input;
  let status: ReadinessStatus;
  let fraction: { done: number; total: number } | undefined;

  if (totalTermCount === 0) {
    status = 'not_started';
  } else if (datedTermCount === totalTermCount) {
    status = 'done';
    fraction = { done: datedTermCount, total: totalTermCount };
  } else if (datedTermCount > 0) {
    status = 'partial';
    fraction = { done: datedTermCount, total: totalTermCount };
  } else {
    status = 'not_started';
    fraction = { done: 0, total: totalTermCount };
  }

  return {
    ...STEP_META['ay-setup'],
    status,
    fraction,
  };
}

export function resolveCalendarStep(input: {
  totalTerms: number;
  coveredTerms: number;
}): ReadinessStep {
  const { totalTerms, coveredTerms } = input;
  let status: ReadinessStatus;
  let fraction: { done: number; total: number } | undefined;

  if (totalTerms === 0) {
    status = 'not_started';
  } else if (coveredTerms === totalTerms) {
    status = 'done';
    fraction = { done: coveredTerms, total: totalTerms };
  } else if (coveredTerms > 0) {
    status = 'partial';
    fraction = { done: coveredTerms, total: totalTerms };
  } else {
    status = 'not_started';
    fraction = { done: 0, total: totalTerms };
  }

  return {
    ...STEP_META['calendar'],
    status,
    fraction,
  };
}

// "Done" once every grade level (the fixed 10-level catalog) has at least
// one class section for this AY. Sections are a prerequisite the registrar
// can't skip, but whether they've been created yet is a distinct question
// from whether the levels are correctly configured — see
// resolveSubjectWeightsStep below, which used to fold
// this section-existence question into its own fraction (the bug this
// split closes: with 0 sections, subject weights silently read as
// not_started even when the weights themselves were fully configured).
export function resolveSectionsStep(input: {
  relevantLevelCount: number;
  levelsWithSectionCount: number;
}): ReadinessStep {
  const { relevantLevelCount, levelsWithSectionCount } = input;
  let status: ReadinessStatus;
  let fraction: { done: number; total: number } | undefined;

  if (relevantLevelCount === 0) {
    status = 'not_started';
  } else if (levelsWithSectionCount === relevantLevelCount) {
    status = 'done';
    fraction = { done: levelsWithSectionCount, total: relevantLevelCount };
  } else {
    status = 'partial';
    fraction = { done: levelsWithSectionCount, total: relevantLevelCount };
  }

  return {
    ...STEP_META['sections'],
    status,
    fraction,
  };
}

// Decoupled from section existence (Task 5, migration-080 follow-up) — a
// registrar can configure subject weights before a single section exists,
// so `not_started` is gated on `levelsInUse === 0` alone (levelsInUse here
// = the relevant-level set, not a section-derived count).
export function resolveSubjectWeightsStep(input: {
  levelsInUse: number;
  levelsFullyConfigured: number;
  missingCount: number;
}): ReadinessStep {
  const { levelsInUse, levelsFullyConfigured } = input;
  let status: ReadinessStatus;
  let fraction: { done: number; total: number } | undefined;

  if (levelsInUse === 0) {
    status = 'not_started';
  } else if (levelsFullyConfigured === levelsInUse) {
    status = 'done';
    fraction = { done: levelsFullyConfigured, total: levelsInUse };
  } else if (levelsFullyConfigured > 0) {
    status = 'partial';
    fraction = { done: levelsFullyConfigured, total: levelsInUse };
  } else {
    status = 'not_started';
    fraction = { done: 0, total: levelsInUse };
  }

  return {
    ...STEP_META['subject-weights'],
    status,
    fraction,
  };
}

export function resolveAdvisersStep(input: {
  sectionCount: number;
  advisedSectionCount: number;
}): ReadinessStep {
  const { sectionCount, advisedSectionCount } = input;
  let status: ReadinessStatus;
  let fraction: { done: number; total: number } | undefined;

  if (sectionCount === 0) {
    status = 'not_started';
  } else if (advisedSectionCount === sectionCount) {
    status = 'done';
    fraction = { done: advisedSectionCount, total: sectionCount };
  } else if (advisedSectionCount > 0) {
    status = 'partial';
    fraction = { done: advisedSectionCount, total: sectionCount };
  } else {
    status = 'not_started';
    fraction = { done: 0, total: sectionCount };
  }

  return {
    ...STEP_META['advisers'],
    status,
    fraction,
  };
}

// "Done" once every section in the AY has at least one section_subjects
// row (migration 079). Every existing section was backfilled at migration
// time, so this is trivially done for AYs that predate the feature — it's
// meaningful for a freshly rolled-over AY whose sections haven't had
// "Load default subject set" run yet.
export function resolveSectionSubjectsStep(input: {
  totalSections: number;
  sectionsWithSubjects: number;
}): ReadinessStep {
  const { totalSections, sectionsWithSubjects } = input;
  let status: ReadinessStatus;
  const fraction = { done: sectionsWithSubjects, total: totalSections };

  if (totalSections === 0) {
    status = 'not_started';
  } else if (sectionsWithSubjects === totalSections) {
    status = 'done';
  } else if (sectionsWithSubjects > 0) {
    status = 'partial';
  } else {
    status = 'not_started';
  }

  return {
    ...STEP_META['section-subjects'],
    status,
    fraction,
  };
}

export function resolveGradingSheetsStep(input: {
  totalSections: number;
  sectionsWithSheets: number;
}): ReadinessStep {
  const { totalSections, sectionsWithSheets } = input;
  let status: ReadinessStatus;
  const fraction = { done: sectionsWithSheets, total: totalSections };

  if (totalSections === 0) {
    status = 'not_started';
  } else if (sectionsWithSheets === totalSections) {
    status = 'done';
  } else if (sectionsWithSheets > 0) {
    status = 'partial';
  } else {
    status = 'not_started';
  }

  return {
    ...STEP_META['grading-sheets'],
    status,
    fraction,
  };
}

export function resolveVirtueThemesStep(input: {
  termsRequiringTheme: number;
  termsWithTheme: number;
}): ReadinessStep {
  const { termsRequiringTheme, termsWithTheme } = input;
  let status: ReadinessStatus;
  let fraction: { done: number; total: number } | undefined;

  if (termsRequiringTheme === 0) {
    status = 'not_started';
  } else if (termsWithTheme >= termsRequiringTheme) {
    status = 'done';
    fraction = { done: termsWithTheme, total: termsRequiringTheme };
  } else if (termsWithTheme > 0) {
    status = 'partial';
    fraction = { done: termsWithTheme, total: termsRequiringTheme };
  } else {
    status = 'not_started';
    fraction = { done: 0, total: termsRequiringTheme };
  }

  return {
    ...STEP_META['virtue-themes'],
    status,
    fraction,
  };
}

export function resolveLetterheadStep(input: {
  hasOrgName: boolean;
  hasAddress: boolean;
}): ReadinessStep {
  const { hasOrgName, hasAddress } = input;
  let status: ReadinessStatus;

  if (hasOrgName && hasAddress) {
    status = 'done';
  } else if (hasOrgName || hasAddress) {
    status = 'partial';
  } else {
    status = 'not_started';
  }

  return {
    ...STEP_META['letterhead'],
    status,
  };
}

export function resolveAppWindowStep(input: {
  accepting: boolean;
}): ReadinessStep {
  const status = input.accepting ? 'done' : 'not_started';
  return {
    ...STEP_META['app-window'],
    status,
  };
}

// Aggregation helpers

export function buildReadiness(
  ayCode: string,
  steps: ReadinessStep[]
): AyReadiness {
  const required = steps.filter((s) => s.required);
  const complete = required.filter((s) => s.status === 'done').length;
  const total = required.length;

  return {
    ayCode,
    steps,
    complete,
    total,
  };
}

export function nextIncompleteStepId(steps: ReadinessStep[]): ReadinessStepId {
  const incomplete = steps.find((s) => s.required && s.status !== 'done');
  return incomplete?.id ?? steps[0].id;
}

// Fill color per status for the hub year-band's segmented bar — same color
// FAMILIES (mint done / amber partial / muted not_started) as the Year Setup
// checklist's `StatusTile` (`components/sis/year-setup/year-setup-checklist.tsx`),
// but NOT the same classes: the tiles use washed tints (`bg-brand-mint/30` etc.)
// that would be illegible on an 8px bar segment, so these are full-strength.
// Hand-kept in sync on the family level — if the checklist's status→color
// mapping ever changes, update this map in the same stroke.
export const READINESS_SEGMENT_CLASS: Record<ReadinessStatus, string> = {
  done: 'bg-brand-mint',
  partial: 'bg-brand-amber',
  not_started: 'bg-muted',
};

// Pure, unit-tested one-liner for the hub's year band — a plain-English
// headline + detail naming the next incomplete REQUIRED item. Kept here
// (colocated with AyReadiness) so the hub component stays presentational.
export function describeYearBandStatus(readiness: AyReadiness): {
  headline: string;
  detail: string;
} {
  const { complete, total, steps } = readiness;
  if (total === 0) {
    return {
      headline: 'No academic year set up yet.',
      detail: 'Create one to start setup.',
    };
  }
  if (complete === total) {
    return {
      headline: 'Year setup is complete.',
      detail: 'Every required item is configured for this year.',
    };
  }
  const nextStep = steps.find((s) => s.id === nextIncompleteStepId(steps));
  const label = nextStep?.label ?? 'the remaining items';
  if (complete === 0) {
    return {
      headline: "Year setup hasn't started yet.",
      detail: `Start with ${label}.`,
    };
  }
  if (complete === total - 1) {
    return {
      headline: 'Year setup is almost done.',
      detail: `${label} still needs attention.`,
    };
  }
  const pct = Math.round((complete / total) * 100);
  return {
    headline: `Year setup is ${pct}% done.`,
    detail: `Next up: ${label}.`,
  };
}

// DB fetchers (private async functions)

async function fetchAySetup(
  db: SupabaseClient,
  ayId: string
): Promise<{ datedTermCount: number; totalTermCount: number }> {
  const { count: totalTermCount, error: totalError } = await db
    .from('terms')
    .select('id', { count: 'exact', head: true })
    .eq('academic_year_id', ayId);

  if (totalError) throw totalError;

  const { count: datedTermCount, error: datedError } = await db
    .from('terms')
    .select('id', { count: 'exact', head: true })
    .eq('academic_year_id', ayId)
    .not('start_date', 'is', null)
    .not('end_date', 'is', null);

  if (datedError) throw datedError;

  return {
    datedTermCount: datedTermCount ?? 0,
    totalTermCount: totalTermCount ?? 0,
  };
}

async function fetchCalendar(
  db: SupabaseClient,
  ayId: string
): Promise<{ totalTerms: number; coveredTerms: number }> {
  // Get all term IDs for this AY
  const { data: terms, error: termsError } = await db
    .from('terms')
    .select('id')
    .eq('academic_year_id', ayId);

  if (termsError) throw termsError;
  const totalTerms = terms?.length ?? 0;

  if (totalTerms === 0) {
    return { totalTerms: 0, coveredTerms: 0 };
  }

  // Get distinct term_ids in school_calendar that match
  const termIds = terms!.map((t: any) => t.id);
  const { data: covered, error: coveredError } = await db
    .from('school_calendar')
    .select('term_id')
    .in('term_id', termIds);

  if (coveredError) throw coveredError;
  const coveredTerms = new Set((covered as any[])?.map((c: any) => c.term_id))
    .size;

  return { totalTerms, coveredTerms };
}

async function fetchSectionSubjects(
  db: SupabaseClient,
  ayId: string
): Promise<{ totalSections: number; sectionsWithSubjects: number }> {
  const { data: sections, error: sectionsError } = await db
    .from('sections')
    .select('id')
    .eq('academic_year_id', ayId);

  if (sectionsError) throw sectionsError;
  const totalSections = sections?.length ?? 0;

  if (totalSections === 0) {
    return { totalSections: 0, sectionsWithSubjects: 0 };
  }

  const sectionIds = sections!.map((s: any) => s.id);
  const { data: assigned, error: assignedError } = await db
    .from('section_subjects')
    .select('section_id')
    .in('section_id', sectionIds);

  if (assignedError) throw assignedError;
  const sectionsWithSubjects = new Set(
    (assigned as any[])?.map((a: any) => a.section_id)
  ).size;

  return { totalSections, sectionsWithSubjects };
}

// Shared by fetchSections + fetchSubjectWeights below — every level is now
// "relevant" (the fixed 10-level catalog is always in use, migration 086).
// Kept as its own function so both fetchers still share one query rather
// than duplicating it, even though there's no filtering left to do.
async function fetchRelevantLevels(
  db: SupabaseClient,
  _ayId: string
): Promise<Array<{ id: string; label: string }>> {
  const levels = await getLevelRows(db);
  return levels.map((l) => ({ id: l.id, label: l.label }));
}

// "Done" once every relevant level (see fetchRelevantLevels) has at least
// one class section for this AY. Split out of the old combined 'classes'
// step (Task 5) — this is purely "have sections been created," independent
// of whether those sections' subjects are correctly weighted.
async function fetchSections(
  db: SupabaseClient,
  ayId: string
): Promise<{ relevantLevelCount: number; levelsWithSectionCount: number }> {
  const relevantLevels = await fetchRelevantLevels(db, ayId);
  if (relevantLevels.length === 0) {
    return { relevantLevelCount: 0, levelsWithSectionCount: 0 };
  }

  const relevantLevelIds = new Set(relevantLevels.map((l) => l.id));

  const { data: sectionRows, error: sectionsError } = await db
    .from('sections')
    .select('level_id')
    .not('level_id', 'is', null)
    .eq('academic_year_id', ayId);

  if (sectionsError) throw sectionsError;

  const levelsWithSectionIds = new Set(
    ((sectionRows as any[]) ?? [])
      .map((s) => s.level_id as string)
      .filter((id) => relevantLevelIds.has(id))
  );

  return {
    relevantLevelCount: relevantLevels.length,
    levelsWithSectionCount: levelsWithSectionIds.size,
  };
}

// Real completeness, not just "any subject_level_offerings row exists" — a
// level missing even one of its template's subjects silently drops that
// subject from grading-sheet creation AND the report card
// (build-report-card.ts scopes subjects by subject_configs; no error, no
// visible signal). Reuses computeSubjectConfigGaps (lib/sis/subject-config-
// gaps.ts) — the exact same pure comparison the /sis/admin/subjects gap
// banner uses — so this readiness step can never drift from what the
// registrar actually sees there (count==drill discipline, KD #124/#128).
//
// Post migration-080 (subject_configs collapse): weight configs no longer
// carry a level dimension. "Which levels SHOULD teach a subject" now lives
// on template_subject_level_offerings; "which levels DO" lives on
// subject_level_offerings (scoped to this AY). Deliberately queried here
// with the raw `db` client rather than importing lib/sis/subjects/queries.ts
// or lib/sis/template/queries.ts — both declare `import 'server-only'`,
// and this file's pure resolvers/types are consumed by client components
// (year-setup-checklist.tsx, ay-readiness-pill.tsx import real functions,
// not just types) — pulling a server-only module in here would break the
// client bundle (the exact KD #94 gotcha: "server-only module reaching a
// client component via a value import in any transitively-imported file").
//
// A level with no template rows at all is treated as complete — nothing to
// compare against, avoids false negatives for volatile/manually-managed
// levels (same rule computeSubjectConfigGaps already applies).
async function fetchSubjectWeights(
  db: SupabaseClient,
  ayId: string
): Promise<{
  levelsInUse: number;
  levelsFullyConfigured: number;
  missingCount: number;
}> {
  const relevantLevels = await fetchRelevantLevels(db, ayId);

  if (relevantLevels.length === 0) {
    return { levelsInUse: 0, levelsFullyConfigured: 0, missingCount: 0 };
  }

  const [
    { data: subjectRows, error: subjectsError },
    { data: templateRows, error: templateError },
    { data: actualRows, error: actualError },
  ] = await Promise.all([
    db.from('subjects').select('id, code'),
    db.from('template_subject_level_offerings').select('subject_id, level_id'),
    db
      .from('subject_level_offerings')
      .select('subject_id, level_id')
      .eq('academic_year_id', ayId),
  ]);

  if (subjectsError) throw subjectsError;
  if (templateError) throw templateError;
  if (actualError) throw actualError;

  const gaps = computeSubjectConfigGaps(
    relevantLevels,
    (subjectRows as any[]) ?? [],
    (templateRows as any[]) ?? [],
    (actualRows as any[]) ?? []
  );

  const levelsFullyConfigured = relevantLevels.length - gaps.length;
  const missingCount = gaps.reduce(
    (sum, g) => sum + g.missingSubjectCodes.length,
    0
  );

  return {
    levelsInUse: relevantLevels.length,
    levelsFullyConfigured,
    missingCount,
  };
}

async function fetchAdvisers(
  db: SupabaseClient,
  ayId: string
): Promise<{ sectionCount: number; advisedSectionCount: number }> {
  const { data: sections, error: sectionsError } = await db
    .from('sections')
    .select('id')
    .eq('academic_year_id', ayId)
    .not('level_id', 'is', null);

  if (sectionsError) throw sectionsError;
  const sectionCount = sections?.length ?? 0;

  if (sectionCount === 0) {
    return { sectionCount: 0, advisedSectionCount: 0 };
  }

  const sectionIds = sections!.map((s: any) => s.id);
  const { data: advised, error: advisedError } = await db
    .from('teacher_assignments')
    .select('section_id')
    .in('section_id', sectionIds)
    .eq('role', 'form_adviser');

  if (advisedError) throw advisedError;
  const advisedSectionCount = new Set(
    (advised as any[])?.map((a: any) => a.section_id)
  ).size;

  return { sectionCount, advisedSectionCount };
}

async function fetchGradingSheets(
  db: SupabaseClient,
  ayId: string
): Promise<{ totalSections: number; sectionsWithSheets: number }> {
  const { data: sections, error: sectionsError } = await db
    .from('sections')
    .select('id')
    .eq('academic_year_id', ayId);

  if (sectionsError) throw sectionsError;
  const totalSections = sections?.length ?? 0;

  if (totalSections === 0) {
    return { totalSections: 0, sectionsWithSheets: 0 };
  }

  const sectionIds = sections!.map((s: any) => s.id);
  const { data: sheets, error: sheetsError } = await db
    .from('grading_sheets')
    .select('section_id')
    .in('section_id', sectionIds);

  if (sheetsError) throw sheetsError;
  const sectionsWithSheets = new Set(
    (sheets as any[])?.map((s: any) => s.section_id)
  ).size;

  return { totalSections, sectionsWithSheets };
}

async function fetchVirtueThemes(
  db: SupabaseClient,
  ayId: string
): Promise<{ termsRequiringTheme: number; termsWithTheme: number }> {
  const { data: terms, error: termsError } = await db
    .from('terms')
    .select('id, virtue_theme')
    .eq('academic_year_id', ayId)
    .lte('term_number', 3);

  if (termsError) throw termsError;
  const termsRequiringTheme = terms?.length ?? 0;

  if (termsRequiringTheme === 0) {
    return { termsRequiringTheme: 0, termsWithTheme: 0 };
  }

  const termsWithTheme =
    (terms as any[])?.filter(
      (t) => t.virtue_theme && t.virtue_theme.trim().length > 0
    ).length ?? 0;

  return { termsRequiringTheme, termsWithTheme };
}

async function fetchLetterhead(
  db: SupabaseClient
): Promise<{ hasOrgName: boolean; hasAddress: boolean }> {
  const { data, error } = await db
    .from('school_config')
    .select('organization_name, address_line_1')
    .eq('id', 1)
    .single();

  if (error) throw error;
  const row = data as any;

  const hasOrgName = !!(
    row?.organization_name && row.organization_name.trim().length > 0
  );
  const hasAddress = !!(
    row?.address_line_1 && row.address_line_1.trim().length > 0
  );

  return { hasOrgName, hasAddress };
}

// Main uncached function

async function getAyReadinessUncached(ayCode: string): Promise<AyReadiness> {
  const db = createServiceClient();

  // Fetch AY row
  const { data: ayRow, error: ayError } = await db
    .from('academic_years')
    .select('id, accepting_applications')
    .eq('ay_code', ayCode)
    .single();

  if (ayError || !ayRow) {
    // Return all not-started if AY not found
    return buildReadiness(ayCode, [
      resolveAySetupStep({ datedTermCount: 0, totalTermCount: 0 }),
      resolveCalendarStep({ totalTerms: 0, coveredTerms: 0 }),
      resolveSectionsStep({ relevantLevelCount: 0, levelsWithSectionCount: 0 }),
      resolveSubjectWeightsStep({
        levelsInUse: 0,
        levelsFullyConfigured: 0,
        missingCount: 0,
      }),
      resolveAdvisersStep({ sectionCount: 0, advisedSectionCount: 0 }),
      resolveSectionSubjectsStep({
        totalSections: 0,
        sectionsWithSubjects: 0,
      }),
      resolveGradingSheetsStep({ totalSections: 0, sectionsWithSheets: 0 }),
      resolveVirtueThemesStep({ termsRequiringTheme: 0, termsWithTheme: 0 }),
      resolveLetterheadStep({ hasOrgName: false, hasAddress: false }),
      resolveAppWindowStep({ accepting: false }),
    ]);
  }

  const ayId = (ayRow as any).id;
  const accepting = (ayRow as any).accepting_applications ?? false;

  // Fan out 9 fetchers
  const [
    aySetup,
    calendar,
    sections,
    subjectWeights,
    advisers,
    sectionSubjects,
    gradingSheets,
    virtueThemes,
    letterhead,
  ] = await Promise.all([
    fetchAySetup(db, ayId),
    fetchCalendar(db, ayId),
    fetchSections(db, ayId),
    fetchSubjectWeights(db, ayId),
    fetchAdvisers(db, ayId),
    fetchSectionSubjects(db, ayId),
    fetchGradingSheets(db, ayId),
    fetchVirtueThemes(db, ayId),
    fetchLetterhead(db),
  ]);

  // Build steps, in the AY-Setup checklist's display order.
  const step1 = resolveAySetupStep(aySetup);
  const step2 = resolveCalendarStep(calendar);
  const step3 = resolveSectionsStep(sections);
  const step4 = resolveSubjectWeightsStep(subjectWeights);
  const step5 = resolveAdvisersStep(advisers);
  const step6 = resolveSectionSubjectsStep(sectionSubjects);
  const step7 = resolveGradingSheetsStep(gradingSheets);
  const step8 = resolveVirtueThemesStep(virtueThemes);
  const step9 = resolveLetterheadStep(letterhead);
  const step10 = resolveAppWindowStep({ accepting });

  return buildReadiness(ayCode, [
    step1,
    step2,
    step3,
    step4,
    step5,
    step6,
    step7,
    step8,
    step9,
    step10,
  ]);
}

// Cached wrapper

export const getAyReadiness = (ayCode: string) =>
  unstable_cache(
    () => getAyReadinessUncached(ayCode),
    [`sis-readiness-${ayCode}`],
    { tags: [`sis:${ayCode}`], revalidate: 60 }
  )();
