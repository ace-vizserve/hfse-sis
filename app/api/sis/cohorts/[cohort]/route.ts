import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { buildCsv } from '@/lib/csv';
import {
  getCohort,
  isCohortKey,
  type CohortKey,
  type CohortScope,
  type CohortStudentRow,
} from '@/lib/sis/cohorts';

// ─── Auth ──────────────────────────────────────────────────────────────────
//
// Both Records (enrolled scope) and Admissions (funnel scope) cohorts allow
// the same set of staff roles. Admissions role can see funnel cohorts
// (its native surface) AND enrolled cohorts (read-only — admissions ops
// regularly need to look up STP / medical / pass info on enrolled students
// they processed earlier in the year).

const ALLOWED_ROLES = [
  'registrar',
  'school_admin',
  'admin',
  'superadmin',
  'admissions',
] as const;

function isCohortScope(value: string | null): value is CohortScope {
  return value === 'enrolled' || value === 'funnel';
}

// ─── CSV column sets ───────────────────────────────────────────────────────
//
// Per-cohort focused subset — full table is overkill for a CSV. We pick the
// fields a registrar would actually filter / sort / forward downstream.

type CsvSpec = {
  headers: string[];
  build: (row: CohortStudentRow) => Array<string | number>;
};

const STP_CSV: CsvSpec = {
  headers: [
    'Enrolee #',
    'Student #',
    'Full name',
    'Level',
    'App status',
    'STP type',
    'ICA Photo',
    'Financial Support',
    'Vaccination',
    'Residence filled',
    'STP complete',
  ],
  build: (r) => [
    r.enroleeNumber,
    r.studentNumber ?? '',
    r.enroleeFullName ?? '',
    r.levelApplied ?? '',
    r.applicationStatus ?? '',
    r.stpApplicationType ?? '',
    r.icaPhotoStatus ?? '',
    r.financialSupportDocsStatus ?? '',
    r.vaccinationInformationStatus ?? '',
    r.residenceHistoryFilled ? 'Yes' : 'No',
    r.stpComplete ? 'Yes' : 'No',
  ],
};

const MEDICAL_CSV: CsvSpec = {
  headers: [
    'Enrolee #',
    'Student #',
    'Full name',
    'Level',
    'App status',
    'Flags',
    'Allergies',
    'Food allergies',
    'Other conditions',
    'Dietary',
    'Paracetamol',
  ],
  build: (r) => [
    r.enroleeNumber,
    r.studentNumber ?? '',
    r.enroleeFullName ?? '',
    r.levelApplied ?? '',
    r.applicationStatus ?? '',
    (r.medicalFlags ?? []).join('; '),
    r.allergyDetails ?? '',
    r.foodAllergyDetails ?? '',
    r.otherMedicalConditions ?? '',
    r.dietaryRestrictions ?? '',
    r.paracetamolConsent === true ? 'Yes' : r.paracetamolConsent === false ? 'No' : '',
  ],
};

const PASS_EXPIRY_CSV: CsvSpec = {
  headers: [
    'Enrolee #',
    'Student #',
    'Full name',
    'Level',
    'App status',
    'Earliest expiry',
    'Days until',
    'Earliest kind',
    'Student passport expiry',
    'Parent expiries',
  ],
  build: (r) => [
    r.enroleeNumber,
    r.studentNumber ?? '',
    r.enroleeFullName ?? '',
    r.levelApplied ?? '',
    r.applicationStatus ?? '',
    r.earliestExpiry?.slice(0, 10) ?? '',
    r.daysUntilEarliestExpiry ?? '',
    r.studentPassExpiryKind ?? '',
    r.studentPassExpiry?.slice(0, 10) ?? '',
    (r.parentPassExpiries ?? [])
      .map((p) => `${p.kind}: ${p.date.slice(0, 10)}`)
      .join('; '),
  ],
};

const CSV_BY_COHORT: Record<CohortKey, CsvSpec> = {
  stp: STP_CSV,
  medical: MEDICAL_CSV,
  'pass-expiry': PASS_EXPIRY_CSV,
};

// ─── Handler ───────────────────────────────────────────────────────────────

export async function GET(
  req: Request,
  ctx: { params: Promise<{ cohort: string }> },
) {
  const guard = await requireRole([...ALLOWED_ROLES]);
  if ('error' in guard) return guard.error;

  const { cohort: rawCohort } = await ctx.params;
  if (!isCohortKey(rawCohort)) {
    return NextResponse.json({ error: 'invalid_cohort' }, { status: 400 });
  }
  const cohort: CohortKey = rawCohort;

  const url = new URL(req.url);
  const ayCode = url.searchParams.get('ay');
  if (!ayCode || !/^AY\d{4}$/.test(ayCode)) {
    return NextResponse.json({ error: 'invalid_ay' }, { status: 400 });
  }

  const scope = url.searchParams.get('scope');
  if (!isCohortScope(scope)) {
    return NextResponse.json({ error: 'invalid_scope' }, { status: 400 });
  }

  const format = url.searchParams.get('format') ?? 'json';

  const rows = await getCohort(cohort, ayCode, scope);

  if (format === 'csv') {
    const spec = CSV_BY_COHORT[cohort];
    const csv = buildCsv(spec.headers, rows.map(spec.build));
    const today = new Date().toISOString().slice(0, 10);
    const filename = `cohort-${cohort}-${scope}-${ayCode}-${today}.csv`;
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  }

  return NextResponse.json({
    rows,
    total: rows.length,
    cohort,
    ayCode,
    scope,
  });
}
