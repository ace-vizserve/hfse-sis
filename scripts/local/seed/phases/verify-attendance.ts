// The Phase 4 check (attendance), called from `verify`. Prints the register
// against production's figures (prod-profile.md §5) and proves:
//   * no mark on a day that is not a teaching day for the class (the
//     database's own `attendance_write_blocked`), and none outside the
//     child's time on the class list;
//   * one row per child per school day, plus exactly the corrections/clears
//     the daily route appended;
//   * `attendance_records` equals a recomputation from the ledger (latest
//     mark per day, from enrollment_date) for every (term, child), and there
//     is one per (term, child) with marks;
//   * every route-entered mark has its audit row;
//   * the app's own leave-quota readers see the over-quota children.
// Ends with a content fingerprint (two rebuilds must print the same one).

import { createHash } from 'node:crypto';

import { getCompassionateOverQuota } from '@/lib/attendance/drill';
import { getVacationLeaveUsageForSection } from '@/lib/attendance/queries';

import { runDateSg } from '../lib/constants';
import { sql, sqlRows } from '../lib/local';
import { loadRoster } from '../attendance/roster';
import { runDependentRegisterKeys } from './attendance';

const num = (q: string) => Number(sql(q).trim());
const failures: string[] = [];
function check(ok: boolean, what: string) {
  if (!ok) failures.push(what);
}

const AD = `attendance_daily d join terms t on t.id = d.term_id
  join academic_years a on a.id = t.academic_year_id`;
/** Latest mark per (enrolment, day). */
const LATEST = `(select distinct on (d.section_student_id, d.date) d.*, a.ay_code, t.term_number
   from ${AD} order by d.section_student_id, d.date, d.recorded_at desc, d.id desc)`;

/** prod rows per AY × term (all statuses). */
const PROD_ROWS: Record<string, number> = {
  'AY2025 1': 17644,
  'AY2025 2': 16273,
  'AY2025 3': 17284,
  'AY2025 4': 14630,
  'AY2026 1': 16143,
  'AY2026 2': 14796,
  'AY2026 3': 17585,
  'AY2026 4': 6500,
};

