// scripts/repair-grade-change-approvals.ts
//
// Finds grade change requests filed on the approval steps (migration 144)
// whose status has been left behind by their ladder, and puts it right.
//
// ⚠ WHY THIS EXISTS. A decision lands on the approval engine first
// (`approval_advance` / `approval_cancel`), and the row the teacher and the
// coordinator read — `grade_change_requests.status` — is written after, as a
// separate statement. When that second write fails, the ladder is closed and
// the row still says `pending`. Every screen then agrees with the row, not the
// ladder:
//
//   - the approver who clicks again is told it has already been decided;
//   - an approved change never reaches the coordinator's "to apply" list,
//     because applying needs `status = 'approved'`;
//   - the teacher sees "waiting for approval" on a request that is finished.
//
// The decide route tells the person who acted that something went wrong, and
// the teacher's Cancel repairs the one row it touches
// (lib/change-requests/decide.ts). Nothing else would ever mention it again.
//
// WHAT IT FIXES — only a row still `pending` over a CLOSED ladder:
//   approved  → status, approved_at, reviewed_by / _email / _at, taken from the
//               last step that approved
//   rejected  → status, reviewed_by / _email / _at, decision_note, taken from
//               the step that turned it down
//   cancelled → status
// The values come from the engine's own record of the decision, so the row
// reads as it would have if the write had landed at the time.
//
// ⚠ IT WRITES NO AUDIT ROW AND SENDS NO EMAIL. A failed projection also skipped
// the decision's audit row and the teacher's email, and this does not invent
// either after the fact: the ladder's steps still record who decided and when.
// Tell the teacher yourself if it matters.
//
// WHAT IT ONLY REPORTS:
//   - a request with `approval_flow` set and NO approval request at all. Filing
//     opens both together, so this should find nothing. Nobody can decide such
//     a request; the teacher can still cancel it.
//   - any other disagreement (for example a row cancelled while its ladder is
//     still open — an approver could still approve a change its author took
//     back). There is no safe automatic answer to those; look at each one.
//
// READ-ONLY BY DEFAULT (`--dry-run` says so explicitly and changes nothing).
// Pass `--apply` to write. Nothing is ever deleted.
//
// Run:
//   npx tsx --env-file=.env.local scripts/repair-grade-change-approvals.ts
//   npx tsx --env-file=.env.local scripts/repair-grade-change-approvals.ts --apply
import { createServiceClient } from '../lib/supabase/service';
import {
  isClosedApprovalStatus,
  reprojectGradeChangeRequest,
  type ClosedApprovalStatus,
} from '../lib/change-requests/approval-projection';
import { GRADE_CHANGE_SUBJECT_TYPE } from '../lib/change-requests/approval-route';
import {
  GRADE_CHANGE_AEB_APPROVAL_FLOW,
  GRADE_CHANGE_APPROVAL_FLOW,
} from '../lib/schemas/approval-flows';

const DRY_RUN_FLAG = process.argv.includes('--dry-run');
const APPLY = process.argv.includes('--apply') && !DRY_RUN_FLAG;

const PAGE = 1000;
const FLOWS = [GRADE_CHANGE_APPROVAL_FLOW, GRADE_CHANGE_AEB_APPROVAL_FLOW];

type GradeChangeRow = {
  id: string;
  status: string;
  approval_flow: string;
  requested_by_email: string;
  requested_at: string;
};

type ApprovalRow = {
  id: string;
  flow: string;
  subject_id: string;
  status: string;
};

/** PostgREST stops at 1,000 rows a request; read every page. */
async function readAll<T>(
  page: (
    from: number,
    to: number
  ) => PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE) return rows;
  }
}

