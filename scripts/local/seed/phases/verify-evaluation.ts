// The Phase 5 check (evaluation write-ups), called from `verify`. Prints
// coverage and lengths per term against production (prod-profile.md §5) and
// proves: imported rows carry no author and no audit row; in-app rows were
// written by the class's form adviser through RLS, with the trigger's audit
// rows; the published class has every comment the publish gate needs.
// Ends with a content fingerprint.

import { createHash } from 'node:crypto';

import { sql, sqlRows } from '../lib/local';
import { loadRoster } from '../attendance/roster';
import { PUBLICATION } from './publication';

const num = (q: string) => Number(sql(q).trim());
const failures: string[] = [];
function check(ok: boolean, what: string) {
  if (!ok) failures.push(what);
}

/** prod: ay term → [rows, len p10, p50, p90, max] */
const PROD: Record<string, number[]> = {
  'AY2025 1': [398, 199, 331, 525, 846],
  'AY2025 2': [374, 175, 300, 501, 687],
  'AY2025 3': [384, 215, 335, 612, 954],
  'AY2026 1': [369, 142, 246, 419, 891],
  'AY2026 2': [371, 183, 259, 433, 616],
  'AY2026 3': [2, 11, 11, 17, 17],
};

export async function verifyEvaluation(): Promise<void> {
  const roster = await loadRoster();
  const rows =
    sqlRows(`select a.ay_code || ' ' || t.term_number, t.id, count(*), count(*) filter (where w.submitted),
      count(*) filter (where coalesce(w.writeup, '') = ''),
      percentile_disc(0.1) within group (order by char_length(w.writeup)),
      percentile_disc(0.5) within group (order by char_length(w.writeup)),
      percentile_disc(0.9) within group (order by char_length(w.writeup)),
      max(char_length(w.writeup)), count(distinct w.student_id), count(w.created_by),
      count(*) filter (where w.writeup like '<p>%')
      from evaluation_writeups w join terms t on t.id = w.term_id join academic_years a on a.id = t.academic_year_id
     group by 1, 2 order by 1`);
  console.log(
    '  evaluation_writeups per AY × term: rows (of children on the list at term end) | submitted | blank | len p10 p50 p90 max | with author | <p>-wrapped  [prod rows | p10 p50 p90 max]'
  );
  for (const [
    k,
    termId,
    n,
    sub,
    blank,
    p10,
    p50,
    p90,
    max,
    kids,
    authored,
    html,
  ] of rows) {
    const term = roster.terms.find((t) => t.id === termId)!;
    const onList = new Set(
      roster.enrolments
        .filter((e) => {
          const last = e.days.filter((d) => d.termId === termId).at(-1)?.date;
          const termLast = roster
            .schoolDays(term.ay, e.level)
            .filter((d) => d.termId === termId)
            .at(-1)?.date;
          return last !== undefined && last === termLast;
        })
        .map((e) => e.studentNumber)
    ).size;
    const cover = Number(n) / onList;
    console.log(
      `    ${k}: ${n} of ${onList} (${(100 * cover).toFixed(1)}%) | ${sub} | ${blank} | ${p10} ${p50} ${p90} ${max} | ${authored} | ${html}  [${PROD[k]?.join(' ') ?? '-'}]`
    );
    check(
      n === sub && n === kids && blank === '0',
      `${k}: unsubmitted, blank or duplicate rows`
    );
    if (!k.endsWith(' 3') || k.startsWith('AY2025')) {
      check(cover > 0.92 && cover < 0.98, `${k} coverage ${cover}`);
      check(Number(p50) >= 220 && Number(p50) <= 360, `${k} p50 ${p50}`);
      check(Number(p90) >= 380 && Number(p90) <= 650, `${k} p90 ${p90}`);
      check(Number(max) <= 960, `${k} max ${max}`);
    }
  }
  check(rows.length === 6, `write-ups in ${rows.length} terms, want 6`);

  // Imported rows: no author; in-app rows: the class's form adviser.
  const authorBad =
    num(`select count(*) from evaluation_writeups w where w.created_by is not null
      and not exists (select 1 from teacher_assignments ta where ta.section_id = w.section_id
        and ta.role = 'form_adviser' and ta.teacher_user_id = w.created_by)`);
  check(
    authorBad === 0,
    `${authorBad} write-ups by someone other than the form adviser`
  );
  const audit =
    sqlRows(`select action, count(*), count(distinct actor_role), min(actor_role)
      from audit_log where action like 'evaluation.writeup.%' group by 1 order by 1`);
  console.log(
    `  evaluation audit: ${audit.map(([a, n, , role]) => `${a} ${n} (${role})`).join(', ')}  [prod save 18, resubmit 11, submit 8]`
  );
  const system = num(
    `select count(*) from audit_log where action like 'evaluation.writeup.%' and (actor_id is null or actor_email = 'system')`
  );
  check(
    system === 0,
    `${system} evaluation audit rows with no actor (the import must not log)`
  );
  check(audit.length >= 2, 'in-app write-ups left no audit rows');

  // The published class: every child has T1..T3.
  const gaps = num(`select count(*) from section_students ss
      join sections s on s.id = ss.section_id join levels l on l.id = s.level_id
      join academic_years a on a.id = s.academic_year_id
      join terms t on t.academic_year_id = a.id and t.term_number between 1 and ${PUBLICATION.term}
     where a.ay_code = '${PUBLICATION.ay}' and l.code = '${PUBLICATION.level}' and s.name = '${PUBLICATION.section}'
       and ss.enrollment_status in ('active', 'late_enrollee')
       and (ss.enrollment_date is null or ss.enrollment_date <= t.end_date)
       and not exists (select 1 from evaluation_writeups w where w.term_id = t.id and w.student_id = ss.student_id and w.submitted)`);
  console.log(
    `  ${PUBLICATION.level} ${PUBLICATION.section} (published class) comments missing for T1..T${PUBLICATION.term}: ${gaps}`
  );
  check(gaps === 0, `${gaps} comments missing in the published class`);

  const fp = createHash('sha256')
    .update(
      sql(`select a.ay_code, t.term_number, l.code, s.name, st.student_number, w.writeup, w.submitted,
             coalesce(w.created_by::text, '')
           from evaluation_writeups w join terms t on t.id = w.term_id join academic_years a on a.id = t.academic_year_id
           join sections s on s.id = w.section_id join levels l on l.id = s.level_id
           join students st on st.id = w.student_id order by 1, 2, 3, 4, 5`)
    )
    .digest('hex')
    .slice(0, 16);
  console.log(`  evaluation fingerprint: ${fp}`);
  if (failures.length)
    throw new Error(
      `evaluation check failed:\n    - ${failures.join('\n    - ')}`
    );
  console.log('  evaluation check: PASS');
}
