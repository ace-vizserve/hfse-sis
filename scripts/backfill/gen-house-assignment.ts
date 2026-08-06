// scripts/backfill/gen-house-assignment.ts
//
// Generates house-assignment-{preview,apply}.sql from Mr Hanafi's
// "Student House Color Assignment" workbook. Emits SQL for review — does NOT
// write to the database itself, exactly like the attendance and grading
// importers it is modelled on.
//
// Run: npx tsx --env-file=.env.local scripts/backfill/gen-house-assignment.ts
//
// ─────────────────────────────────────────────────────────────────────────
// WHAT MAKES THIS ONE DIFFERENT FROM THE GRADING IMPORTS
//
// A house is not scoped to an academic year — `students.house_id` sits on the
// cross-AY row on purpose (migration 110), because a house follows a child from
// P1 to S4. So the SQL keys on `student_number` and touches no term, sheet or
// section.
//
// But the NAMES have to be matched within the current year's roster.
// `public.students` holds 759 rows, every student the school has ever enrolled;
// the sheet holds 410 current ones. Matching "SANTOS, Julian" against all 759
// would eventually hit a namesake from a closed year and assign the wrong
// child, silently and permanently. So candidates come from the current AY's
// admissions applications — the same pool the per-student PATCH route resolves
// through — and `studentNumber` carries the match across to the grading schema
// (Hard Rule #4).
//
// ⚠ The SQL keys houses on `code` (H1–H4), never on name. Names changed once
// already (migration 111 renamed 110's placeholders); codes are 110's
// idempotency key and cannot move.
import { writeFileSync } from 'node:fs';

import {
  HOUSE_CODE_BY_COLOUR,
  parseHouseWorkbook,
} from '../../lib/sis/backfill/house/workbook';
import {
  matchName,
  parseSheetFullName,
  type CandidateName,
  type MatchTier,
} from '../../lib/sis/backfill/enrollment/name-match';
import { createServiceClient } from '../../lib/supabase/service';

const WORKBOOK_PATH = 'house/Student House Color Assignment.xlsx';
const AY_CODE = 'AY2026';
const OUT_PREVIEW = 'scripts/backfill/house-assignment-preview.sql';
const OUT_APPLY = 'scripts/backfill/house-assignment-apply.sql';

// A withdrawn or cancelled application is not a candidate — its name would
// otherwise compete with a live student's for the same sheet row.
const NON_CANDIDATE_STATUSES = new Set(['Cancelled', 'Withdrawn']);

// 'fuzzy' is a Levenshtein guess. It is reported but NEVER written: a wrong
// house is invisible once set, so an uncertain match is worth less than a gap
// somebody can fill in by hand.
const ACCEPTED_TIERS = new Set<MatchTier>(['exact', 'strong']);