async function main() {
  const service = createServiceClient();

  if (DRY_RUN_FLAG && process.argv.includes('--apply')) {
    console.log(
      'Both --dry-run and --apply were given. Running as a dry run.\n'
    );
  }

  const requests = await readAll<GradeChangeRow>((from, to) =>
    service
      .from('grade_change_requests')
      .select('id, status, approval_flow, requested_by_email, requested_at')
      .not('approval_flow', 'is', null)
      .order('requested_at', { ascending: true })
      .range(from, to)
  );

  if (requests.length === 0) {
    console.log(
      'No grade change requests have been filed on the approval steps yet. Nothing to check.'
    );
    return;
  }

  const approvals = await readAll<ApprovalRow>((from, to) =>
    service
      .from('approval_requests')
      .select('id, flow, subject_id, status')
      .eq('subject_type', GRADE_CHANGE_SUBJECT_TYPE)
      .in('flow', FLOWS)
      .order('created_at', { ascending: true })
      .range(from, to)
  );

  // Keyed on the flow too: the unique key is (flow, subject_type, subject_id),
  // and the row's own `approval_flow` names the ladder it was filed against.
  const approvalFor = new Map(
    approvals.map((a) => [`${a.flow}:${a.subject_id}`, a])
  );

  const stuck: Array<{
    row: GradeChangeRow;
    approval: ApprovalRow & { status: ClosedApprovalStatus };
  }> = [];
  const noLadder: GradeChangeRow[] = [];
  const otherMismatch: Array<{ row: GradeChangeRow; approval: ApprovalRow }> =
    [];

  for (const row of requests) {
    const approval = approvalFor.get(`${row.approval_flow}:${row.id}`);
    if (!approval) {
      noLadder.push(row);
      continue;
    }
    // ⚠ A LADDER PART-WAY THROUGH A STEP THAT NEEDS EVERYONE (migration 145)
    // lands here and is RIGHT: some people have approved, the request is still
    // `pending` on both sides, and nothing is stuck. Only the request status is
    // compared — never a step's own approvals — so partial approvals cannot be
    // read as drift.
    if (row.status === approval.status) continue;
    // Applying comes after approval and the ladder has no word for it.
    if (row.status === 'applied' && approval.status === 'approved') continue;

    if (row.status === 'pending' && isClosedApprovalStatus(approval.status)) {
      stuck.push({
        row,
        approval: approval as ApprovalRow & { status: ClosedApprovalStatus },
      });
    } else {
      otherMismatch.push({ row, approval });
    }
  }

  console.log(
    `Grade change requests on the approval steps: ${requests.length}`
  );
  console.log(`  still waiting, but already decided:  ${stuck.length}`);
  console.log(`  no approval request at all:          ${noLadder.length}`);
  console.log(`  other disagreements (report only):   ${otherMismatch.length}`);

  if (stuck.length > 0) {
    console.log(
      '\nFinished on the approval steps, but the request still reads as waiting:'
    );
    for (const { row, approval } of stuck) {
      console.log(
        `  ${row.id}  the steps say ${approval.status}, the request says ${row.status}  (filed ${row.requested_at.slice(0, 10)} by ${row.requested_by_email})`
      );
    }
  }

  if (noLadder.length > 0) {
    console.log(
      '\nFiled on the approval steps, but no approval request was ever opened.\n' +
        'Nobody can decide these; the teacher can still cancel them:'
    );
    for (const row of noLadder) {
      console.log(
        `  ${row.id}  ${row.status}  (filed ${row.requested_at.slice(0, 10)} by ${row.requested_by_email})`
      );
    }
  }

  if (otherMismatch.length > 0) {
    console.log(
      '\nThe request and its approval steps disagree in a way this script will\n' +
        'not guess at. Look at each one:'
    );
    for (const { row, approval } of otherMismatch) {
      console.log(
        `  ${row.id}  the steps say ${approval.status}, the request says ${row.status}`
      );
    }
  }

  if (!APPLY) {
    console.log(
      stuck.length > 0
        ? '\nDry run. Nothing has been changed. Re-run with --apply to bring the waiting ones up to date.'
        : '\nDry run. Nothing to repair.'
    );
    return;
  }

  let repaired = 0;
  let movedOn = 0;
  let failed = 0;
  for (const { row, approval } of stuck) {
    const result = await reprojectGradeChangeRequest(service, {
      gradeChangeRequestId: row.id,
      approvalRequestId: approval.id,
      status: approval.status,
    });
    if (result.ok) {
      repaired += 1;
    } else if (result.reason === 'row_moved_on') {
      movedOn += 1;
    } else {
      failed += 1;
      console.error(`  could not update ${row.id}: ${result.message}`);
    }
  }

  console.log(`\nBrought ${repaired} request(s) up to date.`);
  if (movedOn > 0) {
    console.log(
      `${movedOn} had already moved on by the time this reached them, and were left alone.`
    );
  }
  if (failed > 0) {
    console.log(`⚠ ${failed} could not be updated. See the errors above.`);
  }
  if (repaired > 0) {
    console.log(
      'Some Markbook screens can take about a minute to show the new status. No audit rows or emails were written.'
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
