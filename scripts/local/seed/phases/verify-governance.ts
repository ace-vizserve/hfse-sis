// The Phase 6 check (declarations + approvals, discipline, classroom notes),
// called from `verify`. Prints the counts against production (prod-profile.md)
// and proves:
//   * every reachable declaration status and approval state is present (no
//     cancelled one — no app path withdraws a filing), each filing has
//     exactly one ladder of two steps, no ladder is orphaned, the parent's
//     status agrees with its ladder, and every approved filing's register
//     write landed;
//   * step 1 was decided by the class's own form adviser, step 2 by the
//     officer in charge for the child's half — and both officers decided;
//   * every approved register-writing filing marked each of its school days
//     EX with the filing's reason (`mc` / `vacation`), and the A marks it
//     turned into EX are counted;
//   * every uploaded certificate is in the `parent-portal` bucket;
//   * the app's own loaders return the rows: the declarations queue
//     (`listInboxStages` / `listDecidedStages` / `loadStaffDeclarations`) for
//     an adviser, each officer and an oversight role, the parent's tracker
//     (`listParentDeclarations`, with the rejection reason), the student
//     page's discipline tab (`listDisciplineForStudent`) and each teacher's
//     own class note through RLS (`getClassroomNote`).
// Ends with a content fingerprint (two rebuilds must print the same one).

import { createHash } from 'node:crypto';

import { listDecidedStages, listInboxStages } from '@/lib/approvals/inbox';
import type { Role } from '@/lib/auth/roles';
import { getClassroomNote } from '@/lib/classroom/queries';
import { DECLARATION_APPROVAL_FLOW } from '@/lib/declarations/approval';
import {
  listParentDeclarations,
  loadFilableStudents,
} from '@/lib/declarations/parent';
import { loadStaffDeclarations } from '@/lib/declarations/staff';
import { listDisciplineForStudent } from '@/lib/discipline/queries';
import { findStudentByNumber } from '@/lib/sis/records-history';

import { LOCAL_PARENT_MARK, LOCAL_PASSWORD } from '../lib/constants';
import { anon, service, sql, sqlRows } from '../lib/local';
import { noteWriters } from './classroom-notes';
import { disciplineTarget } from './discipline';
import { STAFF, emailOf, staffId } from './staff';

const num = (q: string) => Number(sql(q).trim());
const failures: string[] = [];
function check(ok: boolean, what: string) {
  if (!ok) failures.push(what);
}

const PARENT = `filed_by in (select id from auth.users where raw_app_meta_data->>'${LOCAL_PARENT_MARK.key}' = '${LOCAL_PARENT_MARK.value}')`;
const FLOW = `'${DECLARATION_APPROVAL_FLOW}'`;

