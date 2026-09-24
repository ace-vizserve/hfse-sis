// Admission options (migration 174): the per-AY level / class type / schedule
// combinations the parent enrolment forms offer.
//
// Pure — no DB access, no `server-only`. The endpoint, the admin page, the
// seed script and the parity check all derive the portal's three dropdowns
// through `deriveOptions`, so they cannot disagree about what "open" yields.

export const ADMISSION_SCHEDULES = [
  'morning',
  'afternoon',
  'whole_day',
] as const;
export type AdmissionSchedule = (typeof ADMISSION_SCHEDULES)[number];

export const ADMISSION_TRACKS = ['Global', 'Standard'] as const;
export type AdmissionTrack = (typeof ADMISSION_TRACKS)[number];

/** The portal's own words for each schedule — what lands in `preferredSchedule`. */
export const PORTAL_SCHEDULE_LABEL: Record<AdmissionSchedule, PortalSchedule> =
  {
    morning: 'Morning',
    afternoon: 'Afternoon',
    whole_day: 'Whole Day',
  };
export type PortalSchedule = 'Morning' | 'Afternoon' | 'Whole Day';

/** The columns `deriveOptions` needs; a full `admission_options` row satisfies it. */
export type AdmissionOptionRow = {
  level_label: string;
  class_type_label: string;
  schedule: AdmissionSchedule;
  is_open: boolean;
  sort_order: number;
};

export type DerivedClassType = {
  classTypeLabel: string;
  schedules: PortalSchedule[];
};

export type DerivedLevel = {
  levelLabel: string;
  classTypes: DerivedClassType[];
};

/**
 * Open rows → the three dropdowns, as the portal builds them:
 *   levels     = distinct level labels with at least one open row;
 *   classTypes = open rows for that level;
 *   schedules  = open rows for that level and type, in portal words.
 * A closed row contributes nothing, so a level or type whose every row is
 * closed disappears. Levels and types keep the order of their lowest
 * `sort_order`; schedules are always Morning, Afternoon, Whole Day.
 */
export function deriveOptions(
  rows: readonly AdmissionOptionRow[]
): DerivedLevel[] {
  const open = rows
    .filter((r) => r.is_open)
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order);

  const levels = new Map<string, Map<string, Set<AdmissionSchedule>>>();
  for (const r of open) {
    let types = levels.get(r.level_label);
    if (!types) {
      types = new Map();
      levels.set(r.level_label, types);
    }
    let schedules = types.get(r.class_type_label);
    if (!schedules) {
      schedules = new Set();
      types.set(r.class_type_label, schedules);
    }
    schedules.add(r.schedule);
  }

  return [...levels].map(([levelLabel, types]) => ({
    levelLabel,
    classTypes: [...types].map(([classTypeLabel, schedules]) => ({
      classTypeLabel,
      schedules: ADMISSION_SCHEDULES.filter((s) => schedules.has(s)).map(
        (s) => PORTAL_SCHEDULE_LABEL[s]
      ),
    })),
  }));
}

// ── the public read endpoint (/api/parent/v2/admission-options) ──────────
// Kept here, pure, so the route handler is only wiring and the two rules that
// matter — which years may be served, and what a parent is shown — are
// unit-tested without a database (__tests__/admissions/options-endpoint.test.ts).

/**
 * The `?ay=` value, normalised to `AY2027` form, or null when it is not an AY
 * code at all. Case-insensitive on the prefix; surrounding whitespace is
 * forgiven, anything else is not.
 */
export function normalizeAyParam(raw: string): string | null {
  const v = raw.trim().toUpperCase();
  return /^AY\d{4}$/.test(v) ? v : null;
}

/** The `academic_years` columns `isServableAy` decides on. */
export type ServableAyCandidate = {
  ay_code: string;
  is_current: boolean;
  accepting_applications: boolean;
};

/**
 * Whether the public endpoint may serve this year's options: only the current
 * year or one taking applications, and never a test year (`AY9…`, KD #52).
 * The endpoint answers without a token, so this is the whole of its gate —
 * a closed past year or a future year nobody has opened stays private even
 * though its rows exist.
 */
export function isServableAy(
  ay: ServableAyCandidate | null | undefined
): boolean {
  if (!ay) return false;
  if (/^AY9/i.test(ay.ay_code)) return false;
  return ay.is_current === true || ay.accepting_applications === true;
}

/** An `admission_options` row joined with its level's code, as the loader returns it. */
export type AdmissionOptionWithLevel = AdmissionOptionRow & {
  level_code: string | null;
};

/** One entry in the endpoint's `options` array. */
export type PublicAdmissionOption = {
  levelLabel: string;
  levelCode: string | null;
  classTypeLabel: string;
  schedule: PortalSchedule;
  sortOrder: number;
};

/**
 * Rows → the endpoint's `options`: open rows only (a closed row must vanish
 * from the form, not arrive flagged), schedule in the portal's own words,
 * ordered by `sort_order`. The sort is stable, so rows sharing a sort_order
 * keep the loader's order.
 */
export function toPublicOptions(
  rows: readonly AdmissionOptionWithLevel[]
): PublicAdmissionOption[] {
  return rows
    .filter((r) => r.is_open)
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((r) => ({
      levelLabel: r.level_label,
      levelCode: r.level_code,
      classTypeLabel: r.class_type_label,
      schedule: PORTAL_SCHEDULE_LABEL[r.schedule],
      sortOrder: r.sort_order,
    }));
}

/**
 * Track for a class type label. "Global" anywhere in the label (any case)
 * means Global — which covers the Cambridge types, all spelled
 * "Global Class-Cambridge…" / "Global Class (CAMBRIDGE)"; Cambridge is the
 * Global track, not a third one (Mr Ace, 2026-09-24). Everything else is
 * Standard.
 */
export function trackForClassType(classTypeLabel: string): AdmissionTrack {
  return classTypeLabel.toLowerCase().includes('global')
    ? 'Global'
    : 'Standard';
}
