// scripts/backfill/gen-ay2026-t1-writeups.ts
// Generates ay2026-t1-writeups-{preview,apply}.sql from HFSE's real T1
// Student Evaluation file. Emits SQL for review — does NOT write to the
// database itself. See:
// docs/superpowers/specs/2026-07-20-ay2026-t1-evaluation-writeups-import-design.md
//
// Run: npx tsx --env-file=.env.local scripts/backfill/gen-ay2026-t1-writeups.ts
import { writeFileSync } from 'node:fs';

import { createServiceClient } from '../../lib/supabase/service';
import { parseT1Writeups } from '../../lib/sis/backfill/evaluation/parse-t1-writeups';
import { buildT1WriteupsImport } from '../../lib/sis/backfill/evaluation/build-t1-writeups-import';
import type { T1RosterCandidate } from '../../lib/sis/backfill/evaluation/build-t1-writeups-import';

const AY_CODE = 'AY2026';
const TERM_NUMBER = 1;
const SOURCE_FILE =
  'AY2026/T1/Term 1 Grades/AY2026 T1 Student Evaluation_Subject Checklists.xlsx';

// Validated during design (docs/superpowers/specs/2026-07-20-ay2026-t1-evaluation-writeups-import-design.md
// §3/§4) against this exact file + the live roster at design time. A real
// generation run should land close to these; material drift means
// something changed since design and needs investigating before trusting
// the output.
const EXPECTED_PARSED_ROWS = 392;
const EXPECTED_RESOLVED = 367;
const EXPECTED_NEEDS_REVIEW = 25;
const EXPECTED_DISTINCT_SECTIONS = 20;

async function main() {
  const svc = createServiceClient();

  const parsed = parseT1Writeups(SOURCE_FILE);
  console.log(
    `Parsed: ${parsed.rows.length} write-up row(s) across ${parsed.sheetStats.length} recognized sheet(s), ${parsed.unrecognizedSheets.length} unrecognized sheet(s)`
  );
  console.log(
    `  (design-time expectation: ${EXPECTED_PARSED_ROWS} parsed rows — ${parsed.rows.length === EXPECTED_PARSED_ROWS ? 'MATCHES' : 'DRIFTED, investigate before trusting the output'})`
  );
  for (const s of parsed.sheetStats) {
    const dup = s.duplicateIndexNotes.length
      ? ` DUPLICATE_INDEX(${s.duplicateIndexNotes.join('; ')})`
      : '';
    console.log(
      `  ${s.levelCode} ${s.sectionName}: namedBlank=${s.namedBlankCount} unusedTemplate=${s.unusedTemplateCount}${dup}`
    );
  }
  if (parsed.unrecognizedSheets.length > 0) {
    console.log('  Unrecognized sheets:', parsed.unrecognizedSheets.join(', '));
  }

  // Defensive check (design doc §9): every recognized sheet must resolve
  // to a DISTINCT identity — no two sheets should ever claim the same
  // section.
  const seen = new Set<string>();
  for (const s of parsed.sheetStats) {
    const key = `${s.levelCode}::${s.sectionName}`;
    if (seen.has(key)) {
      throw new Error(
        `Duplicate section identity "${key}" across sheets — investigate before proceeding.`
      );
    }
    seen.add(key);
  }
  console.log(`Distinct section identities: ${seen.size}`);
  if (seen.size !== EXPECTED_DISTINCT_SECTIONS) {
    throw new Error(
      `Expected exactly ${EXPECTED_DISTINCT_SECTIONS} distinct section identities, got ${seen.size} — investigate before proceeding.`
    );
  }

  const { data: ay, error: ayErr } = await svc
    .from('academic_years')
    .select('id')
    .eq('ay_code', AY_CODE)
    .single();
  if (ayErr) throw ayErr;

  const { data: term, error: termErr } = await svc
    .from('terms')
    .select('id, end_date')
    .eq('academic_year_id', (ay as any).id)
    .eq('term_number', TERM_NUMBER)
    .single();
  if (termErr) throw termErr;

  // Roster resolution is name-first (design §4) against the WHOLE active
  // AY2026 roster — all level types, not scoped to any one section — so
  // this query is intentionally not filtered by level_type.
  const { data: rows, error: rowsErr } = await svc
    .from('section_students')
    .select(
      'student_id, section_id, index_number, students!inner(student_number, first_name, last_name, middle_name), sections!inner(name, academic_year_id, levels!inner(code))'
    )
    .eq('sections.academic_year_id', (ay as any).id)
    .neq('enrollment_status', 'withdrawn');
  if (rowsErr) throw rowsErr;

  const rosterCandidates: T1RosterCandidate[] = (rows ?? []).map((r: any) => ({
    enroleeNumber: '',
    studentNumber: r.students.student_number,
    lastName: r.students.last_name,
    firstName: r.students.first_name,
    middleName: r.students.middle_name,
    levelCode: r.sections.levels.code,
    sectionName: r.sections.name,
    indexNumber: r.index_number,
    studentId: r.student_id,
    sectionId: r.section_id,
  }));
  console.log(`Active AY2026 roster candidates: ${rosterCandidates.length}`);

  const result = buildT1WriteupsImport({
    rows: parsed.rows,
    sheetStats: parsed.sheetStats,
    rosterCandidates,
    termId: (term as any).id,
    submittedAt: (term as any).end_date,
  });

  writeFileSync(
    'scripts/backfill/ay2026-t1-writeups-preview.sql',
    result.preview
  );
  writeFileSync('scripts/backfill/ay2026-t1-writeups-apply.sql', result.apply);

  console.log('Stats:', JSON.stringify(result.stats, null, 2));
  const matchesExpectation =
    result.stats.writeupsWritten === EXPECTED_RESOLVED &&
    result.stats.needsReview === EXPECTED_NEEDS_REVIEW;
  console.log(
    `  (design-time expectation: resolved=${EXPECTED_RESOLVED} needsReview=${EXPECTED_NEEDS_REVIEW} — ${matchesExpectation ? 'MATCHES' : 'DRIFTED, investigate before trusting the output'})`
  );
  console.log('Wrote scripts/backfill/ay2026-t1-writeups-preview.sql');
  console.log('Wrote scripts/backfill/ay2026-t1-writeups-apply.sql');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
