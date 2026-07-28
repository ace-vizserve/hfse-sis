/**
 * Centralized, typed query-key factory for TanStack Query reads.
 *
 * Keys are plain readonly tuples; TanStack hashes them deterministically, so
 * passing an object of params is fine (param order doesn't matter). Grow this
 * per module as read endpoints are migrated — one entry per read endpoint so
 * keys never drift between the `useQuery` and any future `invalidateQueries`.
 */

export type DrillRange = {
  ay: string;
  from?: string | null;
  to?: string | null;
  segment?: string | null;
};

export const queryKeys = {
  markbookDrill: (target: string, range: DrillRange) =>
    ['markbook-drill', target, range] as const,
  admissionsDrill: (target: string, range: DrillRange) =>
    ['admissions-drill', target, range] as const,
  evaluationDrill: (target: string, range: DrillRange) =>
    ['evaluation-drill', target, range] as const,
  attendanceDrill: (
    target: string,
    range: DrillRange & { termId?: string | null }
  ) => ['attendance-drill', target, range] as const,
  attendanceStudentSummary: (sectionStudentId: string, termId: string) =>
    ['attendance-student-summary', sectionStudentId, termId] as const,
  crossAySearch: (query: string) => ['cross-ay-search', query] as const,
  commandPalette: (query: string) => ['command-palette', query] as const,
  sisLifecycleDrill: (target: string, range: DrillRange) =>
    ['sis-lifecycle-drill', target, range] as const,
  sisRecordsDrill: (target: string, range: DrillRange) =>
    ['sis-records-drill', target, range] as const,
  sisAdminDrill: (target: string, range: DrillRange) =>
    ['sis-admin-drill', target, range] as const,
  pfileRevisions: (enroleeNumber: string) =>
    ['pfile-revisions', enroleeNumber] as const,
  pfilesDrill: (target: string, range: DrillRange) =>
    ['pfiles-drill', target, range] as const,
  changeRequestPreview: () => ['change-request-preview'] as const,
} as const;
