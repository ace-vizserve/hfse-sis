import { redirect } from 'next/navigation';

import { studentNumberFromEnroleeNumber } from '@/lib/sis/records-history';

// Legacy redirect: /records/students/[enroleeNumber] → either the new
// cross-year permanent URL (/records/students/[studentNumber]) when the
// applicant is enrolled, or /admissions/applications/[enroleeNumber] when
// the applicant is still pre-enrolment.
//
// Records no longer hosts the AY-scoped applicant detail — that moved to
// /admissions/applications/[enroleeNumber] per the 2026-04-23 module split.
export default async function LegacyEnroleeRedirect({
  params,
}: {
  params: Promise<{ enroleeNumber: string }>;
}) {
  const { enroleeNumber } = await params;
  const { studentNumber } = await studentNumberFromEnroleeNumber(enroleeNumber);

  if (studentNumber) {
    // Enrolled (has studentNumber) → cross-year Records URL.
    redirect(`/records/students/${encodeURIComponent(studentNumber)}`);
  }
  // No studentNumber means the applicant hasn't been assigned yet — still
  // in the admissions funnel. Send them to Admissions.
  redirect(`/admissions/applications/${encodeURIComponent(enroleeNumber)}`);
}
