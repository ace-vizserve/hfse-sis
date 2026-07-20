// scripts/backfill/gen-ay2026-t2-filipino-secondary-backfill.ts
// Generates ay2026-t2-filipino-secondary-backfill-{preview,apply}.sql — a
// standalone correction closing a real gap: Phase 6b's T2 Secondary import
// excluded Filipino entirely, citing tabs it claimed were "structurally
// incomplete." Direct inspection during this design proved that claim
// false — the real file has complete WW/PT/QA data for all 4 Secondary
// sections. This script backfills exactly that one subject, for T2 only,
// using the EXISTING, UNMODIFIED T2 Secondary parser/composer — no new
// library code, since T2's Filipino Secondary tabs have no DO-NOT-USE
// duplicates (confirmed during design). Deliberately writes to its OWN
// preview/apply filenames, never touching Phase 6b's original
// ay2026-t2-secondary-grading-{preview,apply}.sql artifacts. Emits SQL for
// review — does NOT write to the database itself. See:
// docs/superpowers/specs/2026-07-20-ay2026-t1-secondary-grading-import-design.md
//
// Run: npx tsx --env-file=.env.local scripts/backfill/gen-ay2026-t2-filipino-secondary-backfill.ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createServiceClient } from '../../lib/supabase/service';
import { parseGradingWorkbookSecondaryT2 } from '../../lib/sis/backfill/grading/grading-workbook-secondary-t2';
import { buildSecondaryGradingImport } from '../../lib/sis/backfill/grading/build-secondary-grading-import';
import type {
  RosterLookupEntry,
  SubjectConfigWeight,
} from '../../lib/sis/backfill/grading/build-secondary-grading-import';

const AY_CODE = 'AY2026';
const TERM_NUMBER = 2;
const DIR = 'AY2026/T2/Term 2 Grades/GRADES';
const FILE = 'Filipino Grading AY2026 T2.xlsx';
const SUBJECT_CODE = 'FIL';

// Design doc §2.2 point 4: FIL's T2 header (0.3/0.5/0.2) already matches
// the live subject_configs row exactly — the same row already verified
// this session for Primary FIL/GP weights. Empty on purpose, same
// convention as every sibling orchestrator.
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

  // 1. Parse the one real workbook via the existing T2 Secondary parser —
  //    no new library code; T2's Filipino Secondary tabs have no
  //    DO-NOT-USE duplicates.
  const result = parseGradingWorkbookSecondaryT2(join(DIR, FILE), SUBJECT_CODE);
  console.log(
    `${FILE}: ${result.sheets.length} Secondary sheet(s), skipped ${result.skippedPrimary.length} Primary + ${result.skippedUnrecognized.length} unrecognized, ${result.identityCorrections.length} identity correction(s), ${result.truncationNotes.length} truncation note(s)`
  );

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

  // 3. Compose via the existing, unmodified T2 Secondary composer.
  const composed = buildSecondaryGradingImport({
    sheets: result.sheets,
    rosterLookup,
    subjectConfigWeights: SUBJECT_CONFIG_WEIGHTS,
    ayCode: AY_CODE,
    termNumber: TERM_NUMBER,
  });

  const finalPreview =
    composed.preview +
    '\n' +
    buildNotesSection(
      'Identity corrections — tab name overrode a conflicting row 2 label',
      result.identityCorrections
    ) +
    '\n' +
    buildNotesSection(
      "Tab name truncated — row 2's fuller label used instead",
      result.truncationNotes
    );

  writeFileSync(
    'scripts/backfill/ay2026-t2-filipino-secondary-backfill-preview.sql',
    finalPreview
  );
  writeFileSync(
    'scripts/backfill/ay2026-t2-filipino-secondary-backfill-apply.sql',
    composed.apply
  );

  console.log('Stats:', JSON.stringify(composed.stats, null, 2));
  console.log(
    `Identity corrections: ${result.identityCorrections.length}, truncation notes: ${result.truncationNotes.length}`
  );
  console.log(
    'Wrote scripts/backfill/ay2026-t2-filipino-secondary-backfill-preview.sql'
  );
  console.log(
    'Wrote scripts/backfill/ay2026-t2-filipino-secondary-backfill-apply.sql'
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
