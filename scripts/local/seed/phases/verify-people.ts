// The Phase 1 check (people + admissions), called from `verify`.
//
// Prints per-AY counts against the plan's targets, the returning-student
// overlaps, the Records extras and the admissions-vs-class mismatches; asserts
// that the class lists came out of the app's own sync; runs the same loaders
// /records/students and /admissions read; and prints a content fingerprint of
// the people tables (two rebuilds must print the same one).

import { createHash } from 'node:crypto';

import { listStudents } from '@/lib/sis/queries';
import { countUnsyncedEnrolledStudents } from '@/lib/sis/unsynced-students';

import { sql, sqlRows } from '../lib/local';
import { STAMP_COLUMNS } from './people';

const AYS = ['AY2025', 'AY2026', 'AY2027'] as const;
const t = (ay: string, kind: string) =>
  `public.ay${ay.slice(2)}_enrolment_${kind}`;
const one = (q: string) => sql(q).trim();
const num = (q: string) => Number(one(q));

function table(
  title: string,
  head: string[],
  rows: Array<Array<string | number>>
) {
  console.log(`  ${title}`);
  const widths = head.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => String(r[i]).length))
  );
  const line = (cells: Array<string | number>) =>
    '    ' +
    cells
      .map((c, i) =>
        String(c)
          .padStart(i === 0 ? 0 : widths[i])
          .padEnd(i === 0 ? widths[i] : 0)
      )
      .join('  ');
  console.log(line(head));
  for (const r of rows) console.log(line(r));
}

const failures: string[] = [];
function check(ok: boolean, what: string) {
  if (!ok) failures.push(what);
}

/** "x (target y)" and a ±10% check. */
function vs(actual: number, target: number, what: string): string {
  const ok = Math.abs(actual - target) <= Math.max(1, Math.round(target * 0.1));
  check(ok, `${what}: ${actual} not within ±10% of ${target}`);
  return `${actual}/${target}${ok ? '' : ' ✗'}`;
}

const ssOf = (ay: string, where = 'true') =>
  num(`select count(*) from section_students ss join sections s on s.id = ss.section_id
         join academic_years a on a.id = s.academic_year_id where a.ay_code = '${ay}' and ${where}`);

