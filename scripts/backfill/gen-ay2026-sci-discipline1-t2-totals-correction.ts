// scripts/backfill/gen-ay2026-sci-discipline1-t2-totals-correction.ts
//
// Emits reviewable SQL to repair the ONE grading sheet in AY2026 whose stored
// grades disagree with its stored totals: SCI · Discipline 1 · T2.
//
// STRICTLY READ-ONLY. Like the other gen-* backfill scripts, it writes no rows
// itself — it prints SQL for a human to read and run.
//
// ---------------------------------------------------------------------------
// What is wrong, and which side of it
//
// Found by scripts/audit-grade-recompute-drift.ts. The sheet holds
//   ww_totals [20,20,20]   pt_totals [30,30,25]   qa_total 65
// but every one of its 29 students' stored ww_ps / pt_ps / qa_ps /
// initial_grade / quarterly_grade reproduces exactly under
//   ww_totals [20,20]      pt_totals [25,25,25]   qa_total 60
// which is what EVERY other Term 2 section on this subject holds. The students
// each have only two written-work scores, and the subject config permits only
// two (ww_max_slots = 2), so the three-slot ww_totals also breaches the ceiling.
//
// So the GRADES are right and the TOTALS are wrong — the sheet's totals row was
// mangled by the grading backfill import (locked_by = 'backfill-import') after
// the grades had been computed. Recomputing against the stored totals would
// push the whole class DOWN (80 -> 78, 89 -> 86, 84 -> 82) and would be
// destroying correct data. This script therefore restores the totals and does
// not touch a single score or grade.
//
// The script REFUSES to emit SQL unless all five stored values reproduce for
// EVERY entry under the proposed totals. That check is the whole safety
// argument: five independent numbers matching to four decimal places across 29
// students is not a coincidence, and if it ever stops holding, the premise is
// wrong and the SQL must not be run.
//
// Hard Rule #5: the sheet is LOCKED, so the change carries an
// approval_reference and writes grade_audit_log rows, exactly as the post-lock
// path in app/api/grading-sheets/[id]/totals/route.ts does.
// Hard Rule #6: append-only — nothing is deleted, no score is altered.
//
// Run:
//   npx tsx --env-file=.env.local scripts/backfill/gen-ay2026-sci-discipline1-t2-totals-correction.ts
//   ... then read the SQL, and run it yourself if you agree with it.
import { computeQuarterly } from '../../lib/compute/quarterly';
import { fetchAllPages } from '../../lib/supabase/paginate';
import { createServiceClient } from '../../lib/supabase/service';

const AY = 'AY2026';
const SUBJECT_CODE = 'SCI';
const SECTION_NAME = 'Discipline 1';
const TERM_NUMBER = 2;

// The sibling shape: what every other T2 section on this subject holds, and
// what the stored grades were demonstrably computed against.
const PROPOSED = {
  ww_totals: [20, 20],
  pt_totals: [25, 25, 25],
  qa_total: 60,
};

const CHANGED_BY = 'data-correction-script';
const APPROVAL_REFERENCE =
  'Data entry correction: sheet totals corrupted by backfill import; ' +
  'restored to the values the stored grades were computed against ' +
  '(see scripts/audit-grade-recompute-drift.ts)';

const EPSILON = 1e-4;

// A function declaration, not a const arrow: TypeScript only narrows on a
// never-returning call when the callee's type is known at the call site
// without inference, which a plain `const die = ... => never` does not give.
function die(msg: string): never {
  console.error(`\n  ABORT — ${msg}\n`);
  process.exit(1);
}

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const pad = (arr: (number | null)[] | null, len: number) => {
  const out: (number | null)[] = new Array(len).fill(null);
  const src = arr ?? [];
  for (let i = 0; i < Math.min(src.length, len); i++) out[i] = src[i] ?? null;
  return out;
};

const sqlNumArray = (a: number[]) => `'{${a.join(',')}}'::numeric[]`;
const sqlStr = (s: string) => `'${s.replace(/'/g, "''")}'`;

