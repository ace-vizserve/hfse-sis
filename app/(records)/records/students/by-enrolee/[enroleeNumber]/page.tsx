import { requirePageRoles } from '@/lib/auth/require-page-roles';
import { redirect } from 'next/navigation';

import {
  findStudentByNumber,
  studentNumberFromEnroleeNumber,
} from '@/lib/sis/records-history';

// Legacy redirect: /records/students/[enroleeNumber] → either the new
// cross-year permanent URL (/records/students/[studentNumber]) when the
// student is actually in the grading schema, or
// /admissions/applications/[enroleeNumber]?ay=<ayCode> when they're
// pre-enrolment OR historically-enrolled but never synced into
// public.students (legacy data pattern — Records 404s on those without
// the grading-schema presence check).
//
// Records no longer hosts the AY-scoped applicant detail — that moved to
// /admissions/applications/[enroleeNumber] per the 2026-04-23 module split.
export default async function LegacyEnroleeRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ enroleeNumber: string }>;
  searchParams: Promise<{ ay?: string }>;
}) {
  // Matches this path's ROUTE_ACCESS row. The middleware and the module
  // layout check too; this is the page stating it in its own file rather
  // than inheriting it silently (lib/auth/require-page-roles.ts).
  await requirePageRoles([
    'admissions',
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);

  const { enroleeNumber } = await params;
  const { ay } = await searchParams;
  const { studentNumber } = await studentNumberFromEnroleeNumber(enroleeNumber);

  // Only send to Records when BOTH (a) the admissions row has a
  // studentNumber AND (b) public.students actually has that row. Legacy
  // prod data often has a studentNumber on admissions rows whose student
  // never got synced into the grading schema — those 404 on the Records
  // page, so fall through to Admissions instead.
  if (studentNumber) {
    const presentInGradingSchema = await findStudentByNumber(studentNumber);
    if (presentInGradingSchema) {
      redirect(`/records/students/${encodeURIComponent(studentNumber)}`);
    }
  }

  // Either no studentNumber (still in the admissions funnel) OR the
  // studentNumber is admissions-only legacy. Either way, Admissions is
  // the right destination. Thread `?ay=` so the AY-scoped lookup hits
  // the right table.
  const qs = ay ? `?ay=${encodeURIComponent(ay)}` : '';
  redirect(
    `/admissions/applications/${encodeURIComponent(enroleeNumber)}${qs}`
  );
}