export async function verifyPeople(): Promise<void> {
  failures.length = 0;
  const students = num('select count(*) from students');
  if (students === 0) {
    console.log('  people: no students yet (people phase not run) — skipped');
    return;
  }

  // ── Admissions + class lists per AY ───────────────────────────────────
  const targets = {
    AY2025: { apps: 300, ss: 240, wd: 18, late: 8 },
    AY2026: { apps: 290, ss: 250, wd: 12, late: 12 },
    AY2027: { apps: 30, ss: 4, wd: 0, late: 0 },
  } as const;
  const rows: Array<Array<string | number>> = [];
  for (const ay of AYS) {
    const tg = targets[ay];
    const apps = num(`select count(*) from ${t(ay, 'applications')}`);
    const status = num(`select count(*) from ${t(ay, 'status')}`);
    const docs = num(`select count(*) from ${t(ay, 'documents')}`);
    const noStatus = num(
      `select count(*) from ${t(ay, 'applications')} a where not exists (select 1 from ${t(ay, 'status')} s where s."enroleeNumber" = a."enroleeNumber")`
    );
    const enrolled = num(
      `select count(*) from ${t(ay, 'status')} where "applicationStatus" = 'Enrolled'`
    );
    const submitted = num(
      `select count(*) from ${t(ay, 'status')} where "applicationStatus" = 'Submitted'`
    );
    rows.push([
      ay,
      vs(apps, tg.apps, `${ay} applications`),
      status,
      docs,
      `${noStatus} (${Math.round((noStatus / Math.max(apps, 1)) * 100)}%)`,
      enrolled,
      submitted,
      vs(ssOf(ay), tg.ss, `${ay} section_students`),
      tg.wd
        ? vs(
            ssOf(ay, `ss.enrollment_status = 'withdrawn'`),
            tg.wd,
            `${ay} withdrawn`
          )
        : ssOf(ay, `ss.enrollment_status = 'withdrawn'`),
      tg.late
        ? vs(
            ssOf(ay, `ss.enrollment_status = 'late_enrollee'`),
            tg.late,
            `${ay} late`
          )
        : ssOf(ay, `ss.enrollment_status = 'late_enrollee'`),
      ssOf(ay, 'ss.enrollment_date is not null'),
    ]);
  }
  table(
    'admissions + class lists (actual/target):',
    [
      'AY',
      'apps',
      'status',
      'docs',
      'apps w/o status',
      'Enrolled',
      'Submitted',
      'class rows',
      'withdrawn',
      'late',
      'dated',
    ],
    rows
  );

  // ── Students ──────────────────────────────────────────────────────────
  const pattern = sqlRows(
    `select coalesce(p, '(no class row)'), count(*) from (
       select st.id, string_agg(distinct a.ay_code, '+' order by a.ay_code) p
         from students st
         left join section_students ss on ss.student_id = st.id
         left join sections s on s.id = ss.section_id
         left join academic_years a on a.id = s.academic_year_id
        group by st.id) x group by 1 order by 1`
  );
  const pat = new Map(pattern.map(([k, n]) => [k, Number(n)]));
  table(
    'students by years on a class list (actual/target):',
    ['pattern', 'n'],
    [
      [
        'AY2025+AY2026',
        vs(pat.get('AY2025+AY2026') ?? 0, 175, 'AY2025+AY2026 students'),
      ],
      ['AY2025 only', vs(pat.get('AY2025') ?? 0, 60, 'AY2025-only students')],
      // 70 new AY2026 children, 10 of them later taken off the list (index holes).
      ['AY2026 only', vs(pat.get('AY2026') ?? 0, 60, 'AY2026-only students')],
      [
        '(no class row)',
        // 100 legacy students + the 10 taken off the AY2026 list.
        vs(pat.get('(no class row)') ?? 0, 110, 'students with no class row'),
      ],
      ...pattern
        .filter(
          ([k]) =>
            !['AY2025+AY2026', 'AY2025', 'AY2026', '(no class row)'].includes(k)
        )
        .map(([k, n]) => [k, n]),
      ['total', vs(students, 416, 'students')],
    ]
  );

  const rate = (col: string) =>
    num(
      `select round(100.0 * count(*) filter (where ${col}) / count(*)) from students`
    );
  const dupPairs = num(
    `select count(*) from (select last_name, first_name from students group by 1, 2 having count(*) > 1) d`
  );
  const shapes = sqlRows(
    `select left(student_number, 1) || '/len' || length(student_number), count(*) from students group by 1 order by 2 desc`
  )
    .map(([s, n]) => `${s} ${n}`)
    .join(', ');
  const houses = sqlRows(
    `select coalesce(h.code, '-'), count(*) from students st left join houses h on h.id = st.house_id group by 1 order by 1`
  )
    .map(([h, n]) => `${h} ${n}`)
    .join(', ');
  // Houses and school numbers, measured as production's profile does: over
  // the distinct children on the AY2026 class list, and nobody outside it.
  const on2026 = `st.id in (select ss.student_id from section_students ss join sections s on s.id = ss.section_id
       join academic_years a on a.id = s.academic_year_id where a.ay_code = 'AY2026')`;
  const [n26, housed26, housedOut, ssn26, ssnOut, ysN, ysY] = sqlRows(
    `select count(*) filter (where ${on2026}),
            count(*) filter (where ${on2026} and house_id is not null),
            count(*) filter (where not ${on2026} and house_id is not null),
            count(*) filter (where ${on2026} and school_student_number is not null),
            count(*) filter (where not ${on2026} and school_student_number is not null),
            count(*) filter (where st.id in (select ss.student_id from section_students ss join sections s on s.id = ss.section_id
               join levels l on l.id = s.level_id join academic_years a on a.id = s.academic_year_id
              where a.ay_code = 'AY2026' and l.code = 'YS')),
            count(*) filter (where st.id in (select ss.student_id from section_students ss join sections s on s.id = ss.section_id
               join levels l on l.id = s.level_id join academic_years a on a.id = s.academic_year_id
              where a.ay_code = 'AY2026' and l.code = 'YS') and school_student_number like 'Y%')
       from students st`
  )[0].map(Number);
  const housePct = Math.round((100 * housed26) / n26);
  const ssnPct = Math.round((100 * ssn26) / n26);
  const houseAudit = num(
    `select count(*) from audit_log where action = 'sis.house.update'`
  );
  const middlePct = rate("coalesce(middle_name, '') <> ''");
  console.log(
    `  records: AY2026 children ${n26}: house ${housed26} (${housePct}%, prod 399/431 = 93%) [${houses}], housed outside AY2026 ${housedOut} (prod 0), sis.house.update audit rows ${houseAudit}; school_student_number ${ssn26} (${ssnPct}%, prod 221/431 = 51%), outside AY2026 ${ssnOut} (prod 0), Youngstarters with a Y school number ${ysY}/${ysN} (prod 15/15); middle_name ${middlePct}% (prod 555/777 = 71%); vacation_leave_allowance set ${num('select count(*) from students where vacation_leave_allowance_per_term is not null')}; duplicate (last, first) pairs ${dupPairs}; inactive ${num('select count(*) from students where not is_active')}`
  );
  console.log(`  student_number shapes: ${shapes}`);
  check(housePct >= 88 && housePct <= 97, 'AY2026 house rate');
  check(housedOut === 0, 'a house outside the AY2026 list');
  check(houseAudit === housed26, 'one sis.house.update audit row per house');
  check(ssnPct >= 45 && ssnPct <= 58, 'AY2026 school number rate');
  check(ssnOut === 0, 'a school number outside the AY2026 list');
  check(ysY === ysN, 'every Youngstarter has a Y school number');
  check(middlePct >= 66 && middlePct <= 76, 'middle_name fill');
  check(dupPairs >= 2, 'duplicate-name pairs');

  // ── Student numbers: New = enrolee E→H; Current reuses ────────────────
  const eh: string[] = [];
  for (const ay of AYS) {
    const [nNew, nRule, nCur, nCurEh] = sqlRows(
      `select count(*) filter (where category = 'New'),
              count(*) filter (where category = 'New' and trim("studentNumber") = 'H' || substr("enroleeNumber", 2)),
              count(*) filter (where category = 'Current'),
              count(*) filter (where category = 'Current' and trim("studentNumber") = 'H' || substr("enroleeNumber", 2))
         from ${t(ay, 'applications')} where "studentNumber" is not null`
    )[0].map(Number);
    eh.push(
      `${ay} New ${nRule}/${nNew} (${Math.round((100 * nRule) / Math.max(nNew, 1))}%)`
    );
    // AY2027's one re-issued application keeps the number its first
    // enrolee number gave it (people.ts ay2027Story).
    check(
      nNew - nRule === (ay === 'AY2027' ? 1 : 0),
      `${ay}: ${nNew - nRule} New applications not numbered E→H`
    );
    check(nCurEh === 0, `${ay}: a Current application renumbered E→H`);
  }
  const middleApp = AYS.map(
    (ay) =>
      `${ay} ${num(`select round(100.0 * count(*) filter (where coalesce("middleName",'') = '') / count(*)) from ${t(ay, 'applications')}`)}%`
  ).join(', ');
  console.log(
    `  student numbers: New applications whose studentNumber = enrolee with E→H: ${eh.join('; ')}; blank middleName on applications ${middleApp} (prod 1–7%)`
  );

  // ── Returning children: same number across years ──────────────────────
  const trimmed = (ay: string) =>
    `select distinct trim("studentNumber") n from ${t(ay, 'applications')} where "studentNumber" is not null`;
  const ov = (a: string, b: string) =>
    num(`select count(*) from (${trimmed(a)}) x where n in (${trimmed(b)})`);
  const ssBoth = num(
    `select count(*) from (select ss.student_id from section_students ss join sections s on s.id = ss.section_id
       join academic_years a on a.id = s.academic_year_id where a.ay_code in ('AY2025','AY2026')
       group by 1 having count(distinct a.ay_code) = 2) x`
  );
  const ss2627 = num(
    `select count(*) from (select ss.student_id from section_students ss join sections s on s.id = ss.section_id
       join academic_years a on a.id = s.academic_year_id where a.ay_code in ('AY2026','AY2027')
       group by 1 having count(distinct a.ay_code) = 2) x`
  );
  console.log(
    `  returning: AY2026 application numbers also on an AY2025 application ${ov('AY2026', 'AY2025')} of ${num(`select count(*) from (${trimmed('AY2026')}) x`)}; AY2027 in AY2026 ${ov('AY2027', 'AY2026')} of ${num(`select count(*) from (${trimmed('AY2027')}) x`)} (target ~26); one students row on both AY2025 and AY2026 class lists: ${ssBoth}; on AY2026 and AY2027: ${ss2627}`
  );
  check(ov('AY2027', 'AY2026') >= 23, 'AY2027 returning applicants');

  // ── The mismatches production has ─────────────────────────────────────
  const mm: Array<Array<string | number>> = [];
  for (const ay of AYS) {
    const st = t(ay, 'status');
    const ssJoin = `section_students ss join sections s on s.id = ss.section_id join academic_years a on a.id = s.academic_year_id and a.ay_code = '${ay}' left join ${st} x on x."enroleeNumber" = ss.enrolee_number`;
    mm.push([
      ay,
      num(
        `select count(*) from ${st} where coalesce("applicationStatus",'') <> 'Enrolled' and coalesce("classSection",'') <> ''`
      ),
      num(
        `select count(*) from ${st} where "applicationStatus" = 'Enrolled' and coalesce("classSection",'') = ''`
      ),
      num(
        `select count(*) from ${ssJoin} where ss.enrollment_status <> 'withdrawn' and x."applicationStatus" = 'Submitted'`
      ),
      num(
        `select count(*) from ${ssJoin} where ss.enrollment_status = 'withdrawn' and x."applicationStatus" = 'Enrolled'`
      ),
    ]);
  }
  table(
    'admissions vs class list (production has each at least once):',
    [
      'AY',
      'not Enrolled + class',
      'Enrolled, no class',
      'on list, Submitted',
      'withdrawn, Enrolled',
    ],
    mm
  );
  check(
    mm.some((r) => Number(r[1]) > 0),
    'not-Enrolled holding a classSection'
  );
  check(
    mm.some((r) => Number(r[2]) > 0),
    'Enrolled with blank classSection'
  );
  check(
    mm.some((r) => Number(r[3]) > 0),
    'class-list active while admissions Submitted'
  );
  check(
    mm.some((r) => Number(r[4]) > 0),
    'withdrawn on class list while admissions Enrolled'
  );

  // ── Stage stamps: per-AY fill of every *UpdatedDate / *Updatedby ───────
  for (const ay of AYS) {
    const prod = ay === 'AY2027' ? null : STAMP_COLUMNS[ay];
    const cols = (
      prod
        ? prod.cols
        : STAMP_COLUMNS.AY2026.cols.map(
            ([d, , b]) => [d, null, b, null] as const
          )
    ) as ReadonlyArray<readonly [string, number | null, string, number | null]>;
    const n = num(`select count(*) from ${t(ay, 'status')}`);
    const cells = cols.map(([d, dN, b, bN]) => {
      const [fd, fb] = sqlRows(
        `select count("${d}"), count("${b}") from ${t(ay, 'status')}`
      )[0].map(Number);
      const pct = (x: number, of: number) =>
        `${Math.round((1000 * x) / Math.max(of, 1)) / 10}%`;
      const short = d.replace(/Update(d)?Date$/, '');
      if (prod) {
        const ok = Math.abs(fd / n - dN! / prod.n) <= 0.02;
        check(ok, `${ay} ${d} fill ${pct(fd, n)} vs prod ${pct(dN!, prod.n)}`);
      }
      return `${short} ${pct(fd, n)}/${pct(fb, n)}${prod ? ` (prod ${pct(dN!, prod.n)}/${bN === null ? '—' : pct(bN, prod.n)})` : ''}`;
    });
    console.log(`  ${ay} stage stamps date/by: ${cells.join(', ')}`);
  }

  // ── Late enrollees, withdrawals, Youngstarters, audit ─────────────────
  const lateRows = (ay: string) =>
    sqlRows(
      `select ss.enrollment_date, ss.late_enrollee_term_number, t.start_date,
              exists (select 1 from school_calendar c where c.term_id = t.id and c.date = ss.enrollment_date and c.day_type = 'school_day'),
              ss.enrollment_status
         from section_students ss join sections s on s.id = ss.section_id
         join academic_years a on a.id = s.academic_year_id and a.ay_code = '${ay}'
         join terms t on t.academic_year_id = a.id and t.term_number = ss.late_enrollee_term_number
        where ss.late_enrollee_term_number is not null`
    );
  const late25 = lateRows('AY2025');
  const late26 = lateRows('AY2026');
  const late25AtStart = late25.filter(([d, , start]) => d === start).length;
  const late26School = late26.filter(([, , , isDay]) => isDay === 't').length;
  const late26Withdrawn = late26.filter(
    ([, , , , s]) => s === 'withdrawn'
  ).length;
  const ysClass = num(
    `select count(*) from ${t('AY2026', 'status')} x join section_students ss on ss.enrolee_number = x."enroleeNumber"
       join sections s on s.id = ss.section_id join levels l on l.id = s.level_id
      where l.code = 'YS' and x."applicationStatus" = 'Submitted'
        and (coalesce(x."classLevel",'') <> '' or coalesce(x."classSection",'') <> '')`
  );
  const ysSubmitted = num(
    `select count(*) from ${t('AY2026', 'status')} x join section_students ss on ss.enrolee_number = x."enroleeNumber"
       join sections s on s.id = ss.section_id join levels l on l.id = s.level_id
      where l.code = 'YS' and x."applicationStatus" = 'Submitted'`
  );
  const terminal = AYS.map(
    (ay) =>
      `${ay} ${num(`select count(*) from ${t(ay, 'status')} where "applicationTerminalReason" is not null`)}`
  ).join(', ');
  const audits = sqlRows(
    `select action, count(*) from audit_log
      where action in ('student.withdrawal.cascade','enrolment.metadata.update','student.section.transfer','sis.house.update')
      group by 1 order by 1`
  )
    .map(([a, c]) => `${a} ${c}`)
    .join(', ');
  const wd26 = ssOf('AY2026', `ss.enrollment_status = 'withdrawn'`) - 1; // less the transfer's source row
  console.log(
    `  AY2025 late enrollees dated their term's start: ${late25AtStart}/${late25.length}; AY2026 late enrollees on a school day: ${late26School}/${late26.length}, later withdrawn ${late26Withdrawn}; AY2026 Youngstarters on the list at Submitted ${ysSubmitted}, with a class level/section still set ${ysClass}; terminal reasons ${terminal} (prod 0, 1, 0); audit rows: ${audits} (AY2026 withdrawals ${wd26})`
  );
  check(late25AtStart === late25.length, 'AY2025 late date = term start');
  check(late26School === late26.length, 'AY2026 late dates on school days');
  check(late26Withdrawn === 1, 'one AY2026 late enrollee withdrawn');
  check(ysClass === 0, 'Youngstarters at Submitted keep a class');
  check(
    num(
      `select count(*) from audit_log where action = 'student.withdrawal.cascade'`
    ) === wd26,
    'one withdrawal cascade audit row per AY2026 withdrawal'
  );
  check(
    num(
      `select count(*) from audit_log where action = 'student.section.transfer'`
    ) === 1,
    'transfer audit row'
  );

  // ── Index numbers ─────────────────────────────────────────────────────
  for (const ay of ['AY2025', 'AY2026'] as const) {
    const [secs, gapped, gaps, profileHoles, dupIdx, twoRows, holed] = sqlRows(
      `with r as (
         select ss.section_id, ss.student_id, ss.index_number, ss.enrollment_status from section_students ss
           join sections s on s.id = ss.section_id join academic_years a on a.id = s.academic_year_id
          where a.ay_code = '${ay}'),
       per as (
         select section_id,
                max(index_number) filter (where enrollment_status <> 'withdrawn')
                  - count(*) filter (where enrollment_status <> 'withdrawn') as active_gaps,
                max(index_number) - count(distinct index_number) as all_holes,
                count(index_number) - count(distinct index_number) as dups
           from r group by 1)
       select (select count(*) from per), count(*) filter (where active_gaps > 0), sum(active_gaps),
              sum(all_holes), sum(dups),
              (select count(*) from (select student_id from r group by 1 having count(*) > 1) d),
              count(*) filter (where all_holes > 0)
         from per`
    )[0];
    console.log(
      `  ${ay} index numbers: ${secs} classes; missing numbers (max − count distinct, production's measure) ${profileHoles} across ${holed} classes (prod ${ay === 'AY2025' ? '0 / 0' : '16 across 8 of 22'}); active-numbering gaps (max active − count active: withdrawn + missing) ${gaps} across ${gapped} classes; duplicate numbers ${dupIdx}; children with two rows (transfer) ${twoRows}`
    );
    check(Number(dupIdx) === 0, `${ay} duplicate index numbers`);
    if (ay === 'AY2025') {
      check(Number(profileHoles) === 0, 'AY2025 missing index numbers');
    } else {
      check(Number(twoRows) === 1, 'AY2026 transfer (one child, two rows)');
      check(Number(gapped) >= 5, 'AY2026 classes with active-numbering gaps');
      check(
        Number(profileHoles) >= 8 && Number(holed) >= 6,
        'AY2026 missing index numbers'
      );
    }
  }

  // ── Discount codes ────────────────────────────────────────────────────
  console.log(
    `  discount codes: AY2025 ${num('select count(*) from ay2025_discount_codes')} (0), AY2026 ${num('select count(*) from ay2026_discount_codes')} (20), AY2027 ${num('select count(*) from ay2027_discount_codes')} (10); discount1 used AY2025 ${num(`select round(100.0*count("discount1")/count(*)) from ay2025_enrolment_applications`)}%, AY2026 ${num(`select round(100.0*count("discount1")/count(*)) from ay2026_enrolment_applications`)}%, AY2027 ${num(`select round(100.0*count("discount1")/count(*)) from ay2027_enrolment_applications`)}%`
  );

  // ── The class lists came out of the app's sync ────────────────────────
  // syncOneStudent stamps the admissions key on every row it writes (the
  // transfer RPC carries it over); nothing in the seeder inserts a class row.
  // So every class row must name an enrolee that has a status row that year —
  // except production's one AY2027 row whose application was re-issued
  // under a new enrolee number after the sync placed it (people.ts).
  const statusless: string[] = [];
  for (const ay of AYS) {
    const orphanRows = num(
      `select count(*) from section_students ss join sections s on s.id = ss.section_id
         join academic_years a on a.id = s.academic_year_id and a.ay_code = '${ay}'
        where ss.enrolee_number is null
           or not exists (select 1 from ${t(ay, 'status')} x where x."enroleeNumber" = ss.enrolee_number)`
    );
    statusless.push(`${ay} ${orphanRows}`);
    check(
      orphanRows === (ay === 'AY2027' ? 1 : 0),
      `${ay}: ${orphanRows} class rows not traceable to an admissions row`
    );
  }
  const enrolledNoRow = AYS.map(
    (ay) =>
      `${ay} ${num(
        `select count(*) from ${t(ay, 'status')} x where x."applicationStatus" = 'Enrolled'
           and not exists (select 1 from section_students ss where ss.enrolee_number = x."enroleeNumber")`
      )}`
  );
  console.log(
    `  class rows with no status row: ${statusless.join(', ')} (prod 0, 0, 1); Enrolled with no class row: ${enrolledNoRow.join(', ')} (prod 0, 0, 2)`
  );
  const badNumbers = num(
    `select count(*) from students where student_number <> trim(student_number)`
  );
  check(badNumbers === 0, 'a students.student_number carries whitespace');
  const placed = num('select count(distinct student_id) from section_students');
  console.log(
    `  sync provenance: ${placed} children on class lists, every class row traceable to its AY's admissions row: ${failures.some((f) => f.includes('traceable')) ? 'NO' : 'yes'}`
  );

  // ── What the pages read ───────────────────────────────────────────────
  for (const ay of AYS) {
    try {
      const list = await listStudents(ay, 'name_asc');
      const enrolled = list.filter(
        (s) => (s.applicationStatus ?? '').trim() === 'Enrolled'
      );
      const unsynced = await countUnsyncedEnrolledStudents(ay);
      console.log(
        `  loaders ${ay}: listStudents ${list.length} applications (/admissions), ${enrolled.length} Enrolled (/records/students list), unsynced queue ${unsynced}`
      );
    } catch (e) {
      console.log(
        `  loaders ${ay}: failed — ${e instanceof Error ? e.message : e}`
      );
      failures.push(`loaders ${ay}`);
    }
  }

  // ── Content fingerprint ───────────────────────────────────────────────
  const parts = [
    `select student_number, last_name, first_name, middle_name, is_active, school_student_number,
            (select code from houses h where h.id = st.house_id) from students st order by 1`,
    `select a.ay_code, s.name, st.student_number, ss.index_number, ss.enrollment_status, ss.enrollment_date,
            ss.withdrawal_date, ss.withdrawal_reason, ss.late_enrollee_term_number, ss.enrolee_number
       from section_students ss join sections s on s.id = ss.section_id join academic_years a on a.id = s.academic_year_id
       join students st on st.id = ss.student_id order by 1, 2, 4`,
    ...AYS.flatMap((ay) =>
      ['applications', 'status', 'documents'].map(
        (k) =>
          `select (to_jsonb(x) - 'fts')::text from ${t(ay, k)} x order by id`
      )
    ),
    `select (to_jsonb(x))::text from ay2026_discount_codes x order by id`,
    `select (to_jsonb(x))::text from ay2027_discount_codes x order by id`,
  ];
  const h = createHash('sha256');
  for (const q of parts) h.update(sql(q));
  console.log(`  people fingerprint: ${h.digest('hex').slice(0, 16)}`);

  if (failures.length) {
    throw new Error(`people check failed:\n    - ${failures.join('\n    - ')}`);
  }
  console.log('  people check: PASS');
}
