// scripts/backfill/gen-ay2026-t2-ca-integrity2-correction.ts
// One-time correction for a real bug found via a systematic post-apply
// audit: T2's Contemporary Arts "Integrity 2" grading sheet was silently
// never imported by Phase 6b (T2's original Secondary import), and
// remained missing even after this session's T1 Secondary import + T2
// Filipino Secondary backfill confirmed every other Secondary
// section/subject combination resolves correctly.
//
// Root cause: two independent minor defects collided. (1) The tab name
// "Contemporary Arts - Sec 2 Integ" hits Excel's 31-character sheet-name
// limit, truncating before "Integrity 2" could fully appear. (2) Row 2's
// own label, "Secondary 2 INTEGRITY - CONTEMPORARY ARTS", is itself
// missing the trailing "2" — the same copy-pasted-template typo found on
// the T2 Filipino file's Integrity-2 row-2 label too, harmless there and
// on every other T2 subject because those subjects' full tab names fit
// within 31 characters (so tab-name-wins protects them regardless of the
// row-2 typo). Here, the existing truncation-preference logic in
// resolveIdentity (t2-masthead.ts) assumes row 2 must be the "fuller,
// correct" label whenever the tab name is a genuine prefix of it — but
// row 2 was independently wrong too, so the sheet resolved to section
// name "Integrity" instead of "Integrity 2". No section by that name
// exists, so the original apply.sql's `sections.name = s.section_name`
// join silently matched zero rows and the sheet was dropped without
// error.
//
// A systematic re-audit of every already-applied grading source (T1
// Primary, T1 Secondary, T2 Primary, T2 Secondary Regular + Global — 223
// sheets total) found this to be the ONLY section-name mismatch anywhere
// — an isolated, one-sheet gap, not a broader pattern. Fixed here by
// reusing the existing, unmodified T2 Secondary parser/composer, with the
// one bad sheet's sectionName corrected in place before composing — the
// shared resolveIdentity logic itself is NOT changed, to avoid regression
// risk to the 222 already-correctly-resolved sheets.
//
// Emits SQL for review — does NOT write to the database itself.
//
// Run: npx tsx --env-file=.env.local scripts/backfill/gen-ay2026-t2-ca-integrity2-correction.ts
import { writeFileSync } from 'node:fs';

import { createServiceClient } from '../../lib/supabase/service';
import { parseGradingWorkbookSecondaryT2 } from '../../lib/sis/backfill/grading/grading-workbook-secondary-t2';
import { buildSecondaryGradingImport } from '../../lib/sis/backfill/grading/build-secondary-grading-import';
import type {
  RosterLookupEntry,
  SubjectConfigWeight,
} from '../../lib/sis/backfill/grading/build-secondary-grading-import';

const AY_CODE = 'AY2026';
const TERM_NUMBER = 2;
const FILE =
  'AY2026/T2/Term 2 Grades/GRADES/Contemporary Arts Grading AY2026 T2.xlsx';
const SUBJECT_CODE = 'CA';

// CA's T2 header (0.3/0.5/0.2) already matches the live subject_configs
// row exactly — no correction needed here.
const SUBJECT_CONFIG_WEIGHTS: SubjectConfigWeight[] = [];

async function main() {
  const svc = createServiceClient();

  const result = parseGradingWorkbookSecondaryT2(FILE, SUBJECT_CODE);
  console.log(
    `${FILE}: ${result.sheets.length} Secondary sheet(s) parsed: ${result.sheets.map((s) => s.sectionName).join(', ')}`
  );

  const buggy = result.sheets.find((s) => s.sectionName === 'Integrity');
  if (!buggy) {
    throw new Error(
      'Expected sheet resolved to "Integrity" not found — has the source file changed? Re-investigate before proceeding.'
    );
  }
  const corrected = { ...buggy, sectionName: 'Integrity 2' };
  console.log(
    `Correcting sectionName "Integrity" -> "Integrity 2" for ${corrected.students.length} students`
  );

  const { data: ay, error: ayErr } = await svc
    .from('academic_years')
    .select('id')
    .eq('ay_code', AY_CODE)
    .single();
  if (ayErr) throw ayErr;

  const { data: rows, error: rowsErr } = await svc
    .from('section_students')
    .select(
      'id, index_number, sections!inner(name, academic_year_id, levels!inner(code, level_type))'
    )
    .eq('sections.academic_year_id', (ay as any).id)
    .eq('sections.levels.level_type', 'secondary');
  if (rowsErr) throw rowsErr;

  const rosterLookup: RosterLookupEntry[] = (rows ?? []).map((r: any) => ({
    levelCode: r.sections.levels.code,
    sectionName: r.sections.name,
    indexNumber: r.index_number,
    sectionStudentId: r.id,
  }));

  const composed = buildSecondaryGradingImport({
    sheets: [corrected],
    rosterLookup,
    subjectConfigWeights: SUBJECT_CONFIG_WEIGHTS,
    ayCode: AY_CODE,
    termNumber: TERM_NUMBER,
  });

  writeFileSync(
    'scripts/backfill/ay2026-t2-ca-integrity2-correction-preview.sql',
    composed.preview
  );
  writeFileSync(
    'scripts/backfill/ay2026-t2-ca-integrity2-correction-apply.sql',
    composed.apply
  );

  console.log('Stats:', JSON.stringify(composed.stats, null, 2));
  console.log(
    'Wrote scripts/backfill/ay2026-t2-ca-integrity2-correction-preview.sql'
  );
  console.log(
    'Wrote scripts/backfill/ay2026-t2-ca-integrity2-correction-apply.sql'
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