async function main() {
  const service = createServiceClient();

  // ---- Locate the sheet ------------------------------------------------
  const { data: ays } = await service
    .from('academic_years')
    .select('id, ay_code')
    .eq('ay_code', AY);
  const ayId = (ays as { id: string }[] | null)?.[0]?.id;
  if (!ayId) die(`${AY} not found`);

  const { data: termRows } = await service
    .from('terms')
    .select('id, term_number, academic_year_id')
    .eq('academic_year_id', ayId)
    .eq('term_number', TERM_NUMBER);
  const termId = (termRows as { id: string }[] | null)?.[0]?.id;
  if (!termId) die(`${AY} has no T${TERM_NUMBER} row`);

  const { data: subjRows } = await service
    .from('subjects')
    .select('id, code')
    .eq('code', SUBJECT_CODE);
  const subjectId = (subjRows as { id: string }[] | null)?.[0]?.id;
  if (!subjectId) die(`subject ${SUBJECT_CODE} not found`);

  const { data: sectRows } = await service
    .from('sections')
    .select('id, name, academic_year_id')
    .eq('academic_year_id', ayId)
    .eq('name', SECTION_NAME);
  const sectionId = (sectRows as { id: string }[] | null)?.[0]?.id;
  if (!sectionId) die(`section ${SECTION_NAME} not found in ${AY}`);

  const { data: sheetRows } = await service
    .from('grading_sheets')
    .select(
      'id, ww_totals, pt_totals, qa_total, is_locked, locked_by, subject_config_id'
    )
    .eq('term_id', termId)
    .eq('section_id', sectionId)
    .eq('subject_id', subjectId);
  const sheet = (sheetRows as Record<string, unknown>[] | null)?.[0];
  if (!sheet)
    die(
      `no grading sheet for ${SUBJECT_CODE} · ${SECTION_NAME} · T${TERM_NUMBER}`
    );

  const sheetId = sheet.id as string;
  const before = {
    ww_totals: ((sheet.ww_totals as number[] | null) ?? []).map(Number),
    pt_totals: ((sheet.pt_totals as number[] | null) ?? []).map(Number),
    qa_total: num(sheet.qa_total),
  };

  const { data: cfgRows } = await service
    .from('subject_configs')
    .select('id, ww_weight, pt_weight, qa_weight, ww_max_slots, pt_max_slots')
    .eq('id', sheet.subject_config_id as string);
  const cfg = (cfgRows as Record<string, unknown>[] | null)?.[0];
  if (!cfg) die('subject config for the sheet not found');

  // ---- Load every entry ------------------------------------------------
  const entries = await fetchAllPages<Record<string, unknown>>((from, to) =>
    service
      .from('grade_entries')
      .select(
        'id, section_student_id, ww_scores, pt_scores, qa_score, ww_ps, pt_ps, qa_ps, initial_grade, quarterly_grade, is_na'
      )
      .eq('grading_sheet_id', sheetId)
      .order('id')
      .range(from, to)
  );
  if (entries.length === 0) die('sheet has no grade entries');

  // ---- Prove the premise before emitting anything ----------------------
  // Every stored value must reproduce under PROPOSED. Any mismatch means the
  // "grades are right, totals are wrong" reading is false for this sheet.
  const mismatches: string[] = [];
  for (const e of entries) {
    const computed = computeQuarterly({
      ww_scores: pad(
        ((e.ww_scores as (number | null)[] | null) ?? []).map(num),
        PROPOSED.ww_totals.length
      ),
      ww_totals: PROPOSED.ww_totals,
      pt_scores: pad(
        ((e.pt_scores as (number | null)[] | null) ?? []).map(num),
        PROPOSED.pt_totals.length
      ),
      pt_totals: PROPOSED.pt_totals,
      qa_score: num(e.qa_score),
      qa_total: PROPOSED.qa_total,
      ww_weight: Number(cfg.ww_weight),
      pt_weight: Number(cfg.pt_weight),
      qa_weight: Number(cfg.qa_weight),
    });

    const near = (a: number | null, b: number | null) =>
      a == null && b == null
        ? true
        : a == null || b == null
          ? false
          : Math.abs(a - b) <= EPSILON;

    const checks: Array<[string, boolean]> = [
      ['ww_ps', near(num(e.ww_ps), computed.ww_ps)],
      ['pt_ps', near(num(e.pt_ps), computed.pt_ps)],
      ['qa_ps', near(num(e.qa_ps), computed.qa_ps)],
      ['initial_grade', near(num(e.initial_grade), computed.initial_grade)],
      ['quarterly_grade', num(e.quarterly_grade) === computed.quarterly_grade],
    ];
    const bad = checks.filter(([, ok]) => !ok).map(([name]) => name);
    if (bad.length > 0) {
      mismatches.push(
        `      entry ${e.id as string}: ${bad.join(', ')} do not reproduce ` +
          `(stored quarterly ${String(e.quarterly_grade)}, computed ${String(computed.quarterly_grade)})`
      );
    }
  }

  console.log(`\n  ${SUBJECT_CODE} · ${SECTION_NAME} · T${TERM_NUMBER}`);
  console.log(`  sheet ${sheetId}`);
  console.log(
    `  locked=${String(sheet.is_locked)} locked_by=${String(sheet.locked_by)}  ${entries.length} entries\n`
  );
  console.log(
    `  stored totals   ww ${JSON.stringify(before.ww_totals)}  pt ${JSON.stringify(before.pt_totals)}  qa ${String(before.qa_total)}`
  );
  console.log(
    `  proposed totals ww ${JSON.stringify(PROPOSED.ww_totals)}  pt ${JSON.stringify(PROPOSED.pt_totals)}  qa ${PROPOSED.qa_total}`
  );
  console.log(
    `  config ceiling  ww_max_slots ${String(cfg.ww_max_slots)}  pt_max_slots ${String(cfg.pt_max_slots)}\n`
  );

  if (mismatches.length > 0) {
    console.error(
      `  ${mismatches.length} of ${entries.length} entries do NOT reproduce under the proposed totals:`
    );
    for (const m of mismatches.slice(0, 10)) console.error(m);
    die(
      'the premise does not hold for this sheet. Do not run any correction —\n' +
        '  re-open the investigation instead.'
    );
  }

  console.log(
    `  VERIFIED. All ${entries.length} entries reproduce all five stored values\n` +
      '  exactly under the proposed totals. The grades on file are correct and\n' +
      '  only the totals need restoring.\n'
  );

  // ---- Emit SQL --------------------------------------------------------
  const anchorEntryId = entries[0].id as string;
  const lines: string[] = [];
  lines.push('-- AY2026 SCI · Discipline 1 · T2 — restore sheet totals.');
  lines.push(
    '-- Generated by scripts/backfill/gen-ay2026-sci-discipline1-t2-totals-correction.ts'
  );
  lines.push('-- Corrects the TOTALS only. No score and no grade is modified.');
  lines.push(
    '-- Verified: all ' +
      entries.length +
      ' stored grades reproduce under the new totals.'
  );
  lines.push('begin;');
  lines.push('');
  lines.push('update public.grading_sheets set');
  lines.push(`  ww_totals = ${sqlNumArray(PROPOSED.ww_totals)},`);
  lines.push(`  pt_totals = ${sqlNumArray(PROPOSED.pt_totals)},`);
  lines.push(`  qa_total  = ${PROPOSED.qa_total},`);
  lines.push('  updated_at = now()');
  lines.push(`where id = ${sqlStr(sheetId)}`);
  // Optimistic guard: refuse to apply if the row is no longer what we read.
  lines.push(`  and ww_totals = ${sqlNumArray(before.ww_totals)}`);
  lines.push(`  and pt_totals = ${sqlNumArray(before.pt_totals)}`);
  lines.push(
    `  and qa_total ${before.qa_total == null ? 'is null' : `= ${before.qa_total}`};`
  );
  lines.push('');
  lines.push(
    '-- Hard Rule #5: post-lock change, so it carries an approval_reference'
  );
  lines.push('-- and an append-only audit row per changed field.');
  lines.push(
    'insert into public.grade_audit_log (grade_entry_id, grading_sheet_id, changed_by, field_changed, old_value, new_value, approval_reference) values'
  );

  const auditRows: string[] = [];
  const diffArray = (name: 'ww_totals' | 'pt_totals') => {
    const a = before[name];
    const b = PROPOSED[name];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const oldV = a[i] ?? null;
      const newV = b[i] ?? null;
      if (oldV === newV) continue;
      auditRows.push(
        `  (${sqlStr(anchorEntryId)}, ${sqlStr(sheetId)}, ${sqlStr(CHANGED_BY)}, ${sqlStr(`${name}[${i}]`)}, ${oldV == null ? 'null' : sqlStr(String(oldV))}, ${newV == null ? 'null' : sqlStr(String(newV))}, ${sqlStr(APPROVAL_REFERENCE)})`
      );
    }
  };
  diffArray('ww_totals');
  diffArray('pt_totals');
  if (before.qa_total !== PROPOSED.qa_total) {
    auditRows.push(
      `  (${sqlStr(anchorEntryId)}, ${sqlStr(sheetId)}, ${sqlStr(CHANGED_BY)}, ${sqlStr('qa_total')}, ${before.qa_total == null ? 'null' : sqlStr(String(before.qa_total))}, ${sqlStr(String(PROPOSED.qa_total))}, ${sqlStr(APPROVAL_REFERENCE)})`
    );
  }
  lines.push(auditRows.join(',\n') + ';');
  lines.push('');
  lines.push(
    '-- Re-run scripts/audit-grade-recompute-drift.ts --all afterwards:'
  );
  lines.push(
    '-- this sheet should disappear from every section of the report.'
  );
  lines.push('commit;');

  console.log('  ---------- SQL for review ----------\n');
  console.log(lines.join('\n'));
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
