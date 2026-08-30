// scripts/repair-declaration-approvals.ts
//
// Finds declarations that are not on the approval ladder, and the ones whose
// status has drifted from it.
//
// ⚠ WHY THIS EXISTS. A declaration with no approval request is the worst
// failure shape this feature has, because every screen looks fine: the parent
// reads "With the school", and no staff queue anywhere shows it. Forever. Three
// things can produce one, and only the first is a bug:
//
//   1. the ladder write failed after the filing landed — the route takes the
//      rows back out when that happens, so this should find nothing;
//   2. the filing arrived BEFORE anybody configured the steps — deliberate, so
//      that a parent is never turned away over an administrator's unfinished
//      setup (lib/declarations/approval.ts says why at length);
//   3. it was filed between Phase 1 shipping (2026-08-27) and the approval
//      engine landing.
//
// Two and three are exactly what `--apply` is for.
//
// It also reports DRIFT: a request that finished while the projection onto
// `student_declarations.status` failed. The decide route reports that failure
// to the person who acted, but nothing else would ever mention it again.
//
// ⚠ AND IT REPAIRS LADDERS BUILT BEFORE MIGRATION 128. Those rows carry no
// `level_type`, so nothing can tell which half of the school the child is in —
// and the moment the officer in charge is split into a Primary holder and a
// Secondary one, rebuilding such a row's pool would come back EMPTY and strand
// the filing. Stamping the half first is what stops the fix breaking the very
// requests it is meant to route correctly.
//
// ⚠ AND IT MARKS THE REGISTER FOR APPROVED ABSENCES THAT NEVER GOT MARKED.
// Phase 3 made the final approval write EX marks onto the attendance sheet.
// Two kinds of filing carry an `approved` status with no marks behind it:
// anything approved BEFORE Phase 3 shipped, and anything whose write failed
// (the decide route deliberately keeps the approval and records the failure
// rather than losing a decision two people already made). Both look identical
// from the outside — an approved absence whose days are still blank on the
// register — and both are fixed the same way.
//
// ⚠ Re-running a write that already succeeded is HARMLESS but not free:
// `attendance_daily` is append-only, so it supersedes each day with an
// identical mark. That is why the search keys on a missing
// `register_written_at` rather than re-marking everything approved.
//
// READ-ONLY BY DEFAULT. Pass `--apply` to open the missing requests,
// re-project the drifted statuses and mark the unmarked registers. Nothing is
// ever deleted.
//
// Run:
//   npx tsx --env-file=.env.local scripts/repair-declaration-approvals.ts
//   npx tsx --env-file=.env.local scripts/repair-declaration-approvals.ts --apply
import { createServiceClient } from '../lib/supabase/service';
import {
  openApprovalRequest,
  repointWaitingStages,
} from '../lib/approvals/materialise';
import {
  DECLARATION_APPROVAL_FLOW,
  DECLARATION_SUBJECT_TYPE,
  loadLevelTypesBySection,
} from '../lib/declarations/approval';
import { writeRegisterForDeclaration } from '../lib/declarations/register';

const APPLY = process.argv.includes('--apply');

