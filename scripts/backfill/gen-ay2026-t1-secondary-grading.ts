// scripts/backfill/gen-ay2026-t1-secondary-grading.ts
// Generates ay2026-t1-secondary-grading-{preview,apply}.sql from HFSE's
// real T1 "Grades" folder subject workbooks (Secondary Regular-track tabs
// only — Discipline 2, Integrity 2, S3 Consistency, S4 Excellence).
// Global-track Discipline 1/Integrity 1 are already imported by Phase 3,
// untouched here. Emits SQL for review — does NOT write to the database
// itself. See:
// docs/superpowers/specs/2026-07-20-ay2026-t1-secondary-grading-import-design.md
//
// Run: npx tsx --env-file=.env.local scripts/backfill/gen-ay2026-t1-secondary-grading.ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createServiceClient } from '../../lib/supabase/service';
import { parseGradingWorkbookT1Secondary } from '../../lib/sis/backfill/grading/grading-workbook-t1-secondary';
import { buildT1SecondaryGradingImport } from '../../lib/sis/backfill/grading/build-t1-secondary-grading-import';
import type {
  RosterLookupEntry,
  SubjectConfigWeight,
} from '../../lib/sis/backfill/grading/build-t1-secondary-grading-import';

const AY_CODE = 'AY2026';
const TERM_NUMBER = 1;
const DIR = 'AY2026/T1/Term 1 Grades/Grades';

// Explicit file list — never a directory glob. History has no S3/S4 tabs
// (genuinely absent from the real file); SS & Geo has no S1/S2 tabs (same).
// Mandarin and STAR MAPEH have zero Secondary tabs at all — not listed.
const SUBJECT_FILES: { file: string; subjectCode: string }[] = [
  { file: 'English Grading AY2026 T1.xlsx', subjectCode: 'ENG' },
  { file: 'Math Grading AY2026 T1.xlsx', subjectCode: 'MATH' },
  { file: 'Science Grading AY2026 T1.xlsx', subjectCode: 'SCI' },
  { file: 'Filipino Grading AY2026 T1.xlsx', subjectCode: 'FIL' },
  { file: 'History Grading AY2026 T1.xlsx', subjectCode: 'HIST' },
  { file: 'Literature Grading AY2026 T1.xlsx', subjectCode: 'LIT' },
  { file: 'SS & Geo Grading AY2026 T1.xlsx', subjectCode: 'SS' },
  { file: 'Contemporary Arts Grading AY2026 T1.xlsx', subjectCode: 'CA' },
  { file: 'PE (Sec) Grading AY2026 T1.xlsx', subjectCode: 'PEH' },
];

// Design doc §1.2 point 3: every one of the 9 subjects' T1 Secondary
// header weights already matches the live, corrected subject_configs —
// verified directly this session. Empty on purpose — NOT derived at
// generation time, and NOT simply omitted from the composer call (the
// composer must correctly handle this empty-but-real input, per Task 2).
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

  // 1. Parse every real workbook; collect Secondary sheets + skip counts.
  let sheets: ReturnType<typeof parseGradingWorkbookT1Secondary>['sheets'] = [];
  let skippedPrimaryTotal = 0;
  let skippedDoNotUseTotal = 0;
  let skippedUnrecognizedTotal = 0;
  let allIdentityCorrections: string[] = [];
  let allTruncationNotes: string[] = [];
  for (const { file, subjectCode } of SUBJECT_FILES) {
    const result = parseGradingWorkbookT1Secondary(
      join(DIR, file),
      subjectCode
    );
    sheets = sheets.concat(result.sheets);
    skippedPrimaryTotal += result.skippedPrimary.length;
    skippedDoNotUseTotal += result.skippedDoNotUse.length;
    skippedUnrecognizedTotal += result.skippedUnrecognized.length;
    allIdentityCorrections = allIdentityCorrections.concat(
      result.identityCorrections
    );
    allTruncationNotes = allTruncationNotes.concat(result.truncationNotes);
    console.log(
      `${file}: ${result.sheets.length} Secondary sheet(s), skipped ${result.skippedPrimary.length} Primary + ${result.skippedDoNotUse.length} DO-NOT-USE + ${result.skippedUnrecognized.length} unrecognized, ${result.identityCorrections.length} identity correction(s), ${result.truncationNotes.length} truncation note(s)`
    );
  }

  // 2. Build the roster lookup for AY2026's Secondary sections.
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

  // 3. Compose.
  const result = buildT1SecondaryGradingImport({
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
    'scripts/backfill/ay2026-t1-secondary-grading-preview.sql',
    finalPreview
  );
  writeFileSync(
    'scripts/backfill/ay2026-t1-secondary-grading-apply.sql',
    result.apply
  );

  console.log('Stats:', JSON.stringify(result.stats, null, 2));
  console.log(
    `Skipped across all files: ${skippedPrimaryTotal} Primary tabs (owned by sub-phase 1), ${skippedDoNotUseTotal} DO-NOT-USE tabs, ${skippedUnrecognizedTotal} unrecognized tabs`
  );
  console.log(
    `Identity corrections: ${allIdentityCorrections.length}, truncation notes: ${allTruncationNotes.length}`
  );
  console.log('Wrote scripts/backfill/ay2026-t1-secondary-grading-preview.sql');
  console.log('Wrote scripts/backfill/ay2026-t1-secondary-grading-apply.sql');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