function sqlStr(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

async function main() {
  const svc = createServiceClient();
  const prefix = `ay${AY_CODE.replace(/^AY/i, '').toLowerCase()}`;

  const sheetRows = parseHouseWorkbook(WORKBOOK_PATH);
  console.log(
    `Workbook: ${sheetRows.length} students on the in-scope class tabs`
  );

  const { data: apps, error: appsErr } = await svc
    .from(`${prefix}_enrolment_applications`)
    .select('enroleeNumber, studentNumber, lastName, firstName, middleName');
  if (appsErr) throw appsErr;

  const { data: statuses, error: statusErr } = await svc
    .from(`${prefix}_enrolment_status`)
    .select('enroleeNumber, applicationStatus');
  if (statusErr) throw statusErr;

  const statusByEnrolee = new Map(
    (statuses ?? []).map((s: Record<string, unknown>) => [
      s.enroleeNumber as string,
      s.applicationStatus as string,
    ])
  );

  const candidates: CandidateName[] = (apps ?? [])
    .filter(
      (a: Record<string, unknown>) =>
        !NON_CANDIDATE_STATUSES.has(
          statusByEnrolee.get(a.enroleeNumber as string) ?? ''
        )
    )
    // Drop applications with no student number. Unlike the enrollment import,
    // which exists partly to FIND such rows, this import keys its UPDATE on
    // `student_number` — so a candidate without one can never be written, and
    // keeping it in the pool does active harm: production holds duplicate
    // admissions rows for the same child where only one carries the number
    // (EUGENIO Mary Dorothy, PANGILINAN Emme Claire). Both copies match the
    // sheet equally well, matchName correctly refuses to guess, and a student
    // who is perfectly identifiable goes unassigned.
    .filter((a: Record<string, unknown>) => !!a.studentNumber)
    .map((a: Record<string, unknown>) => ({
      enroleeNumber: a.enroleeNumber as string,
      studentNumber: (a.studentNumber as string | null) ?? null,
      lastName: (a.lastName as string | null) ?? '',
      firstName: (a.firstName as string | null) ?? '',
      middleName: (a.middleName as string | null) ?? null,
    }));
  console.log(`Roster:   ${candidates.length} live ${AY_CODE} applications\n`);

  type Resolved = {
    tab: string;
    rawName: string;
    colour: string;
    houseCode: string;
    tier: MatchTier;
    studentNumber: string | null;
    matchedTo: string | null;
  };

  const resolved: Resolved[] = sheetRows.map((r) => {
    const m = matchName(parseSheetFullName(r.rawName), candidates);
    return {
      tab: r.tab,
      rawName: r.rawName,
      colour: r.colour,
      houseCode: HOUSE_CODE_BY_COLOUR[r.colour],
      tier: m.tier,
      studentNumber: m.candidate?.studentNumber ?? null,
      matchedTo: m.candidate
        ? `${m.candidate.lastName}, ${m.candidate.firstName} ${m.candidate.middleName ?? ''}`.trim()
        : null,
    };
  });

  const byTier = (t: MatchTier) => resolved.filter((r) => r.tier === t);
  console.log('MATCH RESULTS');
  for (const t of ['exact', 'strong', 'fuzzy', 'none'] as MatchTier[]) {
    console.log(`  ${t.padEnd(7)} ${String(byTier(t).length).padStart(4)}`);
  }

  // Accepted, and carrying a student number — without one there is nothing to
  // key the UPDATE on, however confident the name match was.
  const writable = resolved.filter(
    (r) => ACCEPTED_TIERS.has(r.tier) && r.studentNumber
  );
  const noStudentNumber = resolved.filter(
    (r) => ACCEPTED_TIERS.has(r.tier) && !r.studentNumber
  );
  const skipped = resolved.filter((r) => !ACCEPTED_TIERS.has(r.tier));

  console.log(`\n  writable ${writable.length}   skipped ${skipped.length}`);
  if (noStudentNumber.length > 0) {
    console.log(
      `\n  MATCHED BUT NO STUDENT NUMBER (${noStudentNumber.length}) — cannot be written:`
    );
    for (const r of noStudentNumber) console.log(`    [${r.tab}] ${r.rawName}`);
  }
  if (skipped.length > 0) {
    console.log(`\n  NOT WRITTEN (${skipped.length}):`);
    for (const r of skipped) {
      console.log(
        `    [${r.tab}] ${r.rawName.padEnd(36)} ${r.tier}` +
          (r.matchedTo ? `  ~ ${r.matchedTo}` : '')
      );
    }
  }

  // ⚠ Student numbers with stray whitespace. Production holds "H250326" AND
  // "H250326 " as two separate `students` rows for the same child, each
  // actively enrolled in a different section — a pre-existing defect, not
  // something this import created or should fix. It matters here because the
  // UPDATE joins on an exact string: the padded value reaches exactly one of
  // the two rows and leaves the other houseless, and which one it hits is not
  // obvious from reading the SQL. Surfaced rather than silently trimmed —
  // trimming would move the write to the other row, which is a different guess,
  // not a safer one.
  const padded = writable.filter(
    (r) => r.studentNumber !== r.studentNumber!.trim()
  );
  if (padded.length > 0) {
    console.log(
      `\n  ⚠ PADDED STUDENT NUMBERS (${padded.length}) — check the preview's effect column for these:`
    );
    for (const r of padded) {
      console.log(`    "${r.studentNumber}"  [${r.tab}] ${r.rawName}`);
    }
  }

  // A student number appearing twice would mean the sheet puts one child in two
  // houses, or two sheet rows matched the same record. Either is a defect, not
  // something to resolve by letting the last UPDATE win.
  const seen = new Map<string, Resolved>();
  const collisions: Array<[Resolved, Resolved]> = [];
  for (const r of writable) {
    const prior = seen.get(r.studentNumber!);
    if (prior) collisions.push([prior, r]);
    else seen.set(r.studentNumber!, r);
  }
  if (collisions.length > 0) {
    console.log(
      `\n  ⚠ COLLISIONS (${collisions.length}) — same student twice:`
    );
    for (const [a, b] of collisions) {
      console.log(
        `    ${a.studentNumber}  [${a.tab}] ${a.rawName} -> ${a.colour}   vs   [${b.tab}] ${b.rawName} -> ${b.colour}`
      );
    }
    throw new Error('collisions must be resolved before SQL is generated');
  }

  // ⚠ The row separator goes BEFORE the trailing comment, never after. A first
  // cut joined on ',\n' with the comment already appended, which put every
  // comma inside its own `--` comment and produced SQL that parsed exactly one
  // row before failing. Comments are last on the line, always.
  const values = writable
    .map((r, i) => {
      const sep = i === writable.length - 1 ? '' : ',';
      // Names are the sheet's, so keep them to one line — a stray newline would
      // uncomment whatever followed it.
      const label = `${r.rawName} · ${r.colour}`.replace(/\s+/g, ' ');
      return `    (${sqlStr(r.studentNumber!)}, ${sqlStr(r.houseCode)})${sep}  -- ${label}`;
    })
    .join('\n');

  const header = `-- Generated by scripts/backfill/gen-house-assignment.ts
-- Source: ${WORKBOOK_PATH} (per-class tabs only; the superseded master tab and
-- the HFSE Staff / YS / VizSchool tabs are skipped by name).
-- ${writable.length} students. Names matched against live ${AY_CODE} applications;
-- ${skipped.length} sheet rows were not confident enough to write and are listed
-- in the generator's output.
--
-- Houses are keyed on CODE, never on name — names changed in migration 111.
-- Safe to re-run: the UPDATE is a no-op where the house already matches.`;

  const cte = `with assignment (student_number, house_code) as (
  values
${values}
)`;

  writeFileSync(
    OUT_PREVIEW,
    `${header}
--
-- PREVIEW — reads only. Shows what apply would change, and flags any student
-- number the sheet names that the grading roster does not hold.

${cte}
select
  a.student_number,
  s.last_name || ', ' || s.first_name        as student,
  coalesce(cur.name, '(none)')               as house_now,
  new.name                                   as house_after,
  case
    when s.id is null                    then 'NO SUCH STUDENT'
    when s.house_id is null              then 'set'
    when s.house_id = new.id             then 'unchanged'
    else                                      'OVERWRITE'
  end                                        as effect
from assignment a
join public.houses new       on new.code = a.house_code
left join public.students s  on s.student_number = a.student_number
left join public.houses cur  on cur.id = s.house_id
order by effect, a.student_number;
`,
    'utf8'
  );

  writeFileSync(
    OUT_APPLY,
    `${header}
--
-- APPLY. Run the preview first and read the 'effect' column: anything reading
-- OVERWRITE is a student whose house is already set to something else, and
-- NO SUCH STUDENT is a name the grading roster does not hold (run a student
-- sync from Markbook first).
--
-- ⚠ This writes no audit rows. The per-student PATCH route logs every house
-- change by name; a bulk UPDATE bypasses that, exactly as the attendance and
-- grading backfills do. That is the accepted trade for a one-off import — the
-- workbook is the record of where these came from.

begin;

${cte}
update public.students s
   set house_id = new.id
  from assignment a
  join public.houses new on new.code = a.house_code
 where s.student_number = a.student_number
   and s.house_id is distinct from new.id;

-- Expect ${writable.length} or fewer; fewer means some were already correct.
commit;
`,
    'utf8'
  );

  console.log(`\nWrote ${OUT_PREVIEW}`);
  console.log(`Wrote ${OUT_APPLY}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
