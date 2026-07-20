// scripts/backfill/gen-ay2026-t1-primary-grading.ts
// Generates ay2026-t1-primary-grading-{preview,apply}.sql from HFSE's real
// T1 "Grades" folder subject workbooks (Primary tabs only — Secondary
// Regular-track tabs riding along in the same files are recognized and
// skipped, deferred to a later sub-phase). Emits SQL for review — does NOT
// write to the database itself. See:
// docs/superpowers/specs/2026-07-20-ay2026-t1-primary-grading-import-design.md
//
// Run: npx tsx --env-file=.env.local scripts/backfill/gen-ay2026-t1-primary-grading.ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createServiceClient } from '../../lib/supabase/service';
import { parseGradingWorkbookT1Primary } from '../../lib/sis/backfill/grading/grading-workbook-t1-primary';
import { buildT1PrimaryGradingImport } from '../../lib/sis/backfill/grading/build-t1-primary-grading-import';
import type {
  RosterLookupEntry,
  SubjectConfigWeight,
} from '../../lib/sis/backfill/grading/build-t1-primary-grading-import';

const AY_CODE = 'AY2026';
const TERM_NUMBER = 1;
const DIR = 'AY2026/T1/Term 1 Grades/Grades';

// Explicit file list — never a directory glob. This folder also has
// Secondary-only subject files (History, Literature, SS & Geo,
// Contemporary Arts, PE (Sec)) that don't apply to Primary at all — not
// listed here, out of scope for this Primary-only phase.
const SUBJECT_FILES: { file: string; subjectCode: string }[] = [
  { file: 'English Grading AY2026 T1.xlsx', subjectCode: 'ENG' },
  { file: 'Math Grading AY2026 T1.xlsx', subjectCode: 'MATH' },
  { file: 'Science Grading AY2026 T1.xlsx', subjectCode: 'SCI' },
  { file: 'Filipino Grading AY2026 T1.xlsx', subjectCode: 'FIL' },
  { file: 'Mandarin Grading AY2026 T1.xlsx', subjectCode: 'MANDARIN' },
  {
    file: 'STAR MAPEH (PrI) Grading AY2026 T1.xlsx',
    subjectCode: 'MAPEH',
  },
];

// Locked Decision #3 (design doc): every one of the 6 subjects' T1 header
// weights already matches the live, corrected subject_configs — verified
// directly this session. Empty on purpose — NOT derived at generation
// time, and NOT simply omitted from the composer call (the composer must
// correctly handle this empty-but-real input, per Task 2).
const SUBJECT_CONFIG_WEIGHTS: SubjectConfigWeight[] = [];

function buildNotesSection(heading: string, notes: string[]): string {
  const lines: string[] = [];
  lines.push('--');
  lines.push(`-- ${heading} (${notes.length}):`);
  if (notes.length === 0) lines.push('--   (none)');
  for (const n of notes) lines.push(`--   ${n}`);
  return lines.join('\n') + '\n';
}

async function main() {
  const svc = createServiceClient();

  // 1. Parse every real workbook; collect Primary sheets + skip counts.
  let sheets: ReturnType<typeof parseGradingWorkbookT1Primary>['sheets'] = [];
  let skippedSecondaryTotal = 0;
  let skippedExcludedSectionTotal = 0;
  let skippedUnrecognizedTotal = 0;
  let allIdentityCorrections: string[] = [];
  let allTruncationNotes: string[] = [];
  for (const { file, subjectCode } of SUBJECT_FILES) {
    const result = parseGradingWorkbookT1Primary(join(DIR, file), subjectCode);
    sheets = sheets.concat(result.sheets);
    skippedSecondaryTotal += result.skippedSecondary.length;
    skippedExcludedSectionTotal += result.skippedExcludedSection.length;
    skippedUnrecognizedTotal += result.skippedUnrecognized.length;
    allIdentityCorrections = allIdentityCorrections.concat(
      result.identityCorrections
    );
    allTruncationNotes = allTruncationNotes.concat(result.truncationNotes);
    console.log(
      `${file}: ${result.sheets.length} Primary sheet(s), skipped ${result.skippedSecondary.length} Secondary + ${result.skippedExcludedSection.length} excluded-section + ${result.skippedUnrecognized.length} unrecognized, ${result.identityCorrections.length} identity correction(s), ${result.truncationNotes.length} truncation note(s)`
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
  const result = buildT1PrimaryGradingImport({
    sheets,
    rosterLookup,
    subjectConfigWeights: SUBJECT_CONFIG_WEIGHTS,
    ayCode: AY_CODE,
    termNumber: TERM_NUMBER,
  });

  const finalPreview =
    result.preview +
    '\n' +
    buildNotesSection(
      'Identity corrections — tab name overrode a conflicting row 2 label',
      allIdentityCorrections
    ) +
    '\n' +
    buildNotesSection(
      "Tab name truncated — row 2's fuller label used instead",
      allTruncationNotes
    );

  writeFileSync(
    'scripts/backfill/ay2026-t1-primary-grading-preview.sql',
    finalPreview
  );
  writeFileSync(
    'scripts/backfill/ay2026-t1-primary-grading-apply.sql',
    result.apply
  );

  console.log('Stats:', JSON.stringify(result.stats, null, 2));
  console.log(
    `Skipped across all files: ${skippedSecondaryTotal} Secondary tabs (deferred to a later sub-phase), ${skippedExcludedSectionTotal} excluded-section tabs (Respect/Gentleness/Compassion), ${skippedUnrecognizedTotal} unrecognized tabs`
  );
  console.log(
    `Identity corrections: ${allIdentityCorrections.length}, truncation notes: ${allTruncationNotes.length}`
  );
  console.log('Wrote scripts/backfill/ay2026-t1-primary-grading-preview.sql');
  console.log('Wrote scripts/backfill/ay2026-t1-primary-grading-apply.sql');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