export async function verifyGovernance(): Promise<void> {
  const sb = service();

  // ── Declarations ──────────────────────────────────────────────────────
  const byStatus =
    sqlRows(`select case when ${PARENT} then 'parent' else 'school' end, declaration_type,
      status, count(*), count(evidence_path), count(evidence_url), count(parent_note), count(register_written_at)
      from student_declarations group by 1, 2, 3 order by 1, 2, 3`);
  console.log(
    '  student_declarations (filed by | type | status | n | upload | link | parent note | register written)  [prod 8: approved 5 / rejected 3, absence w/ MC, plain absence, travel]'
  );
  for (const r of byStatus) console.log(`    ${r.join(' | ')}`);
  const parentStatus = (s: string) =>
    byStatus
      .filter((r) => r[0] === 'parent' && r[2] === s)
      .reduce((n, r) => n + Number(r[3]), 0);
  const parentTotal = byStatus
    .filter((r) => r[0] === 'parent')
    .reduce((n, r) => n + Number(r[3]), 0);
  check(parentTotal === 15, `${parentTotal} parent declarations, want 15`);
  for (const s of ['pending', 'approved', 'rejected'])
    check(parentStatus(s) >= 1, `no parent declaration ${s}`);
  // No path in the app or the portal withdraws a filing, so none is seeded.
  check(
    !byStatus.some((r) => r[2] === 'cancelled'),
    'a declaration is cancelled (no app path reaches that status)'
  );
  const unwritten = num(`select count(*) from student_declarations
      where ${PARENT} and status = 'approved' and register_written_at is null`);
  check(
    unwritten === 0,
    `${unwritten} approved parent filings with no register write`
  );
  check(
    byStatus.some((r) => r[0] === 'parent' && r[1] === 'travel'),
    'no travel declaration'
  );
  const school = byStatus.filter((r) => r[0] === 'school');
  check(
    school.length === 1 && school[0][2] === 'approved' && school[0][7] === '0',
    'want one school-recorded certificate, approved, no register write'
  );
  const siblings =
    num(`select count(*) from (select filing_group_id from student_declarations
      group by 1 having count(*) > 1) g`);
  console.log(`  filings naming two children (one group): ${siblings}`);

  // ── Ladders ───────────────────────────────────────────────────────────
  const reqs = sqlRows(
    `select status, count(*) from approval_requests where flow = ${FLOW} group by 1 order by 1`
  );
  const stages =
    sqlRows(`select s.stage_order, s.label, s.status, count(*) from approval_request_stages s
      join approval_requests r on r.id = s.request_id where r.flow = ${FLOW} group by 1, 2, 3 order by 1, 3`);
  const decisions =
    sqlRows(`select s.stage_order, d.decision, count(*) from approval_request_stage_decisions d
      join approval_request_stages s on s.id = d.request_stage_id join approval_requests r on r.id = s.request_id
     where r.flow = ${FLOW} group by 1, 2 order by 1, 2`);
  const allFlows = sqlRows(
    `select flow, status, count(*) from approval_requests group by 1, 2 order by 1, 2`
  );
  console.log(
    `  approval_requests (declarations): ${reqs.map(([s, n]) => `${s} ${n}`).join(', ')}; all flows: ${allFlows.map((r) => r.join(' ')).join(', ')}  [prod 8 declarations (5 approved / 3 rejected) + 2 grade changes]`
  );
  console.log(
    `  stages: ${stages.map(([o, l, s, n]) => `#${o} ${l} ${s} ${n}`).join(', ')}; decisions: ${decisions.map(([o, d, n]) => `#${o} ${d} ${n}`).join(', ')}`
  );
  for (const s of ['pending', 'approved', 'rejected'])
    check(
      reqs.some((r) => r[0] === s),
      `no declaration approval request ${s}`
    );
  check(
    !reqs.some((r) => r[0] === 'cancelled'),
    'a declaration approval request is cancelled'
  );
  const orphans =
    num(`select count(*) from approval_requests r where r.subject_type = 'student_declaration'
      and not exists (select 1 from student_declarations d where d.id = r.subject_id)`);
  check(orphans === 0, `${orphans} declaration ladders with no filing`);
  const ladderBad =
    num(`select count(*) from student_declarations d where ${PARENT} and (
        (select count(*) from approval_requests r where r.subject_type = 'student_declaration' and r.subject_id = d.id) <> 1
     or (select count(*) from approval_request_stages s join approval_requests r on r.id = s.request_id
          where r.subject_id = d.id) <> 2
     or (select r.status from approval_requests r where r.subject_id = d.id) is distinct from d.status)`);
  check(
    ladderBad === 0,
    `${ladderBad} parent declarations without one two-step ladder matching their status`
  );
  const schoolLadder =
    num(`select count(*) from approval_requests r join student_declarations d on d.id = r.subject_id
      where not (${PARENT.replace('filed_by', 'd.filed_by')})`);
  check(schoolLadder === 0, 'a school-recorded certificate has a ladder');

  // Step 1 by the class's form adviser; step 2 by the officer for the half.
  const oic = (key: 'oicPrimary' | 'oicSecondary') =>
    staffId(STAFF.find((s) => s.key === key)!);
  const wrongFca =
    num(`select count(*) from approval_request_stages s join approval_requests r on r.id = s.request_id
      join student_declarations d on d.id = r.subject_id
     where r.flow = ${FLOW} and s.stage_order = 1 and s.decided_by is not null
       and not exists (select 1 from teacher_assignments ta where ta.section_id = d.section_id
                        and ta.role = 'form_adviser' and ta.teacher_user_id = s.decided_by)`);
  const oicRows =
    sqlRows(`select l.level_type, s.decided_by, count(*) from approval_request_stages s
      join approval_requests r on r.id = s.request_id join student_declarations d on d.id = r.subject_id
      join sections sec on sec.id = d.section_id join levels l on l.id = sec.level_id
     where r.flow = ${FLOW} and s.stage_order = 2 and s.decided_by is not null group by 1, 2 order by 1`);
  const wrongOic = oicRows.filter(
    ([half, by]) =>
      by !== oic(half === 'primary' ? 'oicPrimary' : 'oicSecondary')
  ).length;
  console.log(
    `  step 1 decided by someone other than the class's form adviser: ${wrongFca}; step 2 decisions by half: ${oicRows.map(([h, by, n]) => `${h} ${STAFF.find((s) => staffId(s) === by)?.key ?? by} ${n}`).join(', ')}`
  );
  check(wrongFca === 0, `${wrongFca} adviser steps decided by someone else`);
  check(wrongOic === 0, 'an officer decided the other half');
  check(
    new Set(oicRows.map((r) => r[1])).size === 2,
    'both officers in charge must have decided'
  );

  // ── The register ──────────────────────────────────────────────────────
  // Every school day of an approved parent filing: latest mark EX with the
  // filing's reason. `register_days_written` is the app's own day count.
  const marks =
    sqlRows(`with f as (select d.id, d.section_student_id, d.start_date, d.end_date, d.declaration_type,
                 d.register_days_written n from student_declarations d where ${PARENT.replace('filed_by', 'd.filed_by')}
                 and d.status = 'approved'),
        latest as (select distinct on (a.section_student_id, a.date) a.section_student_id, a.date, a.status, a.ex_reason
                     from attendance_daily a join f on f.section_student_id = a.section_student_id
                      and a.date between f.start_date and f.end_date
                    order by a.section_student_id, a.date, a.recorded_at desc, a.id desc)
      select count(distinct f.id), coalesce(sum(f.n), 0)::int,
             (select count(*) from latest l join f on f.section_student_id = l.section_student_id
               and l.date between f.start_date and f.end_date),
             (select count(*) from latest l join f on f.section_student_id = l.section_student_id
               and l.date between f.start_date and f.end_date
               where l.status = 'EX' and l.ex_reason = case f.declaration_type when 'travel' then 'vacation' else 'mc' end)
        from f`)[0];
  const [approvedN, daysWritten, daysMarked, daysEx] = marks.map(Number);
  const conversions =
    sqlRows(`select coalesce(context->>'prior_status', '(none)'), count(*) from audit_log
      where action like 'attendance.daily.%' and context->>'source' = 'declaration_approval' group by 1 order by 1`);
  const fromA = Number(conversions.find((c) => c[0] === 'A')?.[1] ?? 0);
  console.log(
    `  approved parent filings ${approvedN}: register days written ${daysWritten} (app's count), marked days in range ${daysMarked}, now EX with the filing's reason ${daysEx}; the approvals' register audit rows by prior mark: ${conversions.map(([p, n]) => `${p}→EX ${n}`).join(', ')}`
  );
  check(approvedN >= 5, `${approvedN} approved parent filings`);
  check(
    daysWritten > 0 && daysEx === daysWritten && daysMarked === daysWritten,
    `register: ${daysWritten} written, ${daysMarked} in range, ${daysEx} EX`
  );
  check(fromA >= 4, `only ${fromA} A→EX conversions`);

  // ── Evidence ──────────────────────────────────────────────────────────
  const [paths, stored] =
    sqlRows(`select count(*), count(o.id) from student_declarations d
      left join storage.objects o on o.bucket_id = 'parent-portal' and o.name = d.evidence_path
     where d.evidence_path is not null`)[0].map(Number);
  const kinds =
    sqlRows(`select case when evidence_path is not null and evidence_url is not null then 'both'
        when evidence_path is not null then 'file' when evidence_url is not null then 'link' else 'none' end, count(*)
      from student_declarations where declaration_type = 'absence' group by 1 order by 1`);
  console.log(
    `  certificates: ${stored} of ${paths} uploaded files in the parent-portal bucket; absence evidence ${kinds.map((k) => k.join(' ')).join(', ')}`
  );
  check(
    paths > 0 && stored === paths,
    `${paths - stored} certificate files missing from storage`
  );
  const audits = sqlRows(
    `select action, count(*) from audit_log where action like 'declaration.%' group by 1 order by 1`
  );
  console.log(
    `  declaration audit: ${audits.map((a) => a.join(' ')).join(', ')}`
  );
  for (const a of [
    'declaration.file',
    'declaration.approve',
    'declaration.reject',
    'declaration.file.staff',
    'declaration.evidence.attach',
  ])
    check(
      audits.some((x) => x[0] === a),
      `no ${a} audit row`
    );

  // ── The app's loaders ─────────────────────────────────────────────────
  const queue = async (userId: string, role: Role) => {
    const scope = { flow: DECLARATION_APPROVAL_FLOW, userId, role };
    const [waiting, decided] = await Promise.all([
      listInboxStages(sb, scope),
      listDecidedStages(sb, scope),
    ]);
    const views = await loadStaffDeclarations(
      sb,
      [...waiting, ...decided].map((s) => s.subjectId)
    );
    return {
      waiting: waiting.length,
      mine: waiting.filter((s) => s.canDecide).length,
      decided: decided.length,
      views: views.length,
    };
  };
  const [fcaId] =
    sqlRows(`select s.decided_by from approval_request_stages s join approval_requests r on r.id = s.request_id
      where r.flow = ${FLOW} and s.stage_order = 1 and s.decided_by is not null order by s.decided_by limit 1`)[0];
  const lines: string[] = [];
  const fca = await queue(fcaId, 'teacher');
  lines.push(
    `adviser ${STAFF.find((s) => staffId(s) === fcaId)?.local ?? fcaId}: ${JSON.stringify(fca)}`
  );
  check(
    fca.decided > 0 && fca.views >= fca.decided,
    'the adviser queue shows nothing they decided'
  );
  for (const key of ['oicPrimary', 'oicSecondary'] as const) {
    const q = await queue(oic(key), 'school_admin');
    lines.push(`${key}: ${JSON.stringify(q)}`);
    check(q.views > 0, `${key}'s queue is empty`);
  }
  const admin = STAFF.find((s) => s.key === 'superadmin')!;
  const all = await queue(staffId(admin), 'superadmin');
  lines.push(`superadmin: ${JSON.stringify(all)}`);
  check(
    all.waiting === parentStatus('pending'),
    `oversight sees ${all.waiting} waiting, want ${parentStatus('pending')}`
  );
  console.log(
    `  declarations queue (listInboxStages / listDecidedStages → loadStaffDeclarations): ${lines.join('; ')}`
  );

  // The parent's tracker, for a parent whose filing was turned down.
  const [rejParent] =
    sqlRows(`select u.email from student_declarations d join auth.users u on u.id = d.filed_by
      where d.status = 'rejected' order by u.email limit 1`)[0];
  const tracker = await listParentDeclarations(sb, {
    students: await loadFilableStudents(sb, rejParent),
  });
  const withReason = tracker.filter(
    (d) => d.status === 'rejected' && d.decisionReason
  );
  console.log(
    `  parent tracker (${rejParent}): ${tracker.map((d) => `${d.declarationType} ${d.statusLabel}${d.decisionReason ? ` — "${d.decisionReason}"` : ''}`).join('; ')}`
  );
  check(withReason.length >= 1, 'the parent tracker shows no rejection reason');

  // ── Discipline ────────────────────────────────────────────────────────
  const disc = sqlRows(
    `select record_type, count(*), count(acknowledged_on), count(document_url) from student_discipline_records group by 1 order by 1`
  );
  const target = disciplineTarget();
  const student = await findStudentByNumber(target.studentNumber);
  const tab = student ? await listDisciplineForStudent(student.studentId) : [];
  const discAudit = num(
    `select count(*) from audit_log where action = 'discipline.record.file'`
  );
  console.log(
    `  student_discipline_records (type | n | acknowledged | link): ${disc.map((d) => d.join(' | ')).join('; ')}; student page tab (listDisciplineForStudent ${target.studentNumber}): ${tab.map((t) => t.recordType).join(', ')}; discipline.record.file audit ${discAudit}  [prod 1 incident]`
  );
  check(
    disc.some((d) => d[0] === 'incident') &&
      disc.some((d) => d[0] === 'letter'),
    'discipline: want both record types'
  );
  check(tab.length === 2, `discipline tab shows ${tab.length}, want 2`);
  // The incident happened in school: the child's latest mark that day is P.
  const absentAtIncident =
    num(`select count(*) from student_discipline_records r
      where r.record_type = 'incident' and coalesce((select d.status from attendance_daily d
        join section_students ss on ss.id = d.section_student_id
       where ss.student_id = r.student_id and ss.section_id = r.section_id and d.date = r.occurred_on
       order by d.recorded_at desc, d.id desc limit 1), '') <> 'P'`);
  check(
    absentAtIncident === 0,
    `${absentAtIncident} incidents dated a day the child was not marked present`
  );
  check(discAudit === 2, `${discAudit} discipline audit rows, want 2`);

  // ── Classroom notes ───────────────────────────────────────────────────
  const notes = num('select count(*) from classroom_notes');
  const noteAudit = num(
    `select count(*) from audit_log where action = 'classroom.note.save'`
  );
  let readable = 0;
  for (const n of noteWriters()) {
    const s = STAFF.find((x) => emailOf(x) === n.writer.email)!;
    const client = anon();
    await client.auth.signInWithPassword({
      email: emailOf(s),
      password: LOCAL_PASSWORD,
    });
    const own = await getClassroomNote(client, n.sectionId);
    if (own?.content === n.content) readable++;
    await client.auth.signOut();
  }
  console.log(
    `  classroom_notes: ${notes} (audit classroom.note.save ${noteAudit}); each teacher reads their own through RLS (getClassroomNote): ${readable}/${noteWriters().length}  [prod 0 — live, unused]`
  );
  check(
    notes === 3 && noteAudit === 3,
    `notes ${notes} / audit ${noteAudit}, want 3 / 3`
  );
  check(readable === 3, `${readable} of 3 notes readable by their writer`);

  // ── Fingerprint ───────────────────────────────────────────────────────
  // Stable columns only: no ids, no `updated_at` / decision times (the
  // database's clock); the declaration's created_at is the simulated filing
  // moment and counts. Free text as md5, so a line break cannot shift a row.
  const fp = createHash('sha256')
    .update(
      sql(`select st.student_number, d.declaration_type, d.start_date, d.end_date, d.status,
             coalesce(d.with_medical::text, ''), coalesce(d.evidence_path, ''), coalesce(d.evidence_url, ''),
             coalesce(d.destination_city, ''), md5(coalesce(d.parent_note, '')), d.filed_by_email,
             d.created_at, coalesce(d.register_days_written::text, ''),
             coalesce((select string_agg(s.stage_order || ':' || s.status || ':' || coalesce(s.decided_by_email, '')
                                           || ':' || md5(coalesce(s.decision_note, '')), ',' order by s.stage_order)
                         from approval_request_stages s join approval_requests r on r.id = s.request_id
                        where r.subject_id = d.id), '')
           from student_declarations d join students st on st.id = d.student_id order by 1, 2, 3`)
    )
    .update(
      sql(`select st.student_number, r.record_type, r.occurred_on, coalesce(r.occurred_at_time::text, ''), r.nature,
             md5(r.details), md5(coalesce(r.remarks, '')), coalesce(r.document_url, ''),
             coalesce(r.acknowledged_on::text, ''), coalesce(r.filed_by_office, ''), r.filed_by
           from student_discipline_records r join students st on st.id = r.student_id order by 1, 2, 3`)
    )
    .update(
      sql(
        `select n.section_id, n.teacher_user_id, md5(n.content) from classroom_notes n order by 1, 2`
      )
    )
    .digest('hex')
    .slice(0, 16);
  console.log(`  governance fingerprint: ${fp}`);
  if (failures.length)
    throw new Error(
      `governance check failed:\n    - ${failures.join('\n    - ')}`
    );
  console.log('  governance check: PASS');
}
