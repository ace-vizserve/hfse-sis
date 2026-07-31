import 'server-only';

import { countPendingDocValidation } from '@/lib/admissions/document-validation';
import { can, type Capability } from '@/lib/auth/capabilities';
import type { SidebarBadges } from '@/lib/auth/roles';
import { countAwaitingVerification } from '@/lib/p-files/document-validation';

// The P-Files sidebar badge counts documents awaiting THIS VIEWER's review —
// not documents awaiting review on the post-enrolment side.
//
// WHY THE SUM (KD #173). `/p-files/document-validation` is one page with two
// queues: enrolled students (post-enrolment) and applicants (pre-enrolment),
// each rendered only for the viewer who holds the matching read capability.
// Migration 106 gave `p_file_officer` the pre-enrolment capabilities, so their
// Applicants tab became real work — but the badge still counted only
// `countAwaitingVerification`, so it undercounted their actual queue and could
// read zero while the page held rows. A badge that disagrees with the page it
// points at is worse than no badge.
//
// The capability decides whether a count is fetched AT ALL, mirroring the page
// itself (app/(p-files)/p-files/document-validation/page.tsx): each loader
// scans three admissions tables, so running one for a viewer who will never see
// its tab is a wasted query on every page load, not merely a hidden number.
export async function resolvePFileBadges(
  ayCode: string,
  capabilities: readonly Capability[]
): Promise<SidebarBadges> {
  const canReadPost = can(capabilities, 'documents_post_enrolment.read');
  const canReadPre = can(capabilities, 'documents_pre_enrolment.read');

  // Neither queue is visible → no badge at all, matching what the layouts
  // already return when there is no current academic year. An explicit `0`
  // would render as "nothing to do" rather than "not your work".
  if (!canReadPost && !canReadPre) return {};

  const [enrolledCount, applicantCount] = await Promise.all([
    canReadPost ? countAwaitingVerification(ayCode) : Promise.resolve(0),
    canReadPre ? countPendingDocValidation(ayCode) : Promise.resolve(0),
  ]);

  return { pfileAwaitingVerification: enrolledCount + applicantCount };
}
