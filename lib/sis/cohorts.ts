import { unstable_cache } from 'next/cache';

import { createServiceClient } from '@/lib/supabase/service';
import { fetchAllPages } from '@/lib/supabase/paginate';

// ──────────────────────────────────────────────────────────────────────────
// Cohort views — Wave 1 shared infrastructure (2026-04-27).
//
// "Cohorts" are pre-baked filtered list views over admissions rows for
// cross-cutting student attributes that today require clicking into an
// individual student detail page (STP applications, medical alerts, pass
// expiry). Each cohort renders in BOTH `/records/cohorts/*` (enrolled scope)
// and `/admissions/cohorts/*` (funnel scope) — same data layer, same UI
// components, just scoped at the row level by `applicationStatus`.
//
// Hard rules honoured:
//  - service-role client INSIDE `unstable_cache` (KD #54).
//  - 60s TTL + per-AY tag `sis:${ayCode}` (KD #46) — invalidates cleanly
//    alongside the existing SIS dashboard cache when admissions writes land.
//  - Explicit column lists per row shape — never `select('*')` on the
//    200-column applications table.
// ──────────────────────────────────────────────────────────────────────────

const CACHE_TTL_SECONDS = 60;

function prefixFor(ayCode: string): string {
  return `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
}

function tag(ayCode: string): string[] {
  return ['sis', `sis:${ayCode}`];
}

// ─── Scope ──────────────────────────────────────────────────────────────────

export type CohortScope = 'enrolled' | 'funnel';

const ENROLLED_STATUSES = new Set(['Enrolled', 'Enrolled (Conditional)']);
const FUNNEL_STATUSES = new Set([
  'Submitted',
  'Ongoing Verification',
  'Processing',
]);

function inScope(
  applicationStatus: string | null,
  scope: CohortScope
): boolean {
  const s = (applicationStatus ?? '').trim();
  if (scope === 'enrolled') return ENROLLED_STATUSES.has(s);
  return FUNNEL_STATUSES.has(s);
}

// ─── Common row shape ───────────────────────────────────────────────────────

export type ParentPassExpiry = { kind: string; date: string };

// Promised-cohort slot shape. One entry per `'to-follow'` slot on the
// applicant. `promisedUntil === null` means the slot is flagged but no
// `kind='promise'` row exists yet — registrar can backfill the date from
// the per-applicant detail page.
export type PromisedSlot = {
  key: string;
  label: string;
  promisedUntil: string | null;
  note: string | null;
  daysUntil: number | null;
  pastDue: boolean;
};

export type CohortStudentRow = {
  enroleeNumber: string;
  studentNumber: string | null;
  enroleeFullName: string | null;
  levelApplied: string | null;
  applicationStatus: string | null;

  // STP-specific (migration 050 — replaced 3-doc-slot model with a single
  // stpApplicationStatus enum on the apps row, co-located with stpApplicationType).
  stpApplicationType?: string | null;
  stpApplicationStatus?: string | null;
  residenceHistoryFilled?: boolean;
  stpComplete?: boolean;

  // Medical-specific
  medicalFlags?: string[];
  allergyDetails?: string | null;
  foodAllergyDetails?: string | null;
  otherMedicalConditions?: string | null;
  paracetamolConsent?: boolean | null;
  dietaryRestrictions?: string | null;

  // Pass-expiry-specific
  studentPassExpiry?: string | null;
  studentPassExpiryKind?: 'passport' | 'pass' | null;
  parentPassExpiries?: ParentPassExpiry[];
  earliestExpiry?: string | null;
  daysUntilEarliestExpiry?: number | null;

  // Promised-follow-ups-specific
  toFollowSlots?: PromisedSlot[];
  toFollowCount?: number;
  earliestPromisedUntil?: string | null;
  daysUntilEarliestPromise?: number | null;
  hasPastDuePromise?: boolean;

  // Pre-course-counselling-specific. A mandatory step for EVERY applicant
  // (HFSE counsels the parent + co-signs the Pre-Course Counselling
  // Acknowledgement Form before the application is submitted). Two buckets only:
  //   complete  = counselled — answered "Yes" WITH a signed date (the proof).
  //   not-yet   = NOT counselled — answered "No", or no answer recorded at all
  //               (a blank is simply "not done yet", same as an explicit No).
  // (A "Yes" with no date is an invalid record — the loader excludes it.)
  preCourseAnswer?: 'Yes' | 'No' | null;
  preCourseDate?: string | null;
  preCourseAcknowledgedAt?: string | null;
  preCourseStatus?: 'complete' | 'not-yet';
};

// ─── Snapshot read helpers ──────────────────────────────────────────────────
//
// All 3 cohorts ride on the same `apps × status` snapshot (joined by
// enroleeNumber). The STP cohort additionally needs `documents` (3 STP slot
// statuses); medical + pass-expiry don't. We split the snapshot read so each
// cohort opts in to docs explicitly via `withDocs`.

type AppRow = Record<string, unknown> & { enroleeNumber: string | null };
type StatusRow = {
  enroleeNumber: string | null;
  applicationStatus: string | null;
};
type DocRow = {
  enroleeNumber: string | null;
  icaPhotoStatus: string | null;
  financialSupportDocsStatus: string | null;
  vaccinationInformationStatus: string | null;
};

type Snapshot = {
  apps: AppRow[];
  statusByEnrolee: Map<string, StatusRow>;
  docsByEnrolee: Map<string, DocRow>;
};

async function loadSnapshot(
  ayCode: string,
  appColumns: string[],
  withDocs: boolean
): Promise<Snapshot> {
  const prefix = prefixFor(ayCode);
  const supabase = createServiceClient();

  const ensuredAppColumns = Array.from(
    new Set(['enroleeNumber', ...appColumns])
  );

  type PageResult<T> = PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>;

  // fetchAllPages walks past the PostgREST 1000-row cap (L5). AYs with
  // > 1000 enrolled applicants silently truncated without this.
  // Cast required: Supabase can't infer row shapes for dynamic table names.
  const [apps, statuses, docs] = await Promise.all([
    fetchAllPages<AppRow>(
      (from, to) =>
        supabase
          .from(`${prefix}_enrolment_applications`)
          .select(ensuredAppColumns.join(', '))
          .range(from, to) as unknown as PageResult<AppRow>
    ),
    fetchAllPages<StatusRow>(
      (from, to) =>
        supabase
          .from(`${prefix}_enrolment_status`)
          .select('enroleeNumber, applicationStatus')
          .range(from, to) as unknown as PageResult<StatusRow>
    ),
    withDocs
      ? fetchAllPages<DocRow>(
          (from, to) =>
            supabase
              .from(`${prefix}_enrolment_documents`)
              .select(
                'enroleeNumber, icaPhotoStatus, financialSupportDocsStatus, vaccinationInformationStatus'
              )
              .range(from, to) as unknown as PageResult<DocRow>
        )
      : Promise.resolve([] as DocRow[]),
  ]);

  const statusByEnrolee = new Map<string, StatusRow>();
  for (const s of statuses) {
    if (s.enroleeNumber) statusByEnrolee.set(s.enroleeNumber, s);
  }
  const docsByEnrolee = new Map<string, DocRow>();
  for (const d of docs) {
    if (d.enroleeNumber) docsByEnrolee.set(d.enroleeNumber, d);
  }

  return { apps, statusByEnrolee, docsByEnrolee };
}

function commonFields(
  app: AppRow,
  status: StatusRow | undefined
): {
  enroleeNumber: string;
  studentNumber: string | null;
  enroleeFullName: string | null;
  levelApplied: string | null;
  applicationStatus: string | null;
} {
  return {
    enroleeNumber: (app.enroleeNumber as string | null) ?? '',
    studentNumber: (app.studentNumber as string | null) ?? null,
    enroleeFullName: (app.enroleeFullName as string | null) ?? null,
    levelApplied: (app.levelApplied as string | null) ?? null,
    applicationStatus: status?.applicationStatus ?? null,
  };
}

// ─── STP cohort ─────────────────────────────────────────────────────────────

const STP_APP_COLUMNS = [
  'enroleeNumber',
  'studentNumber',
  'enroleeFullName',
  'levelApplied',
  'stpApplicationType',
  'stpApplicationStatus',
  'residenceHistory',
];

function isResidencePopulated(raw: unknown): boolean {
  if (raw == null) return false;
  if (Array.isArray(raw)) return raw.length > 0;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === '[]' || trimmed === '{}') return false;
    return true;
  }
  if (typeof raw === 'object') {
    return Object.keys(raw as Record<string, unknown>).length > 0;
  }
  return false;
}

async function loadStpCohortUncached(
  ayCode: string,
  scope: CohortScope
): Promise<CohortStudentRow[]> {
  // No more docs snapshot — STP completeness now flows from
  // stpApplicationStatus on the apps row (migration 050).
  const snapshot = await loadSnapshot(ayCode, STP_APP_COLUMNS, false);
  const rows: CohortStudentRow[] = [];

  for (const app of snapshot.apps) {
    if (!app.enroleeNumber) continue;
    const stpType = (app.stpApplicationType as string | null) ?? null;
    if (!stpType) continue; // only include STP applicants

    const status = snapshot.statusByEnrolee.get(app.enroleeNumber);
    if (!inScope(status?.applicationStatus ?? null, scope)) continue;

    const stpStatus = (app.stpApplicationStatus as string | null) ?? null;
    const residenceFilled = isResidencePopulated(app.residenceHistory);
    // "Complete" now means ICA approved the pass. Anything earlier in the
    // ladder (Pending / Submitted) or terminal-negative (Rejected) is
    // still actionable.
    const stpComplete = stpStatus === 'Approved' && residenceFilled;

    rows.push({
      ...commonFields(app, status),
      stpApplicationType: stpType,
      stpApplicationStatus: stpStatus,
      residenceHistoryFilled: residenceFilled,
      stpComplete,
    });
  }

  // Sort: incomplete first, then by name.
  rows.sort((a, b) => {
    const ac = a.stpComplete ? 1 : 0;
    const bc = b.stpComplete ? 1 : 0;
    if (ac !== bc) return ac - bc;
    return (a.enroleeFullName ?? '').localeCompare(b.enroleeFullName ?? '');
  });
  return rows;
}

export async function getStpCohort(
  ayCode: string,
  scope: CohortScope
): Promise<CohortStudentRow[]> {
  return unstable_cache(
    () => loadStpCohortUncached(ayCode, scope),
    ['sis', 'cohort', 'stp', ayCode, scope],
    {
      tags: tag(ayCode),
      revalidate: CACHE_TTL_SECONDS,
    }
  )();
}

// ─── Medical cohort ─────────────────────────────────────────────────────────

const MEDICAL_FLAG_COLUMNS = [
  'allergies',
  'asthma',
  'foodAllergies',
  'heartConditions',
  'epilepsy',
  'diabetes',
  'eczema',
] as const;

const MEDICAL_APP_COLUMNS = [
  'enroleeNumber',
  'studentNumber',
  'enroleeFullName',
  'levelApplied',
  ...MEDICAL_FLAG_COLUMNS,
  'allergyDetails',
  'foodAllergyDetails',
  'otherMedicalConditions',
  'paracetamolConsent',
  'dietaryRestrictions',
];

function nonEmpty(s: unknown): boolean {
  return typeof s === 'string' && s.trim().length > 0;
}

async function loadMedicalCohortUncached(
  ayCode: string,
  scope: CohortScope
): Promise<CohortStudentRow[]> {
  const snapshot = await loadSnapshot(ayCode, MEDICAL_APP_COLUMNS, false);
  const rows: CohortStudentRow[] = [];

  for (const app of snapshot.apps) {
    if (!app.enroleeNumber) continue;
    const status = snapshot.statusByEnrolee.get(app.enroleeNumber);
    if (!inScope(status?.applicationStatus ?? null, scope)) continue;

    // Build flag array. We surface every truthy boolean medical flag plus
    // the two free-text fields (otherMedicalConditions, dietaryRestrictions)
    // when they are non-empty — those are surfaced as their own "other" /
    // "dietary" pseudo-flags so registrars can filter on them.
    const flags: string[] = [];
    for (const col of MEDICAL_FLAG_COLUMNS) {
      if (app[col] === true) flags.push(col);
    }
    const hasOther = nonEmpty(app.otherMedicalConditions);
    const hasDietary = nonEmpty(app.dietaryRestrictions);
    if (hasOther) flags.push('otherMedicalConditions');
    if (hasDietary) flags.push('dietaryRestrictions');

    if (flags.length === 0) continue; // not in cohort

    rows.push({
      ...commonFields(app, status),
      medicalFlags: flags,
      allergyDetails: (app.allergyDetails as string | null) ?? null,
      foodAllergyDetails: (app.foodAllergyDetails as string | null) ?? null,
      otherMedicalConditions:
        (app.otherMedicalConditions as string | null) ?? null,
      paracetamolConsent: (app.paracetamolConsent as boolean | null) ?? null,
      dietaryRestrictions: (app.dietaryRestrictions as string | null) ?? null,
    });
  }

  rows.sort((a, b) => {
    const aLen = a.medicalFlags?.length ?? 0;
    const bLen = b.medicalFlags?.length ?? 0;
    if (aLen !== bLen) return bLen - aLen;
    return (a.enroleeFullName ?? '').localeCompare(b.enroleeFullName ?? '');
  });

  return rows;
}

export async function getMedicalCohort(
  ayCode: string,
  scope: CohortScope
): Promise<CohortStudentRow[]> {
  return unstable_cache(
    () => loadMedicalCohortUncached(ayCode, scope),
    ['sis', 'cohort', 'medical', ayCode, scope],
    {
      tags: tag(ayCode),
      revalidate: CACHE_TTL_SECONDS,
    }
  )();
}

// ─── Pass expiry cohort ─────────────────────────────────────────────────────

const PASS_EXPIRY_APP_COLUMNS = [
  'enroleeNumber',
  'studentNumber',
  'enroleeFullName',
  'levelApplied',
  'passportExpiry',
  'passExpiry',
  'motherPassportExpiry',
  'motherPassExpiry',
  'fatherPassportExpiry',
  'fatherPassExpiry',
  'guardianPassportExpiry',
  'guardianPassExpiry',
];

const MS_PER_DAY = 86_400_000;

function parseDate(raw: unknown): { iso: string; ms: number } | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms)) return null;
  return { iso: trimmed, ms };
}

async function loadPassExpiryCohortUncached(
  ayCode: string,
  scope: CohortScope
): Promise<CohortStudentRow[]> {
  const snapshot = await loadSnapshot(ayCode, PASS_EXPIRY_APP_COLUMNS, false);
  const rows: CohortStudentRow[] = [];
  const todayMs = Date.now();
  // Cutoff: include rows whose earliest expiry is no more than 365 days in the
  // future. Already-expired rows (negative days) are always included.
  const futureCutoffMs = todayMs + 365 * MS_PER_DAY;

  for (const app of snapshot.apps) {
    if (!app.enroleeNumber) continue;
    const status = snapshot.statusByEnrolee.get(app.enroleeNumber);
    if (!inScope(status?.applicationStatus ?? null, scope)) continue;

    // Student earliest of passportExpiry / passExpiry.
    const passport = parseDate(app.passportExpiry);
    const pass = parseDate(app.passExpiry);
    let studentEarliest: {
      iso: string;
      ms: number;
      kind: 'passport' | 'pass';
    } | null = null;
    if (passport && pass) {
      studentEarliest =
        passport.ms <= pass.ms
          ? { ...passport, kind: 'passport' }
          : { ...pass, kind: 'pass' };
    } else if (passport) {
      studentEarliest = { ...passport, kind: 'passport' };
    } else if (pass) {
      studentEarliest = { ...pass, kind: 'pass' };
    }

    // Parent expiries — keep all populated (for chip strip).
    const parentSpecs: Array<{ kind: string; raw: unknown }> = [
      { kind: 'mother passport', raw: app.motherPassportExpiry },
      { kind: 'mother pass', raw: app.motherPassExpiry },
      { kind: 'father passport', raw: app.fatherPassportExpiry },
      { kind: 'father pass', raw: app.fatherPassExpiry },
      { kind: 'guardian passport', raw: app.guardianPassportExpiry },
      { kind: 'guardian pass', raw: app.guardianPassExpiry },
    ];
    const parentExpiries: Array<{ kind: string; iso: string; ms: number }> = [];
    for (const spec of parentSpecs) {
      const parsed = parseDate(spec.raw);
      if (parsed)
        parentExpiries.push({
          kind: spec.kind,
          iso: parsed.iso,
          ms: parsed.ms,
        });
    }
    parentExpiries.sort((a, b) => a.ms - b.ms);

    // Earliest across student + parents.
    const allExpiries: Array<{ ms: number; iso: string }> = [
      ...(studentEarliest
        ? [{ ms: studentEarliest.ms, iso: studentEarliest.iso }]
        : []),
      ...parentExpiries,
    ];
    if (allExpiries.length === 0) continue; // skip rows with no expiry data

    const earliest = allExpiries.reduce((acc, x) => (x.ms < acc.ms ? x : acc));
    if (earliest.ms > futureCutoffMs) continue; // out-of-range (>365d away)

    const days = Math.floor((earliest.ms - todayMs) / MS_PER_DAY);

    rows.push({
      ...commonFields(app, status),
      studentPassExpiry: studentEarliest?.iso ?? null,
      studentPassExpiryKind: studentEarliest?.kind ?? null,
      parentPassExpiries: parentExpiries.map((p) => ({
        kind: p.kind,
        date: p.iso,
      })),
      earliestExpiry: earliest.iso,
      daysUntilEarliestExpiry: days,
    });
  }

  rows.sort((a, b) => {
    const av = a.daysUntilEarliestExpiry ?? Number.POSITIVE_INFINITY;
    const bv = b.daysUntilEarliestExpiry ?? Number.POSITIVE_INFINITY;
    return av - bv;
  });
  return rows;
}

export async function getPassExpiryCohort(
  ayCode: string,
  scope: CohortScope
): Promise<CohortStudentRow[]> {
  return unstable_cache(
    () => loadPassExpiryCohortUncached(ayCode, scope),
    ['sis', 'cohort', 'pass-expiry', ayCode, scope],
    { tags: tag(ayCode), revalidate: CACHE_TTL_SECONDS }
  )();
}

// ─── Promised follow-ups cohort ─────────────────────────────────────────────
//
// Admissions-only chase queue for documents the parent committed to upload by
// a specific date. Funnel scope only — `'enrolled'` returns []. Composes
// `getAdmissionsCompletenessForChase` (per-applicant slots already filtered
// to active funnel statuses) with `getLatestPromisesForRoster` (latest
// kind='promise' row per (enrolee, slot), past-due included).

const MS_PER_DAY_PROMISED = 86_400_000;

function promiseDaysUntil(promisedUntil: string, todayMs: number): number {
  const ms = Date.parse(promisedUntil);
  if (Number.isNaN(ms)) return 0;
  return Math.floor((ms - todayMs) / MS_PER_DAY_PROMISED);
}

async function loadPromisedCohortUncached(
  ayCode: string,
  scope: CohortScope
): Promise<CohortStudentRow[]> {
  if (scope !== 'funnel') return [];

  // Lazy-imported to keep `lib/admissions/dashboard.ts` out of the eager
  // dep graph for the other cohort loaders.
  const { getAdmissionsCompletenessForChase } =
    await import('@/lib/admissions/dashboard');
  const { getLatestPromisesForRoster } = await import('@/lib/p-files/outreach');

  const { students } = await getAdmissionsCompletenessForChase(
    ayCode,
    'to-follow'
  );
  if (students.length === 0) return [];

  const enroleeNumbers = students.map((s) => s.enroleeNumber);
  const promisesByEnrolee = await getLatestPromisesForRoster(
    ayCode,
    enroleeNumbers
  );

  const todayMs = Date.now();
  const rows: CohortStudentRow[] = [];

  for (const s of students) {
    const promisesBySlot = promisesByEnrolee.get(s.enroleeNumber) ?? new Map();
    const toFollowSlots: PromisedSlot[] = [];
    let earliestMs: number | null = null;
    let earliestIso: string | null = null;
    let hasPastDue = false;

    for (const slot of s.slots) {
      if (slot.status !== 'to-follow') continue;
      const promise = promisesBySlot.get(slot.key);
      if (promise) {
        const days = promiseDaysUntil(promise.promisedUntil, todayMs);
        const pastDue = days < 0;
        if (pastDue) hasPastDue = true;
        toFollowSlots.push({
          key: slot.key,
          label: slot.label,
          promisedUntil: promise.promisedUntil,
          note: promise.note,
          daysUntil: days,
          pastDue,
        });
        const ms = Date.parse(promise.promisedUntil);
        if (!Number.isNaN(ms) && (earliestMs === null || ms < earliestMs)) {
          earliestMs = ms;
          earliestIso = promise.promisedUntil;
        }
      } else {
        toFollowSlots.push({
          key: slot.key,
          label: slot.label,
          promisedUntil: null,
          note: null,
          daysUntil: null,
          pastDue: false,
        });
      }
    }

    if (toFollowSlots.length === 0) continue;

    rows.push({
      enroleeNumber: s.enroleeNumber,
      studentNumber: s.studentNumber,
      enroleeFullName: s.fullName,
      levelApplied: s.level,
      applicationStatus: s.applicationStatus,
      toFollowSlots,
      toFollowCount: toFollowSlots.length,
      earliestPromisedUntil: earliestIso,
      daysUntilEarliestPromise:
        earliestMs === null
          ? null
          : Math.floor((earliestMs - todayMs) / MS_PER_DAY_PROMISED),
      hasPastDuePromise: hasPastDue,
    });
  }

  // Sort: past-due first (most negative days first → 1d past-due before
  // 30d past-due), then upcoming ascending, then no-date rows last.
  rows.sort((a, b) => {
    const av = a.daysUntilEarliestPromise ?? null;
    const bv = b.daysUntilEarliestPromise ?? null;
    if (av === null && bv === null) {
      return (a.enroleeFullName ?? '').localeCompare(b.enroleeFullName ?? '');
    }
    if (av === null) return 1;
    if (bv === null) return -1;
    return av - bv;
  });

  return rows;
}

export async function getPromisedCohort(
  ayCode: string,
  scope: CohortScope
): Promise<CohortStudentRow[]> {
  return unstable_cache(
    () => loadPromisedCohortUncached(ayCode, scope),
    ['sis', 'cohort', 'promised', ayCode, scope],
    {
      tags: tag(ayCode),
      revalidate: CACHE_TTL_SECONDS,
    }
  )();
}

// ─── Pre-course counselling cohort ─────────────────────────────────────────
//
// Monitoring lens for the mandatory Pre-Course Counselling Acknowledgement.
// Before enrolment, HFSE provides counselling on course information, fees,
// refund policy, Student's Pass procedures, and key regulations. The parent
// must sign the acknowledgement form; `preCourseAcknowledgedAt` is the
// completion signal.
//
// Unlike other cohorts, this includes ALL funnel applicants (the counselling
// is mandatory for every intake, not gated on a sub-attribute). The status
// tabs filter to action-needed rows by default.

const PRE_COURSE_APP_COLUMNS = [
  'enroleeNumber',
  'studentNumber',
  'enroleeFullName',
  'levelApplied',
  'preCourseAnswer',
  'preCourseDate',
  'preCourseAcknowledgedAt',
];

function toNullableString(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  return s || null;
}

async function loadPreCourseCohortUncached(
  ayCode: string,
  scope: CohortScope
): Promise<CohortStudentRow[]> {
  const snapshot = await loadSnapshot(ayCode, PRE_COURSE_APP_COLUMNS, false);
  const rows: CohortStudentRow[] = [];

  for (const app of snapshot.apps) {
    if (!app.enroleeNumber) continue;
    const status = snapshot.statusByEnrolee.get(app.enroleeNumber);
    if (!inScope(status?.applicationStatus ?? null, scope)) continue;

    const rawAnswer = toNullableString(app.preCourseAnswer);
    const answer: 'Yes' | 'No' | null =
      rawAnswer === 'Yes' ? 'Yes' : rawAnswer === 'No' ? 'No' : null;
    const date = toNullableString(app.preCourseDate);
    const acknowledgedAt = toNullableString(app.preCourseAcknowledgedAt);

    // Regulatory record (ICA/CPE pre-course counselling for STP applicants).
    // "Yes" = counselling completed + acknowledgement signed; `preCourseDate` is
    // the signing date — the actual proof. The intake form blocks "Yes" without
    // a date, so a Yes-with-no-date is an invalid/legacy record: exclude it
    // rather than render an incomplete proof.
    if (answer === 'Yes' && date === null) continue;

    // Two-bucket worklist: counselled vs not-yet. complete = "Yes" (date
    // guaranteed present by the guard above) — proof on file. not-yet = anything
    // else (explicit "No" OR no answer yet) — every applicant needs counselling,
    // so a blank is just "not done yet". NB: `preCourseDate` (the signed date) is
    // the proof, NOT `preCourseAcknowledgedAt` (an app timestamp, kept for display).
    const preCourseStatus: 'complete' | 'not-yet' =
      answer === 'Yes' ? 'complete' : 'not-yet';

    rows.push({
      ...commonFields(app, status),
      preCourseAnswer: answer,
      preCourseDate: date,
      preCourseAcknowledgedAt: acknowledgedAt,
      preCourseStatus,
    });
  }

  // Sort: not-yet first (needs counselling — the actionable bucket), then
  // counselled; alphabetically within each group.
  const PRIORITY: Record<string, number> = { 'not-yet': 0, complete: 1 };
  rows.sort((a, b) => {
    const ap = PRIORITY[a.preCourseStatus ?? 'not-yet'] ?? 0;
    const bp = PRIORITY[b.preCourseStatus ?? 'not-yet'] ?? 0;
    if (ap !== bp) return ap - bp;
    return (a.enroleeFullName ?? '').localeCompare(b.enroleeFullName ?? '');
  });

  return rows;
}

export async function getPreCourseCohort(
  ayCode: string,
  scope: CohortScope
): Promise<CohortStudentRow[]> {
  return unstable_cache(
    () => loadPreCourseCohortUncached(ayCode, scope),
    ['sis', 'cohort', 'pre-course', ayCode, scope],
    { tags: tag(ayCode), revalidate: CACHE_TTL_SECONDS }
  )();
}

// ─── Cohort key + dispatcher ────────────────────────────────────────────────

export type CohortKey =
  | 'stp'
  | 'medical'
  | 'pass-expiry'
  | 'promised'
  | 'pre-course';

const COHORT_KEYS: readonly CohortKey[] = [
  'stp',
  'medical',
  'pass-expiry',
  'promised',
  'pre-course',
] as const;

export function isCohortKey(value: unknown): value is CohortKey {
  return (
    typeof value === 'string' &&
    (COHORT_KEYS as readonly string[]).includes(value)
  );
}

export async function getCohort(
  cohort: CohortKey,
  ayCode: string,
  scope: CohortScope
): Promise<CohortStudentRow[]> {
  switch (cohort) {
    case 'stp':
      return getStpCohort(ayCode, scope);
    case 'medical':
      return getMedicalCohort(ayCode, scope);
    case 'pass-expiry':
      return getPassExpiryCohort(ayCode, scope);
    case 'promised':
      return getPromisedCohort(ayCode, scope);
    case 'pre-course':
      return getPreCourseCohort(ayCode, scope);
  }
}

// ─── Display metadata ───────────────────────────────────────────────────────

export const COHORT_TITLES: Record<CohortKey, string> = {
  stp: 'STP applications',
  medical: 'Medical alerts',
  'pass-expiry': 'Pass expiry',
  promised: 'Promised follow-ups',
  'pre-course': 'Pre-Course Counselling',
};

export const COHORT_DESCRIPTIONS: Record<CohortKey, string> = {
  stp: 'Singapore ICA Student Pass applicants — track ICA application progress (Pending / Submitted / Approved / Rejected) and residence history.',
  medical:
    'Students with any medical flag, allergy, dietary restriction, or paracetamol-consent on file.',
  'pass-expiry':
    'Students with a student or parent travel-document expiry within the next 12 months (or already expired).',
  promised:
    'Funnel applicants with documents marked To follow — sorted by the soonest date the parent committed to upload by.',
  'pre-course':
    "Tracks whether each applicant's parent has completed and signed the Pre-Course Counselling Acknowledgement — covering course information, fees, refund policy, Student's Pass procedures, and key regulations. Required before enrolment.",
};
