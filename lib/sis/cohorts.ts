import { unstable_cache } from 'next/cache';

import { createServiceClient } from '@/lib/supabase/service';

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
const FUNNEL_STATUSES = new Set(['Submitted', 'Ongoing Verification', 'Processing']);

function inScope(applicationStatus: string | null, scope: CohortScope): boolean {
  const s = (applicationStatus ?? '').trim();
  if (scope === 'enrolled') return ENROLLED_STATUSES.has(s);
  return FUNNEL_STATUSES.has(s);
}

// ─── Common row shape ───────────────────────────────────────────────────────

export type ParentPassExpiry = { kind: string; date: string };

export type CohortStudentRow = {
  enroleeNumber: string;
  studentNumber: string | null;
  enroleeFullName: string | null;
  levelApplied: string | null;
  applicationStatus: string | null;

  // STP-specific
  stpApplicationType?: string | null;
  icaPhotoStatus?: string | null;
  financialSupportDocsStatus?: string | null;
  vaccinationInformationStatus?: string | null;
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
  withDocs: boolean,
): Promise<Snapshot> {
  const prefix = prefixFor(ayCode);
  const supabase = createServiceClient();

  const ensuredAppColumns = Array.from(new Set(['enroleeNumber', ...appColumns]));

  // PostgREST query builders are thenable — `Promise.all` accepts them via the
  // PromiseLike contract, but the type signature wants concrete Promises.
  // We wrap each in `Promise.resolve(...)` to satisfy the array type without
  // an extra `await`.
  const appsPromise = Promise.resolve(
    supabase.from(`${prefix}_enrolment_applications`).select(ensuredAppColumns.join(', ')),
  );
  const statusPromise = Promise.resolve(
    supabase.from(`${prefix}_enrolment_status`).select('enroleeNumber, applicationStatus'),
  );
  const docsPromise = withDocs
    ? Promise.resolve(
        supabase
          .from(`${prefix}_enrolment_documents`)
          .select(
            'enroleeNumber, icaPhotoStatus, financialSupportDocsStatus, vaccinationInformationStatus',
          ),
      )
    : null;

  const [appsRes, statusRes, docsRes] = await Promise.all([
    appsPromise,
    statusPromise,
    docsPromise,
  ]);

  if (appsRes.error) {
    console.warn('[sis/cohorts] apps fetch failed:', appsRes.error.message);
    return { apps: [], statusByEnrolee: new Map(), docsByEnrolee: new Map() };
  }
  if (statusRes.error) {
    console.warn('[sis/cohorts] status fetch failed:', statusRes.error.message);
  }
  if (docsRes?.error) {
    console.warn('[sis/cohorts] documents fetch failed:', docsRes.error.message);
  }

  const apps = ((appsRes.data ?? []) as unknown) as AppRow[];
  const statuses = ((statusRes.data ?? []) as unknown) as StatusRow[];
  const docs = ((docsRes?.data ?? []) as unknown) as DocRow[];

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

function commonFields(app: AppRow, status: StatusRow | undefined): {
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
  scope: CohortScope,
): Promise<CohortStudentRow[]> {
  const snapshot = await loadSnapshot(ayCode, STP_APP_COLUMNS, true);
  const rows: CohortStudentRow[] = [];

  for (const app of snapshot.apps) {
    if (!app.enroleeNumber) continue;
    const stpType = (app.stpApplicationType as string | null) ?? null;
    if (!stpType) continue; // only include STP applicants

    const status = snapshot.statusByEnrolee.get(app.enroleeNumber);
    if (!inScope(status?.applicationStatus ?? null, scope)) continue;

    const docs = snapshot.docsByEnrolee.get(app.enroleeNumber);
    const ica = docs?.icaPhotoStatus ?? null;
    const fin = docs?.financialSupportDocsStatus ?? null;
    const vac = docs?.vaccinationInformationStatus ?? null;
    const residenceFilled = isResidencePopulated(app.residenceHistory);
    const stpComplete =
      ica === 'Valid' && fin === 'Valid' && vac === 'Valid' && residenceFilled;

    rows.push({
      ...commonFields(app, status),
      stpApplicationType: stpType,
      icaPhotoStatus: ica,
      financialSupportDocsStatus: fin,
      vaccinationInformationStatus: vac,
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
  scope: CohortScope,
): Promise<CohortStudentRow[]> {
  return unstable_cache(
    () => loadStpCohortUncached(ayCode, scope),
    ['sis', 'cohort', 'stp', ayCode, scope],
    { tags: tag(ayCode), revalidate: CACHE_TTL_SECONDS },
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
  scope: CohortScope,
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
      otherMedicalConditions: (app.otherMedicalConditions as string | null) ?? null,
      paracetamolConsent: (app.paracetamolConsent as boolean | null) ?? null,
      dietaryRestrictions: (app.dietaryRestrictions as string | null) ?? null,
    });
  }

  rows.sort((a, b) => {
    const aLen = (a.medicalFlags?.length ?? 0);
    const bLen = (b.medicalFlags?.length ?? 0);
    if (aLen !== bLen) return bLen - aLen;
    return (a.enroleeFullName ?? '').localeCompare(b.enroleeFullName ?? '');
  });
  return rows;
}

export async function getMedicalCohort(
  ayCode: string,
  scope: CohortScope,
): Promise<CohortStudentRow[]> {
  return unstable_cache(
    () => loadMedicalCohortUncached(ayCode, scope),
    ['sis', 'cohort', 'medical', ayCode, scope],
    { tags: tag(ayCode), revalidate: CACHE_TTL_SECONDS },
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
  scope: CohortScope,
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
    let studentEarliest: { iso: string; ms: number; kind: 'passport' | 'pass' } | null = null;
    if (passport && pass) {
      studentEarliest = passport.ms <= pass.ms
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
      if (parsed) parentExpiries.push({ kind: spec.kind, iso: parsed.iso, ms: parsed.ms });
    }
    parentExpiries.sort((a, b) => a.ms - b.ms);

    // Earliest across student + parents.
    const allExpiries: Array<{ ms: number; iso: string }> = [
      ...(studentEarliest ? [{ ms: studentEarliest.ms, iso: studentEarliest.iso }] : []),
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
      parentPassExpiries: parentExpiries.map((p) => ({ kind: p.kind, date: p.iso })),
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
  scope: CohortScope,
): Promise<CohortStudentRow[]> {
  return unstable_cache(
    () => loadPassExpiryCohortUncached(ayCode, scope),
    ['sis', 'cohort', 'pass-expiry', ayCode, scope],
    { tags: tag(ayCode), revalidate: CACHE_TTL_SECONDS },
  )();
}

// ─── Cohort key + dispatcher ────────────────────────────────────────────────

export type CohortKey = 'stp' | 'medical' | 'pass-expiry';

export const COHORT_KEYS: readonly CohortKey[] = ['stp', 'medical', 'pass-expiry'] as const;

export function isCohortKey(value: unknown): value is CohortKey {
  return typeof value === 'string' && (COHORT_KEYS as readonly string[]).includes(value);
}

export async function getCohort(
  cohort: CohortKey,
  ayCode: string,
  scope: CohortScope,
): Promise<CohortStudentRow[]> {
  switch (cohort) {
    case 'stp':
      return getStpCohort(ayCode, scope);
    case 'medical':
      return getMedicalCohort(ayCode, scope);
    case 'pass-expiry':
      return getPassExpiryCohort(ayCode, scope);
  }
}

// ─── Display metadata ───────────────────────────────────────────────────────

export const COHORT_TITLES: Record<CohortKey, string> = {
  stp: 'STP applications',
  medical: 'Medical alerts',
  'pass-expiry': 'Pass expiry',
};

export const COHORT_DESCRIPTIONS: Record<CohortKey, string> = {
  stp: 'Singapore ICA Student Pass applicants — track residence history and the 3 STP-conditional document slots.',
  medical: 'Students with any medical flag, allergy, dietary restriction, or paracetamol-consent on file.',
  'pass-expiry': 'Students with a student or parent travel-document expiry within the next 12 months (or already expired).',
};