async function main() {
  const service = createServiceClient();

  const { data: declarationRows, error } = await service
    .from('student_declarations')
    .select(
      'id, section_id, status, declaration_type, filed_by, filed_by_email, start_date, end_date, created_at, register_written_at, register_write_error'
    )
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);

  const declarations = (declarationRows ?? []) as Array<{
    id: string;
    section_id: string;
    status: string;
    declaration_type: string;
    filed_by: string | null;
    filed_by_email: string;
    start_date: string;
    end_date: string;
    created_at: string;
    register_written_at: string | null;
    register_write_error: string | null;
  }>;

  if (declarations.length === 0) {
    console.log('No declarations have been filed yet. Nothing to check.');
    return;
  }

  const { data: requestRows, error: requestErr } = await service
    .from('approval_requests')
    .select('id, subject_id, status')
    .eq('flow', DECLARATION_APPROVAL_FLOW)
    .eq('subject_type', DECLARATION_SUBJECT_TYPE);
  if (requestErr) throw new Error(requestErr.message);

  const requestBySubject = new Map(
    (
      (requestRows ?? []) as Array<{
        id: string;
        subject_id: string;
        status: string;
      }>
    ).map((r) => [r.subject_id, r])
  );

  const missing = declarations.filter(
    (d) => d.status === 'pending' && !requestBySubject.has(d.id)
  );

  // The request finished but the declaration never caught up. `pending` on a
  // finished request is the drift that matters; the reverse cannot happen,
  // because nothing but the decide route writes either side.
  const drifted = declarations.filter((d) => {
    const request = requestBySubject.get(d.id);
    if (!request) return false;
    if (request.status === 'approved' && d.status !== 'approved') return true;
    if (request.status === 'rejected' && d.status !== 'rejected') return true;
    return false;
  });

  // Ladder rows built before migration 128, still undecided, with no half
  // recorded. These are the ones that would strand if the officer in charge
  // were split by half while they carry no half of their own.
  const pendingRequestIds = (
    (requestRows ?? []) as Array<{ id: string; status: string }>
  )
    .filter((r) => r.status === 'pending')
    .map((r) => r.id);

  const unstamped: Array<{ id: string; requestId: string }> = [];
  if (pendingRequestIds.length > 0) {
    const { data: stageRows, error: stageErr } = await service
      .from('approval_request_stages')
      .select('id, request_id, level_type, status')
      .in('request_id', pendingRequestIds)
      .in('status', ['pending', 'waiting'])
      .is('level_type', null);
    if (stageErr) throw new Error(stageErr.message);
    for (const row of (stageRows ?? []) as Array<{
      id: string;
      request_id: string;
    }>) {
      unstamped.push({ id: row.id, requestId: row.request_id });
    }
  }

  // Approved filings whose days never landed on the attendance sheet.
  //
  // ⚠ Travel is INCLUDED as of Phase 4. It was excluded while travel marked
  // nothing — listing it then would have reported a permanent, growing
  // backlog of work that did not exist. Now that an approved trip writes
  // `EX` / `vacation`, a travel filing with no stamp is a real gap, and the
  // filings approved before Phase 4 shipped are exactly what this finds.
  //
  // 🔴 A FILING WITH NO LADDER IS EXCLUDED, AND THIS IS LOAD-BEARING.
  // `POST /api/declarations/staff` — a member of staff attaching a medical
  // certificate the parent could not file — inserts the row ALREADY APPROVED
  // and deliberately opens no approval request, because the school recording
  // its own evidence has nobody left to vet it. It also deliberately leaves
  // `register_written_at` null, because the person doing it is already marking
  // the day `EX` through the normal attendance path — that IS the register
  // write.
  //
  // Without this clause every one of those rows reads here as "approved but
  // the sheet was never marked", and `--apply` would write a SECOND `EX` for
  // each day: `attendance_daily` is append-only, so nothing errors and nothing
  // is overwritten — the duplicate simply lands under the teacher's own mark
  // with no actor on it. Having a request is the exact test, because it is the
  // ladder's approval that KD #197's register write hangs off; a filing that
  // never had one was never going to be marked from here.
  const unmarked = declarations.filter(
    (d) =>
      d.status === 'approved' &&
      d.register_written_at == null &&
      requestBySubject.has(d.id)
  );

  console.log(`Declarations: ${declarations.length}`);
  console.log(`  on the ladder:      ${requestBySubject.size}`);
  console.log(`  waiting, no ladder: ${missing.length}`);
  console.log(`  status drifted:     ${drifted.length}`);
  console.log(`  no school half yet: ${unstamped.length}`);
  console.log(`  register unmarked:  ${unmarked.length}`);

  if (unmarked.length > 0) {
    console.log(
      '\nApproved, but the attendance sheet was never marked. The child shows\n' +
        'as absent (or blank) on days the school has already excused:'
    );
    for (const d of unmarked) {
      const why = d.register_write_error
        ? `failed: ${d.register_write_error}`
        : 'never attempted';
      console.log(`  ${d.id}  ${d.start_date} → ${d.end_date}  (${why})`);
    }
  }

  if (unstamped.length > 0) {
    console.log(
      '\nWaiting, but the ladder does not record which half of the school the\n' +
        'child is in. Splitting the officer in charge by half would leave these\n' +
        'with nobody able to act:'
    );
    for (const row of unstamped) {
      console.log(`  step ${row.id}  on request ${row.requestId}`);
    }
  }

  if (missing.length > 0) {
    console.log(
      '\nWaiting, but on no ladder — invisible to every staff queue:'
    );
    for (const d of missing) {
      console.log(
        `  ${d.id}  filed ${d.created_at.slice(0, 10)} by ${d.filed_by_email}  (${d.start_date} → ${d.end_date})`
      );
    }
  }

  if (drifted.length > 0) {
    console.log('\nDecided, but the parent still sees the old status:');
    for (const d of drifted) {
      const request = requestBySubject.get(d.id);
      console.log(
        `  ${d.id}  request says ${request?.status}, declaration says ${d.status}`
      );
    }
  }

  if (!APPLY) {
    if (
      missing.length > 0 ||
      drifted.length > 0 ||
      unstamped.length > 0 ||
      unmarked.length > 0
    ) {
      console.log(
        '\nRe-run with --apply to fix these. Nothing has been changed.'
      );
    } else {
      console.log('\nNothing to repair.');
    }
    return;
  }

  // Which half of the school each child is in — that is what picks the right
  // officer in charge (migration 128).
  const levelTypes = await loadLevelTypesBySection(
    service,
    missing.map((d) => d.section_id)
  );

  let opened = 0;
  let unconfigured = 0;
  for (const d of missing) {
    const result = await openApprovalRequest(service, {
      flow: DECLARATION_APPROVAL_FLOW,
      subjectType: DECLARATION_SUBJECT_TYPE,
      subjectId: d.id,
      sectionId: d.section_id,
      levelType: levelTypes.get(d.section_id) ?? null,
      filedBy: d.filed_by,
      filedByEmail: d.filed_by_email,
    });
    if (result.opened) {
      opened += 1;
    } else if (result.reason === 'no_stages_configured') {
      unconfigured += 1;
    }
  }

  let reprojected = 0;
  for (const d of drifted) {
    const request = requestBySubject.get(d.id);
    if (!request) continue;
    const { error: updateErr } = await service
      .from('student_declarations')
      .update({ status: request.status, updated_at: new Date().toISOString() })
      .eq('id', d.id);
    if (updateErr) {
      console.error(`  could not re-project ${d.id}: ${updateErr.message}`);
      continue;
    }
    reprojected += 1;
  }

  // ── Stamp the school half onto ladders built before migration 128 ────────
  //
  // The subject id of a declaration request IS the declaration id, so the
  // child's section — and from it the half — is one lookup away.
  let stamped = 0;
  if (unstamped.length > 0) {
    const declarationById = new Map(declarations.map((d) => [d.id, d]));
    const subjectByRequestId = new Map(
      ((requestRows ?? []) as Array<{ id: string; subject_id: string }>).map(
        (r) => [r.id, r.subject_id]
      )
    );

    const sectionIds = unstamped
      .map((row) => subjectByRequestId.get(row.requestId))
      .map((subjectId) =>
        subjectId ? declarationById.get(subjectId)?.section_id : undefined
      )
      .filter((s): s is string => Boolean(s));

    const halves = await loadLevelTypesBySection(service, sectionIds);

    for (const row of unstamped) {
      const subjectId = subjectByRequestId.get(row.requestId);
      const declaration = subjectId
        ? declarationById.get(subjectId)
        : undefined;
      const half = declaration
        ? (halves.get(declaration.section_id) ?? null)
        : null;
      // Nothing to record, and writing null over null helps nobody.
      if (!half) continue;
      const { error: stampErr } = await service
        .from('approval_request_stages')
        .update({ level_type: half })
        .eq('id', row.id);
      if (stampErr) {
        console.error(`  could not stamp ${row.id}: ${stampErr.message}`);
        continue;
      }
      stamped += 1;
    }
  }

  // ── Rebuild the pools now that every waiting row knows its half ──────────
  //
  // ⚠ RUNS EVEN WHEN NOTHING WAS STAMPED. The other reason a waiting row holds
  // the wrong people is that the step's list changed while it sat in the
  // queue — which is exactly what fixing the officer in charge does.
  let repointed = 0;
  const { data: activeStages, error: activeErr } = await service
    .from('approval_stages')
    .select('id')
    .eq('flow', DECLARATION_APPROVAL_FLOW)
    .eq('is_active', true);
  if (activeErr) {
    console.error(`  could not read the steps: ${activeErr.message}`);
  } else {
    for (const stage of (activeStages ?? []) as Array<{ id: string }>) {
      repointed += await repointWaitingStages(service, stage.id);
    }
  }

  // ── Mark the registers that never got marked ────────────────────────────
  //
  // ⚠ NO ACTOR. `recorded_by` goes in as null, and that is honest: nobody
  // clicked anything. A repair run is the school's own correction, not a
  // person's decision, and stamping whoever happened to run the script would
  // put a name on the register that never touched it.
  let marked = 0;
  let markDays = 0;
  for (const d of unmarked) {
    const result = await writeRegisterForDeclaration(service, d.id, null);
    if (!result.ok) {
      console.error(`  could not mark ${d.id}: ${result.error}`);
      continue;
    }
    marked += 1;
    markDays += result.written;
  }

  console.log(
    `\nOpened ${opened} request(s); re-projected ${reprojected} status(es).`
  );
  if (marked > 0) {
    console.log(
      `Marked ${markDays} day(s) as excused across ${marked} filing(s).`
    );
  }
  if (stamped > 0) {
    console.log(`Recorded the school half on ${stamped} waiting step(s).`);
  }
  if (repointed > 0) {
    console.log(
      `Moved ${repointed} waiting step(s) onto whoever holds the job now.`
    );
  }
  if (unconfigured > 0) {
    console.log(
      `⚠ ${unconfigured} could not be opened because the flow has no steps set up. Configure them at /sis/admin/approvers, then run this again.`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
