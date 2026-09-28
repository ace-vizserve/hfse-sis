import 'server-only';

import { unstable_cache } from 'next/cache';

import {
  ENROLLED_OPEN_STEPS_STATUS_SELECT,
  classifyEnrolledOpenSteps,
  compareEnrolledOpenSteps,
  type EnrolledOpenStepsRow,
} from '@/lib/admissions/enrolled-open-steps';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { fetchAllPages } from '@/lib/supabase/paginate';

// Read half of the "Enrolled, steps still open" queue — the rule lives in
// `enrolled-open-steps.ts`. One AY at a time: the page follows the Admissions
// `?ay=` switcher convention, so there is no multi-year union here.
//
// Cached under the existing `sis:${ayCode}` tag, which the stage PATCH route
// (and every other admissions write) already revalidates — finishing a step
// takes the child off the queue on the next render without a tag of its own.

const CACHE_TTL_SECONDS = 60;

function prefixFor(ayCode: string): string {
  return `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
}

type AppsRow = {
  enroleeNumber: string | null;
  studentNumber: string | null;
  enroleeFullName: string | null;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  levelApplied: string | null;
  category: string | null;
};

function nameOf(app: AppsRow | undefined, enroleeNumber: string): string {
  const full = app?.enroleeFullName?.trim();
  if (full) return full;
  const parts = [app?.lastName, app?.firstName, app?.middleName]
    .map((p) => (p ?? '').trim())
    .filter(Boolean);
  return parts.length ? parts.join(', ') : enroleeNumber;
}

async function loadUncached(ayCode: string): Promise<EnrolledOpenStepsRow[]> {
  const prefix = prefixFor(ayCode);
  const admissions = createAdmissionsClient();

  // ⚠ A FAILED READ THROWS rather than returning []. On a chase queue an empty
  // list reads as "nobody to chase", which is the one wrong answer that
  // looks like a right one. `fetchAllPages` throws on a query error, and
  // `unstable_cache` does not store a throw.
  const [statusRows, appRows] = await Promise.all([
    // Filtered to plain Enrolled at the DB — Conditional is left out of this
    // queue on purpose (see enrolled-open-steps.ts). Exact, as the classifier
    // is: the two must agree on which rows are plain Enrolled.
    fetchAllPages<Record<string, unknown>>((from, to) =>
      admissions
        .from(`${prefix}_enrolment_status`)
        .select(ENROLLED_OPEN_STEPS_STATUS_SELECT)
        .eq('applicationStatus', 'Enrolled')
        .range(from, to)
    ),
    fetchAllPages<AppsRow>((from, to) =>
      admissions
        .from(`${prefix}_enrolment_applications`)
        .select(
          'enroleeNumber, studentNumber, enroleeFullName, firstName, middleName, lastName, levelApplied, category'
        )
        .range(from, to)
    ),
  ]);

  const appByEnrolee = new Map<string, AppsRow>();
  for (const a of appRows) {
    if (a.enroleeNumber) appByEnrolee.set(a.enroleeNumber, a);
  }

  const out: EnrolledOpenStepsRow[] = [];
  for (const s of statusRows) {
    if (typeof s.enroleeNumber !== 'string') continue;
    const enroleeNumber = s.enroleeNumber as string;
    const app = appByEnrolee.get(enroleeNumber);
    const openSteps = classifyEnrolledOpenSteps({
      applicationStatus: s.applicationStatus as string | null,
      category: app?.category ?? null,
      enroleeType: (s.enroleeType as string | null) ?? null,
      statusRow: s,
    });
    if (!openSteps) continue;

    const classLevel = ((s.classLevel as string | null) ?? '').trim();
    const classSection = ((s.classSection as string | null) ?? '').trim();
    const enrolledAt = (s.enrolledAt as string | null) ?? null;
    out.push({
      ayCode,
      enroleeNumber,
      studentNumber: app?.studentNumber?.trim() || null,
      studentName: nameOf(app, enroleeNumber),
      levelApplied: app?.levelApplied?.trim() || null,
      classLabel: classSection
        ? [classLevel, classSection].filter(Boolean).join(' ')
        : null,
      openSteps,
      // The write-once enrolment stamp when there is one; otherwise the
      // application stage's last update, flagged as such — see the type.
      enrolledOn:
        enrolledAt ?? (s.applicationUpdatedDate as string | null) ?? null,
      enrolledOnExact: enrolledAt !== null,
      enrolledBy:
        ((s.applicationUpdatedBy as string | null) ?? '').trim() || null,
    });
  }

  return out.sort(compareEnrolledOpenSteps);
}

/** Plain-Enrolled children in `ayCode` with at least one step still open. */
export async function loadEnrolledOpenSteps(
  ayCode: string
): Promise<EnrolledOpenStepsRow[]> {
  return unstable_cache(
    () => loadUncached(ayCode),
    ['admissions-enrolled-open-steps', ayCode],
    { revalidate: CACHE_TTL_SECONDS, tags: [`sis:${ayCode}`] }
  )();
}