export async function verifyAttendance(): Promise<void> {
  // ── Rows per AY × term ────────────────────────────────────────────────
  const perTerm = sqlRows(`select a.ay_code || ' ' || t.term_number, count(*),
      count(distinct d.section_student_id), count(distinct d.date), count(d.recorded_by),
      count(*) filter (where d.status = 'P'), count(*) filter (where d.status = 'EX'),
      count(*) filter (where d.status = 'A'), count(*) filter (where d.status = 'L'),
      count(*) filter (where d.status = 'NC'), count(*) filter (where d.status is null)
      from ${AD} group by 1 order by 1`);
  console.log(
    '  attendance_daily per AY × term: rows | children | dates | recorded_by set | P EX A L NC null  [prod rows]'
  );
  for (const [k, n, kids, dates, rb, ...mix] of perTerm)
    console.log(
      `    ${k}: ${n} | ${kids} | ${dates} | ${rb} | ${mix.join(' ')}  [${PROD_ROWS[k] ?? '?'}]`
    );
  check(
    perTerm.length === 8,
    `attendance in ${perTerm.length} AY × terms, want 8`
  );

  const mix = sqlRows(`select coalesce(status, '(cleared)'), count(*),
      round(100.0 * count(*) / sum(count(*)) over (), 2) from attendance_daily group by 1 order by 2 desc`);
  console.log(
    `  status mix (all rows): ${mix.map(([s, n, p]) => `${s} ${n} (${p}%)`).join(', ')}  [prod P 92.5% · EX 2.6% · A 1.8% · L 0.7% · NC 27 · cleared 22]`
  );
  const pct = (s: string) => Number(mix.find((m) => m[0] === s)?.[2] ?? 0);
  check(pct('P') > 90 && pct('P') < 96, 'P share off');
  check(pct('EX') > 1.5 && pct('EX') < 3.5, 'EX share off');
  check(pct('A') > 1 && pct('A') < 2.5, 'A share off');
  check(pct('L') > 0.3 && pct('L') < 1.2, 'L share off');

  // ── Per-child rates ───────────────────────────────────────────────────
  const rates = sqlRows(`with x as (
      select ay_code, section_student_id, count(*) filter (where status = 'A') a,
        count(*) filter (where status = 'L') l, count(*) filter (where status in ('P','L','EX','A')) n
        from ${LATEST} z group by 1, 2),
    c as (select ay_code, s.student_id, sum(a) a, sum(l) l, sum(n) n
        from x join section_students s on s.id = x.section_student_id group by 1, 2 having sum(n) > 0)
    select ay_code,
      round(100 * percentile_disc(0.5) within group (order by a::numeric / n), 1),
      round(100 * percentile_disc(0.75) within group (order by a::numeric / n), 1),
      round(100 * percentile_disc(0.9) within group (order by a::numeric / n), 1),
      round(100 * percentile_disc(0.95) within group (order by a::numeric / n), 1),
      round(100 * percentile_disc(0.99) within group (order by a::numeric / n), 1),
      round(100 * max(a::numeric / n), 1),
      count(*) filter (where a = 0), count(*),
      round(100 * percentile_disc(0.9) within group (order by l::numeric / n), 1),
      round(100 * percentile_disc(0.99) within group (order by l::numeric / n), 1),
      round(100 * max(l::numeric / n), 1)
    from c group by 1 order by 1`);
  for (const [
    ay,
    p50,
    p75,
    p90,
    p95,
    p99,
    max,
    zero,
    kids,
    l90,
    l99,
    lmax,
  ] of rates) {
    console.log(
      `  ${ay} absence (A) rate per child: p50 ${p50} p75 ${p75} p90 ${p90} p95 ${p95} p99 ${p99} max ${max}; never absent ${zero}/${kids} (${((100 * Number(zero)) / Number(kids)).toFixed(0)}%); late p90 ${l90} p99 ${l99} max ${lmax}`
    );
    check(Number(p50) >= 0.4 && Number(p50) <= 2.5, `${ay} absence p50 ${p50}`);
    check(Number(p90) >= 3 && Number(p90) <= 8, `${ay} absence p90 ${p90}`);
    check(Number(max) >= 12, `${ay} no chronic absentee (max ${max})`);
    const z = Number(zero) / Number(kids);
    check(z > 0.2 && z < 0.45, `${ay} never-absent ${z}`);
  }
  console.log(
    '    [prod AY2025 p50 1.1 p75 2.3 p90 4.1 p95 5.7 p99 13.3 max 17.9, never 138/404; AY2026 p50 1.4 p75 3.2 p90 5.4 p95 7.5 p99 14.2 max 26.8, never 118/407; late p90 1.7/2.3 p99 8.0/11.1 max 21.3/16.3]'
  );
  const atRisk = num(`with x as (select ay_code, section_student_id,
      count(*) filter (where status in ('P','L','EX')) p, count(*) filter (where status <> 'NC' and status is not null) n
      from ${LATEST} z where ay_code = 'AY2026' group by 1, 2) select count(*) from x where n > 0 and 100.0 * p / n < 90`);
  console.log(`  AY2026 children under the 90% attendance line: ${atRisk}`);

  // ── Reasons and notes ─────────────────────────────────────────────────
  const reasons =
    sqlRows(`select coalesce(ex_reason, '(none)'), count(*), count(ex_note),
      coalesce(percentile_disc(0.5) within group (order by char_length(ex_note))::text, ''),
      coalesce(percentile_disc(0.9) within group (order by char_length(ex_note))::text, ''),
      coalesce(max(char_length(ex_note))::text, '')
      from attendance_daily where ex_reason is not null or ex_note is not null group by 1 order by 2 desc`);
  console.log(
    `  EX reasons / notes (reason|rows|noted|note p50|p90|max): ${reasons.map((r) => r.join('|')).join('; ')}  [prod mc|168|41|29|51|92; vacation|50|18|48|126|127; compassionate|1|0; (none)|25|25|28|110|142]`
  );
  const mc = Number(reasons.find((r) => r[0] === 'mc')?.[1] ?? 0);
  const vac = Number(reasons.find((r) => r[0] === 'vacation')?.[1] ?? 0);
  check(
    mc > 0 && vac > 0 && mc > 1.5 * vac,
    `EX reason mix mc ${mc} / vacation ${vac}`
  );
  const badNotes = num(
    `select count(*) from attendance_daily where (ex_note is not null and (status is null or status = 'NC')) or (ex_reason is not null and status <> 'EX')`
  );
  const earlyReasons = num(
    `select count(*) from ${AD} where (d.ex_reason is not null or d.ex_note is not null) and (a.ay_code = 'AY2025' or t.term_number < 3)`
  );
  check(badNotes === 0, `${badNotes} reasons/notes on the wrong status`);
  check(earlyReasons === 0, `${earlyReasons} reasons/notes before AY2026 T3`);

  // ── Days ──────────────────────────────────────────────────────────────
  const blocked = num(
    `select count(*) from attendance_daily d where d.status is not null and public.attendance_write_blocked(d.term_id, d.date, d.section_student_id)`
  );
  console.log(
    `  marks on a non-teaching day (attendance_write_blocked): ${blocked} (want 0)`
  );
  check(blocked === 0, `${blocked} marks on non-teaching days`);

  const roster = await loadRoster();
  const run = runDateSg();
  const window = new Map(
    roster.enrolments.map((e) => [e.id, new Set(e.days.map((d) => d.date))])
  );
  // Marks an approved declaration wrote are recorded by its approver — an
  // officer in charge (school_admin), who never takes a register.
  const DECL = `d.recorded_by in (select id from auth.users where raw_app_meta_data->'role' ? 'school_admin')`;
  const keys = sqlRows(
    `select d.section_student_id, d.date::text, count(*) filter (where not coalesce(${DECL}, false)),
            count(*) filter (where ${DECL})
       from attendance_daily d group by 1, 2`
  );
  let outside = 0;
  let multi = 0;
  let declKeys = 0;
  const marked = new Set<string>();
  for (const [ss, date, n, decl] of keys) {
    marked.add(`${ss}|${date}`);
    if (!window.get(ss)?.has(date)) outside++;
    if (Number(n) > 1) multi++;
    if (Number(decl) > 0) declKeys++;
  }
  // Due = on the list that day and the day's register due by the run date.
  let expected = 0;
  const owed: string[] = [];
  for (const e of roster.enrolments)
    for (const d of e.days) {
      if (!roster.isDue(e.ay, d.date)) continue;
      expected++;
      // A day before the run date with no mark is what the app calls owed;
      // the run date's own register may still be open.
      if (!marked.has(`${e.id}|${d.date}`) && d.date < run)
        owed.push(`${e.sectionName} ${d.date}`);
    }
  console.log(
    `  (child, day) keys: ${keys.length} of ${expected} on-the-list school days due by ${roster.registerEnd} (run date ${run}, capped at Term 4's end); owed before the run date and unmarked: ${owed.length}; keys with more than one route/import row (corrections/clears): ${multi}; keys an approved declaration re-marked: ${declKeys}; keys outside the child's time on the list: ${outside}`
  );
  check(outside === 0, `${outside} marks outside a child's class-list window`);
  check(
    multi > 0 && multi <= 60,
    `${multi} keys with several rows, want the route's ~40`
  );
  check(
    owed.length === 0,
    `${owed.length} school days before the run date unmarked (e.g. ${owed.slice(0, 3).join(', ')})`
  );
  check(
    expected - keys.length <= 400,
    `${expected - keys.length} due school days unmarked (only the run date's own registers may be)`
  );
  const transfer =
    sqlRows(`select s.name, min(d.date), max(d.date) from attendance_daily d
      join section_students ss on ss.id = d.section_student_id join sections s on s.id = ss.section_id
     where ss.student_id in (select student_id from section_students ss2 join sections s2 on s2.id = ss2.section_id
       join academic_years a2 on a2.id = s2.academic_year_id where a2.ay_code = 'AY2026'
       group by student_id having count(*) > 1)
     group by 1 order by 2`);
  console.log(
    `  the transfer's register: ${transfer.map(([s, a, b]) => `${s} ${a}..${b}`).join(' → ')}`
  );

  // ── Rollups ───────────────────────────────────────────────────────────
  const recs = num('select count(*) from attendance_records');
  const pairs = num(
    'select count(*) from (select distinct term_id, section_student_id from attendance_daily) p'
  );
  const mismatch = num(`with l as (
      select distinct on (d.term_id, d.section_student_id, d.date) d.term_id, d.section_student_id, d.status
        from attendance_daily d join section_students ss on ss.id = d.section_student_id
       where ss.enrollment_date is null or d.date >= ss.enrollment_date
       order by d.term_id, d.section_student_id, d.date, d.recorded_at desc),
    c as (select term_id, section_student_id,
        count(*) filter (where status <> 'NC') sd, count(*) filter (where status in ('P','L','EX')) p,
        count(*) filter (where status = 'L') l, count(*) filter (where status = 'EX') ex,
        count(*) filter (where status = 'A') a from l group by 1, 2)
    select count(*) from attendance_records r full join c using (term_id, section_student_id)
     where c.term_id is null or r.term_id is null or r.school_days <> c.sd or r.days_present <> c.p
        or r.days_late <> c.l or r.days_excused <> c.ex or r.days_absent <> c.a
        or r.attendance_pct is distinct from case when c.sd > 0 then round(100.0 * c.p / c.sd, 2) end`);
  console.log(
    `  attendance_records: ${recs} (one per term × child with marks: ${pairs}); disagreeing with the ledger: ${mismatch}`
  );
  check(
    recs === pairs,
    `attendance_records ${recs} vs ${pairs} (term, child) pairs`
  );
  check(mismatch === 0, `${mismatch} rollups disagree with the ledger`);
  const recStats = sqlRows(`select a.ay_code || ' ' || t.term_number, count(*),
      percentile_disc(0.5) within group (order by school_days), max(school_days),
      percentile_disc(0.05) within group (order by attendance_pct), percentile_disc(0.5) within group (order by attendance_pct)
      from attendance_records r join terms t on t.id = r.term_id join academic_years a on a.id = t.academic_year_id
     group by 1 order by 1`);
  console.log(
    `  attendance_records per AY × term (n|school_days p50|max|pct p05|p50): ${recStats.map(([k, ...v]) => `${k} ${v.join('|')}`).join('; ')}`
  );
  console.log(
    '    [prod AY2025 391|46|47|91.30|100; 391|42|42|92.86; 377|46|46|91.30; 375|39|41|92.31 · AY2026 393|44|44|90.91; 394|40|40|95.00; 406|45|47|91.11; 398|17|20|88.24]'
  );

  // ── Audit ─────────────────────────────────────────────────────────────
  const audit =
    sqlRows(`select action, count(*), count(*) filter (where context ? 'prior_status'),
      count(distinct actor_role) from audit_log where action like 'attendance.daily.%' group by 1 order by 1`);
  const auditN = audit.reduce((s, r) => s + Number(r[1]), 0);
  const routeRows = num(
    'select count(*) from attendance_daily where recorded_by is not null'
  );
  const all = num('select count(*) from audit_log');
  console.log(
    `  audit: ${audit.map(([a, n, p]) => `${a} ${n} (${p} with a prior mark)`).join(', ')}; ${auditN} of ${all} audit rows (${((100 * auditN) / all).toFixed(0)}%); route-entered marks ${routeRows}  [prod update 5,229 / correct 1,390 = 71% of 9,302]`
  );
  check(
    auditN === routeRows,
    `${auditN} attendance audit rows vs ${routeRows} route-entered marks`
  );
  const trigger = num(
    `select count(*) from audit_log where action like 'attendance.daily.%' and actor_email in ('(unknown)', 'system')`
  );
  check(trigger === 0, `${trigger} attendance audit rows from the trigger`);

  // ── Leave quotas, through the app's readers ───────────────────────────
  const over = await getCompassionateOverQuota('AY2026');
  const overNames = over.filter((r) => r.isOverQuota);
  const t = roster.terms;
  const ayId = sql(`select id from academic_years where ay_code = 'AY2026'`);
  let vacationOver = 0;
  for (const term of t.filter((x) => x.ay === 'AY2026' && x.number >= 3)) {
    const sections =
      sqlRows(`select distinct ss.section_id from attendance_daily d
        join section_students ss on ss.id = d.section_student_id
       where d.ex_reason = 'vacation' and d.term_id = '${term.id}'`).map(
        (r) => r[0]
      );
    for (const s of sections) {
      const usage = await getVacationLeaveUsageForSection(s, ayId, term.id);
      for (const u of usage.values())
        if (u.usedThisTerm > u.allowance) vacationOver++;
    }
  }
  const allowances = sql(
    `select string_agg(distinct coalesce(urgent_compassionate_allowance::text, 'null') || '/' || coalesce(vacation_leave_allowance_per_term::text, 'null'), ', ') from students`
  );
  console.log(
    `  leave quotas (students' UCA/VL allowance: ${allowances}): compassionate over quota (getCompassionateOverQuota) ${overNames.length} of ${over.length} with compassionate leave; vacation over quota in AY2026 T3–T4 (getVacationLeaveUsageForSection) ${vacationOver}`
  );
  check(overNames.length >= 1, 'no child over the compassionate quota');
  // Exactly the attendance phase's two two-trip children: an approved travel
  // declaration (run before this check) must not push anyone else over.
  check(
    vacationOver === 2,
    `${vacationOver} children over the vacation quota, want exactly 2`
  );

  // ── Fingerprint ───────────────────────────────────────────────────────
  // Left out, by key (lib/constants.ts): the (class, day) registers that
  // exist only because the real run date reached them
  // (`runDependentRegisterKeys` — every Term 4 day after TODAY, and the days
  // taken late after TODAY), and AY2026 Term 4's rollups, which count however
  // many days are due. The rollups are still checked above, against the
  // ledger, in full.
  const runDependent = await runDependentRegisterKeys();
  const ledgerRows =
    sql(`select s.id || '|' || d.date, a.ay_code, t.term_number, l.code, s.name, st.student_number, d.date,
             coalesce(d.status, ''), coalesce(d.ex_reason, ''), md5(coalesce(d.ex_note, '')),
             coalesce(d.recorded_by::text, '')
           from ${AD} join section_students ss on ss.id = d.section_student_id
           join sections s on s.id = ss.section_id join levels l on l.id = s.level_id
           join students st on st.id = ss.student_id
          order by 2, 3, 4, 5, 6, 7, d.recorded_at, 8`)
      .split('\n')
      .filter(
        (line) => !runDependent.has(line.slice(0, line.indexOf('|', 37)))
      );
  const fp = createHash('sha256')
    .update(ledgerRows.join('\n'))
    .update(
      sql(`select a.ay_code, t.term_number, l.code, s.name, st.student_number, r.school_days,
             r.days_present, r.days_late, r.days_excused, r.days_absent, coalesce(r.attendance_pct::text, '')
           from attendance_records r join terms t on t.id = r.term_id join academic_years a on a.id = t.academic_year_id
           join section_students ss on ss.id = r.section_student_id join sections s on s.id = ss.section_id
           join levels l on l.id = s.level_id join students st on st.id = ss.student_id
          where not (a.ay_code = 'AY2026' and t.term_number = 4)
          order by 1, 2, 3, 4, 5`)
    )
    .digest('hex')
    .slice(0, 16);
  console.log(
    `  attendance fingerprint (excl. the ${runDependent.size} run-date-dependent class-days and AY2026 T4 rollups): ${fp}`
  );

  if (failures.length)
    throw new Error(
      `attendance check failed:\n    - ${failures.join('\n    - ')}`
    );
  console.log('  attendance check: PASS');
}
