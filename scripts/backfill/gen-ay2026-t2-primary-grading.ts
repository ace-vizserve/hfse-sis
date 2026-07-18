// scripts/backfill/gen-ay2026-t2-primary-grading.ts
// Generates ay2026-t2-primary-grading-{preview,apply}.sql from HFSE's real
// T2 "GRADES" folder subject workbooks (Primary tabs only — Secondary
// Regular-track tabs riding along in the same files are recognized and
// skipped, deferred to Phase 6b). Emits SQL for review — does NOT write
// to the database itself. See:
// docs/superpowers/specs/2026-07-18-ay2026-t2-primary-grading-import-design.md
//
// Run: npx tsx --env-file=.env.local scripts/backfill/gen-ay2026-t2-primary-grading.ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createServiceClient } from '../../lib/supabase/service';
import { parseGradingWorkbookT2 } from '../../lib/sis/backfill/grading/grading-workbook-t2';
import { buildPrimaryGradingImport } from '../../lib/sis/backfill/grading/build-primary-grading-import';
import type {
  RosterLookupEntry,
  SubjectConfigWeight,
} from '../../lib/sis/backfill/grading/build-primary-grading-import';

const AY_CODE = 'AY2026';
const TERM_NUMBER = 2;
const DIR = 'AY2026/T2/Term 2 Grades/GRADES';

// Explicit file list — never a directory glob. "Copy of English..." and
// "Copy of Science..." are corrupted duplicates (literal #REF! in the
// NAME column, same signature as T1's corrupted file) and must never be
// read.
const SUBJECT_FILES: { file: string; subjectCode: string }[] = [
  { file: 'Math Grading AY2026 T2.xlsx', subjectCode: 'MATH' },
  { file: 'English Grading AY2026 T2.xlsx', subjectCode: 'ENG' },
  { file: 'Science Grading AY2026 T2.xlsx', subjectCode: 'SCI' },
  { file: 'STAR (PrI) Grading AY2026 T2.xlsx', subjectCode: 'MAPEH' },
  { file: 'Filipino Grading AY2026 T2.xlsx', subjectCode: 'FIL' },
  { file: 'Mandarin Grading AY2026 T2.xlsx', subjectCode: 'MANDARIN' },
];

// Hand-verified during design (docs/superpowers/specs/2026-07-18-ay2026-t2-primary-grading-import-design.md
// §2 Locked Decision #6) by comparing each subject's real T2 header weight
// against the live subject_configs value — NOT derived at generation time.
// MATH/ENG/SCI are deliberately absent: already correct + already
// weights_confirmed=true from Phase 3 / its correction pass.
const SUBJECT_CONFIG_WEIGHTS: SubjectConfigWeight[] = [
  { subjectCode: 'FIL', wwWeight: 0.4, ptWeight: 0.4, qaWeight: 0.2 }, // real correction: was 0.3/0.5/0.2
  { subjectCode: 'MAPEH', wwWeight: 0.2, ptWeight: 0.6, qaWeight: 0.2 }, // confirm-only, already correct
  { subjectCode: 'MANDARIN', wwWeight: 0.3, ptWeight: 0.5, qaWeight: 0.2 }, // confirm-only, already correct
];

async function main() {
  const svc = createServiceClient();

  // 1. Parse every real workbook; collect Primary sheets + skip counts.
  let sheets: ReturnType<typeof parseGradingWorkbookT2>['sheets'] = [];
  let skippedSecondaryTotal = 0;
  let skippedUnrecognizedTotal = 0;
  for (const { file, subjectCode } of SUBJECT_FILES) {
    const result = parseGradingWorkbookT2(join(DIR, file), subjectCode);
    sheets = sheets.concat(result.sheets);
    skippedSecondaryTotal += result.skippedSecondary.length;
    skippedUnrecognizedTotal += result.skippedUnrecognized.length;
    console.log(
      `${file}: ${result.sheets.length} Primary sheet(s), skipped ${result.skippedSecondary.length} Secondary + ${result.skippedUnrecognized.length} unrecognized`
    );
  }

  // 2. Build the roster lookup for AY2026's Primary sections.
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
    .eq('sections.levels.level_type', 'primary');
  if (rowsErr) throw rowsErr;

  const rosterLookup: RosterLookupEntry[] = (rows ?? []).map((r: any) => ({
    levelCode: r.sections.levels.code,
    sectionName: r.sections.name,
    indexNumber: r.index_number,
    sectionStudentId: r.id,
  }));

  // 3. Compose.
  const result = buildPrimaryGradingImport({
    sheets,
    rosterLookup,
    subjectConfigWeights: SUBJECT_CONFIG_WEIGHTS,
    ayCode: AY_CODE,
    termNumber: TERM_NUMBER,
  });

  writeFileSync(
    'scripts/backfill/ay2026-t2-primary-grading-preview.sql',
    result.preview
  );
  writeFileSync(
    'scripts/backfill/ay2026-t2-primary-grading-apply.sql',
    result.apply
  );

  console.log('Stats:', JSON.stringify(result.stats, null, 2));
  console.log(
    `Skipped across all files: ${skippedSecondaryTotal} Secondary tabs (deferred to Phase 6b), ${skippedUnrecognizedTotal} unrecognized tabs`
  );
  console.log('Wrote scripts/backfill/ay2026-t2-primary-grading-preview.sql');
  console.log('Wrote scripts/backfill/ay2026-t2-primary-grading-apply.sql');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
