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
import type { ApproverLevelScope } from '@/lib/schemas/approval-flows';
import { DECLARATION_APPROVAL_FLOW } from '@/lib/schemas/approval-flows';

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
// ⚠ Re-exported, not redefined. The flow name moved to
// `lib/schemas/approval-flows.ts` so the sidebar badge and the notification
// bell — both client components — can read it without pulling this module
// into the browser bundle. Every existing importer of this name still works.
export { DECLARATION_APPROVAL_FLOW };

export const DECLARATION_SUBJECT_TYPE = 'student_declaration';

export type DeclarationForApproval = {
  id: string;
  sectionId: string;
  /**
   * Which half of the school the child is in.
   *
   * ⚠ Load-bearing since migration 128: HFSE's officer in charge is TWO posts,
   * one per half, and this is what routes the filing to the right one. A null
   * here narrows the step to approvers who cover every child rather than
   * guessing a half.
   */
  levelType: ApproverLevelScope | null;
};

/**
 * `section_id` → which half of the school it belongs to.
 *
 * Read from `levels.level_type` rather than derived from a level CODE. The
 * column is the school's own answer and already carries preschool; a code map
 * is a second copy of it that can drift.
 */
export async function loadLevelTypesBySection(
  service: SupabaseClient,
  sectionIds: string[]
): Promise<Map<string, ApproverLevelScope | null>> {
  const out = new Map<string, ApproverLevelScope | null>();
  const ids = [...new Set(sectionIds.filter(Boolean))];
  if (ids.length === 0) return out;

  const { data, error } = await service
    .from('sections')
    .select('id, levels(level_type)')
    .in('id', ids);
  if (error) throw new Error(error.message);

  type Row = {
    id: string;
    levels:
      | { level_type: ApproverLevelScope }
      | { level_type: ApproverLevelScope }[]
      | null;
  };
  for (const row of (data ?? []) as unknown as Row[]) {
    // PostgREST returns an embedded to-one as an object or a single-element
    // array depending on how it infers the relationship; both shapes appear in
    // this codebase, so normalise rather than assume.
    const level = Array.isArray(row.levels) ? row.levels[0] : row.levels;
    out.set(row.id, level?.level_type ?? null);
  }
  return out;
}

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
        levelType: declaration.levelType,
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
