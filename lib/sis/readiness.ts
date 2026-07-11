import { unstable_cache } from 'next/cache';
import { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase/service';

export type ReadinessStepId =
  | 'ay-setup'
  | 'calendar'
  | 'classes'
  | 'advisers'
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
  classes: {
    id: 'classes',
    step: 3,
    label: 'Classes & subjects',
    description: 'Create classes and subject assignments',
    href: '/sis/admin/template',
    required: true,
  },
  advisers: {
    id: 'advisers',
    step: 4,
    label: 'Form advisers',
    description: 'Assign form class advisers',
    href: '/sis/sections',
    required: true,
  },
  'grading-sheets': {
    id: 'grading-sheets',
    step: 5,
    label: 'Grading sheets',
    description: 'Create grading sheets for all sections',
    href: '/markbook/sections',
    required: true,
  },
  'virtue-themes': {
    id: 'virtue-themes',
    step: 6,
    label: 'Virtue themes',
    description: 'Set virtue themes for each term',
    href: '/evaluation/virtue-themes',
    required: true,
  },
  letterhead: {
    id: 'letterhead',
    step: 7,
    label: 'Report-card letterhead',
    description: 'Configure school letterhead and branding',
    href: '/sis/admin/school-config',
    required: true,
  },
  'app-window': {
    id: 'app-window',
    step: 8,
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

export function resolveClassesStep(input: {
  sectionCount: number;
  subjectConfigCount: number;
}): ReadinessStep {
  const status =
    input.sectionCount > 0 && input.subjectConfigCount > 0
      ? 'done'
      : 'not_started';
  return {
    ...STEP_META['classes'],
    status,
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

// Single source of truth for the year-band segmented bar's fill color per
// status — mint done / amber partial / muted not_started, reusing the exact
// status vocabulary the Year Setup checklist's `StatusTile` already paints
// (`components/sis/year-setup/year-setup-checklist.tsx`) so the two surfaces
// can't drift apart (design system §10.2).
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

async function fetchClasses(
  db: SupabaseClient,
  ayId: string
): Promise<{ sectionCount: number; subjectConfigCount: number }> {
  const { count: sectionCount, error: sectionsError } = await db
    .from('sections')
    .select('id', { count: 'exact', head: true })
    .not('level_id', 'is', null)
    .eq('academic_year_id', ayId);

  if (sectionsError) throw sectionsError;

  const { count: subjectConfigCount, error: configsError } = await db
    .from('subject_configs')
    .select('id', { count: 'exact', head: true })
    .eq('academic_year_id', ayId);

  if (configsError) throw configsError;

  return {
    sectionCount: sectionCount ?? 0,
    subjectConfigCount: subjectConfigCount ?? 0,
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
      resolveClassesStep({ sectionCount: 0, subjectConfigCount: 0 }),
      resolveAdvisersStep({ sectionCount: 0, advisedSectionCount: 0 }),
      resolveGradingSheetsStep({ totalSections: 0, sectionsWithSheets: 0 }),
      resolveVirtueThemesStep({ termsRequiringTheme: 0, termsWithTheme: 0 }),
      resolveLetterheadStep({ hasOrgName: false, hasAddress: false }),
      resolveAppWindowStep({ accepting: false }),
    ]);
  }

  const ayId = (ayRow as any).id;
  const accepting = (ayRow as any).accepting_applications ?? false;

  // Fan out 7 fetchers
  const [
    aySetup,
    calendar,
    classes,
    advisers,
    gradingSheets,
    virtueThemes,
    letterhead,
  ] = await Promise.all([
    fetchAySetup(db, ayId),
    fetchCalendar(db, ayId),
    fetchClasses(db, ayId),
    fetchAdvisers(db, ayId),
    fetchGradingSheets(db, ayId),
    fetchVirtueThemes(db, ayId),
    fetchLetterhead(db),
  ]);

  // Build steps
  const step1 = resolveAySetupStep(aySetup);
  const step2 = resolveCalendarStep(calendar);
  const step3 = resolveClassesStep(classes);
  const step4 = resolveAdvisersStep(advisers);
  const step5 = resolveGradingSheetsStep(gradingSheets);
  const step6 = resolveVirtueThemesStep(virtueThemes);
  const step7 = resolveLetterheadStep(letterhead);
  const step8 = resolveAppWindowStep({ accepting });

  return buildReadiness(ayCode, [
    step1,
    step2,
    step3,
    step4,
    step5,
    step6,
    step7,
    step8,
  ]);
}

// Cached wrapper

export const getAyReadiness = (ayCode: string) =>
  unstable_cache(
    () => getAyReadinessUncached(ayCode),
    [`sis-readiness-${ayCode}`],
    { tags: [`sis:${ayCode}`], revalidate: 60 }
  )();
