// Shared utilities extracted from lib/p-files/*.ts to avoid duplication.

export function prefixFor(ayCode: string): string {
  return `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
}

export const ENROLLED_STATUSES = [
  'Enrolled',
  'Enrolled (Conditional)',
] as const;

const ENROLLED_STATUS_SET: ReadonlySet<string> = new Set(ENROLLED_STATUSES);

/**
 * Has this application reached an enrolled state?
 *
 * Pure, so a surface that already HOLDS the status row can ask without a
 * second database round-trip — which is the whole reason it exists. Since
 * 2026-09-01 the enrolment line no longer decides who has a P-Files folder
 * (KD #204 gave applicants one); it decides which SIDE's capability a write
 * requires — `documents_pre_enrolment.*` before enrolment, `..._post_...`
 * after. The document PATCH, the upload route and the student page all ask
 * that question, and they must all answer it the same way, so the string test
 * lives here once. `isStudentEnrolled` in ./queries is the I/O wrapper over
 * this predicate, not a second copy of it.
 */
export function isEnrolledStatus(status: string | null | undefined): boolean {
  return ENROLLED_STATUS_SET.has((status ?? '').trim());
}
export const ADMISSIONS_FUNNEL_STATUSES = [
  'Submitted',
  'Ongoing Verification',
  'Processing',
] as const;

export const MODULE_VALUES = ['p-files', 'admissions'] as const;
export type PFilesModule = (typeof MODULE_VALUES)[number];
export function resolveModule(input: unknown): PFilesModule {
  const m = input as string;
  return MODULE_VALUES.includes(m as PFilesModule)
    ? (m as PFilesModule)
    : 'p-files';
}
