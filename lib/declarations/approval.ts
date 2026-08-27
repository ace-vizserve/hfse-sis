// ⚠ NO `import 'server-only'`, and that is deliberate rather than an omission.
// `scripts/repair-declaration-approvals.ts` imports this and runs under tsx,
// where the `server-only` package throws outright. `lib/supabase/service.ts`
// made the same call for the same reason and says so in words instead:
//
//   THIS IS SERVER CODE. It uses the service-role client and bypasses RLS.
//   Never import it from a client component.
//
// The neighbours that no script touches — config.ts, inbox.ts, resolve.ts —
// keep the directive.

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  openApprovalRequest,
  type OpenApprovalRequestResult,
} from '@/lib/approvals/materialise';
import type { StagedApprovalFlow } from '@/lib/schemas/approval-flows';

/**
 * The declaration flow's two constants, and the one call that puts a filing
 * onto the approval ladder.
 *
 * ⚠ THE SUBJECT IS ONE DECLARATION, NOT ONE SUBMISSION. A parent who names
 * three children files three rows sharing a `filing_group_id`, and each opens
 * its OWN request. Migration 125 spelled out why the rows are separate: the
 * first approver is *that child's* form class adviser and siblings sit in
 * different classes, so a shared request would have to pool two advisers into
 * one step — and "first to act carries it" would then let one class's adviser
 * decide another class's child.
 */
export const DECLARATION_APPROVAL_FLOW: StagedApprovalFlow =
  'attendance.student_declaration';

export const DECLARATION_SUBJECT_TYPE = 'student_declaration';

export type DeclarationForApproval = {
  id: string;
  sectionId: string;
};

export type OpenDeclarationApprovalsResult = {
  opened: number;
  /**
   * Filings that got no ladder because the school has not configured one.
   * Not a failure — see below.
   */
  unconfigured: number;
};

/**
 * Open one approval request per declaration.
 *
 * ⚠ A MISSING CONFIGURATION IS NOT AN ERROR, AND THAT IS A CHOICE ABOUT WHO
 * PAYS FOR IT. If nobody has set up the steps yet, the filing still stands and
 * reads "With the school"; `scripts/repair-declaration-approvals.ts` opens its
 * request once the steps exist. Turning a parent away from filing an absence
 * about a sick child, because an administrator has not finished configuring an
 * approval chain the parent has never heard of, would be the wrong trade.
 *
 * ⚠ A REAL DATABASE FAILURE IS DIFFERENT AND MUST NOT BE SWALLOWED — it throws,
 * and the caller takes the declarations back out. A declaration with no ladder
 * that nobody knows is missing would read "With the school" forever while no
 * queue anywhere shows it: the worst failure shape this feature has, because
 * every screen looks fine.
 */
export async function openDeclarationApprovals(
  service: SupabaseClient,
  declarations: DeclarationForApproval[],
  filedBy: { id: string | null; email: string }
): Promise<OpenDeclarationApprovalsResult> {
  let opened = 0;
  let unconfigured = 0;

  for (const declaration of declarations) {
    const result: OpenApprovalRequestResult = await openApprovalRequest(
      service,
      {
        flow: DECLARATION_APPROVAL_FLOW,
        subjectType: DECLARATION_SUBJECT_TYPE,
        subjectId: declaration.id,
        sectionId: declaration.sectionId,
        filedBy: filedBy.id,
        filedByEmail: filedBy.email,
      }
    );

    if (result.opened) {
      opened += 1;
      continue;
    }
    if (result.reason === 'already_open') {
      // A retry reached a filing that was already on the ladder. Nothing to do.
      continue;
    }
    if (result.reason === 'no_stages_configured') {
      unconfigured += 1;
      continue;
    }
    // `derived_stage_without_section` means a step needs a class and the filing
    // has none. Every declaration carries `section_id NOT NULL`, so this is a
    // contradiction rather than a state — treat it as the bug it would be.
    throw new Error(
      `approval ladder could not be built for declaration ${declaration.id}: ${result.reason}`
    );
  }

  return { opened, unconfigured };
}
