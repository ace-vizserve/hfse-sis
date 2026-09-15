// scripts/audit-missing-component-weight.ts
//
// How many students hold a grade that was computed as if a component they
// never sat had scored zero?
//
// Why this exists. `lib/compute/quarterly.ts` sums the three components like
// this:
//
//   initial = (ww_ps ?? 0) * ww_weight
//           + (pt_ps ?? 0) * pt_weight
//           + (qa_ps ?? 0) * qa_weight
//
// A missing component contributes ZERO. It does not give its weight back. That
// is correct when a component exists and a student has not been marked for it
// yet, and it is wrong when the component does not exist at all that term.
//
// Miss Joann, 2026-09-15 training: S3 Filipino has an exam in some terms and
// not others, and Global Perspectives had no exam in Term 3 — "those subjects
// have PT scores only, and the PT score effectively is the exam". With
// Filipino's weights (30/50/20), a student on full marks in a term with no exam
// computes to an initial of 80 and a quarterly of 87. Global Perspectives with
// performance tasks only computes to 50, transmuting to 72.
//
// Weights live on `subject_configs`, one row per (subject, academic year).
// There is no per-term weight anywhere in the schema, so today there is no way
// to say "this term has no exam".
//
// WHAT COUNTS AS "MISSING" HERE. A component is treated as absent for a sheet
// only when NOT ONE student on that sheet has a single score in it, while the
// sheet does hold scores in some other component. That is the conservative
// reading and it is deliberate:
//
//   - one student with a blank exam is an absence, not a missing exam
//     (Hard Rule #3 — blank is not a zero, and it must stay that way)
//   - a sheet with nothing entered at all is simply unstarted, not broken
//
// So this script UNDER-reports rather than over-reports. A sheet where the exam
// does not exist but one teacher typed a single score is not counted.
//
// STRICTLY READ-ONLY. SELECTs only — no update, no insert, no rpc, and there is
// deliberately no --fix flag. Safe to point at production.
//
// Run:
//   npx tsx --env-file=.env.local scripts/audit-missing-component-weight.ts
//   npx tsx --env-file=.env.local scripts/audit-missing-component-weight.ts --ay AY2026
//   npx tsx --env-file=.env.local scripts/audit-missing-component-weight.ts --all
//   npx tsx --env-file=.env.local scripts/audit-missing-component-weight.ts --json
//
// Flags:
//   --ay <code>  audit one academic year (default: every year with sheets)
//   --all        include LOCKED sheets. They are counted separately because a
//                locked sheet has already been published, and Hard Rule #5
//                means any fix needs a change request rather than a recompute.
//   --json       machine-readable output
//
// Exit code is 0 when no sheet is losing a component's weight, 1 otherwise.
import { computeQuarterly } from '../lib/compute/quarterly';
import { createServiceClient } from '../lib/supabase/service';
import { fetchAllPages, fetchInChunks } from '../lib/supabase/paginate';

type AcademicYearRow = { id: string; ay_code: string; is_current: boolean };
type TermRow = { id: string; academic_year_id: string; term_number: number };
type SectionRow = { id: string; name: string };
type SubjectRow = { id: string; code: string; is_examinable: boolean };
type ConfigRow = {
  id: string;
  ww_weight: number | string;
  pt_weight: number | string;
  qa_weight: number | string;
};
type SheetRow = {
  id: string;
  term_id: string;
  section_id: string;
  subject_id: string;
  subject_config_id: string;
  ww_totals: number[] | null;
  pt_totals: number[] | null;
  qa_total: number | null;
  is_locked: boolean;
};
type EntryRow = {
  id: string;
  grading_sheet_id: string;
  ww_scores: (number | null)[] | null;
  pt_scores: (number | null)[] | null;
  qa_score: number | null;
  quarterly_grade: number | null;
  is_na: boolean;
};

type Component = 'ww' | 'pt' | 'qa';
const COMPONENT_LABEL: Record<Component, string> = {
  ww: 'Written work',
  pt: 'Performance tasks',
  qa: 'Exam',
};

type SheetFinding = {
  sheetId: string;
  ayCode: string;
  termNumber: number;
  subjectCode: string;
  sectionName: string;
  isLocked: boolean;
  missing: Component[];
  /** Weight currently being multiplied by zero, as a percentage. */
  lostWeightPct: number;
  studentsAffected: number;
  /** Mean stored quarterly across affected students. */
  meanNow: number | null;
  /** Mean quarterly those students would hold if the weight were redistributed. */
  meanRedistributed: number | null;
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Pads with null, never 0 — Hard Rule #3. */
function pad(arr: (number | null)[] | null, length: number): (number | null)[] {
  const out: (number | null)[] = new Array(length).fill(null);
  const src = arr ?? [];
  for (let i = 0; i < Math.min(src.length, length); i++)
    out[i] = src[i] ?? null;
  return out;
}

function hasAnyScore(scores: (number | null)[] | null): boolean {
  return (scores ?? []).some((s) => s != null);
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return (
    Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
  );
}

function parseArgs(argv: string[]) {
  const ayIdx = argv.indexOf('--ay');
  return {
    ayCode: ayIdx >= 0 ? argv[ayIdx + 1] : null,
    includeLocked: argv.includes('--all'),
    json: argv.includes('--json'),
  };
}

async function main() {
  const { ayCode, includeLocked, json } = parseArgs(process.argv.slice(2));
  const service = createServiceClient();

  const fail = (msg: string): never => {
    console.error(`\n  ${msg}\n`);
    process.exit(1);
  };

  const [ayRes, termsRes, sectionsRes, subjectsRes, configsRes] =
    await Promise.all([
      service.from('academic_years').select('id, ay_code, is_current'),
      service.from('terms').select('id, academic_year_id, term_number'),
      service.from('sections').select('id, name'),
      service.from('subjects').select('id, code, is_examinable'),
      service
        .from('subject_configs')
        .select('id, ww_weight, pt_weight, qa_weight'),
    ]);
  for (const [label, res] of [
    ['academic_years', ayRes],
    ['terms', termsRes],
    ['sections', sectionsRes],
    ['subjects', subjectsRes],
    ['subject_configs', configsRes],
  ] as const) {
    if (res.error) fail(`Could not read ${label}: ${res.error.message}`);
  }

  const years = (ayRes.data ?? []) as AcademicYearRow[];
  const terms = (termsRes.data ?? []) as TermRow[];
  const sections = (sectionsRes.data ?? []) as SectionRow[];
  const subjects = (subjectsRes.data ?? []) as SubjectRow[];
  const configs = (configsRes.data ?? []) as ConfigRow[];

  const scopedYears = ayCode
    ? years.filter((y) => y.ay_code === ayCode)
    : years;
  if (scopedYears.length === 0) {
    fail(
      `No academic year with code ${ayCode}. Known: ${years.map((y) => y.ay_code).join(', ')}`
    );
  }

  const ayById = new Map(scopedYears.map((y) => [y.id, y]));
  const termById = new Map(terms.map((t) => [t.id, t]));
  const sectionById = new Map(sections.map((s) => [s.id, s]));
  const subjectById = new Map(subjects.map((s) => [s.id, s]));
  const configById = new Map(configs.map((c) => [c.id, c]));

  const scopedTermIds = terms
    .filter((t) => ayById.has(t.academic_year_id))
    .map((t) => t.id);
  if (scopedTermIds.length === 0) fail('No term rows in scope.');

  const allSheets = (await fetchInChunks(scopedTermIds, (slice) =>
    fetchAllPages<SheetRow>((from, to) =>
      service
        .from('grading_sheets')
        .select(
          'id, term_id, section_id, subject_id, subject_config_id, ww_totals, pt_totals, qa_total, is_locked'
        )
        .in('term_id', slice)
        .order('id')
        .range(from, to)
    )
  )) as SheetRow[];

  if (allSheets.length === 0) {
    console.log('\n  No grading sheets in scope.\n');
    process.exit(0);
  }

  const entries = (await fetchInChunks(
    allSheets.map((s) => s.id),
    (slice) =>
      fetchAllPages<EntryRow>((from, to) =>
        service
          .from('grade_entries')
          .select(
            'id, grading_sheet_id, ww_scores, pt_scores, qa_score, quarterly_grade, is_na'
          )
          .in('grading_sheet_id', slice)
          .order('id')
          .range(from, to)
      )
  )) as EntryRow[];

  const entriesBySheet = new Map<string, EntryRow[]>();
  for (const e of entries) {
    const list = entriesBySheet.get(e.grading_sheet_id);
    if (list) list.push(e);
    else entriesBySheet.set(e.grading_sheet_id, [e]);
  }

  const findings: SheetFinding[] = [];
  let sheetsExamined = 0;

  for (const sheet of allSheets) {
    if (sheet.is_locked && !includeLocked) continue;

    const term = termById.get(sheet.term_id);
    const ay = term ? ayById.get(term.academic_year_id) : undefined;
    const subject = subjectById.get(sheet.subject_id);
    const config = configById.get(sheet.subject_config_id);
    if (!term || !ay || !subject || !config) continue;

    // Non-examinable subjects store a band-representative integer standing in
    // for a letter, not a formula output (KD #176). Comparing them produces
    // noise, so they are out of scope here for the same reason.
    if (!subject.is_examinable) continue;

    const sheetEntries = (entriesBySheet.get(sheet.id) ?? []).filter(
      (e) => !e.is_na
    );
    if (sheetEntries.length === 0) continue;

    const wwTotals = sheet.ww_totals ?? [];
    const ptTotals = sheet.pt_totals ?? [];

    const scored: Record<Component, boolean> = {
      ww: sheetEntries.some((e) => hasAnyScore(e.ww_scores)),
      pt: sheetEntries.some((e) => hasAnyScore(e.pt_scores)),
      qa: sheetEntries.some((e) => e.qa_score != null),
    };

    // A sheet nobody has started is unstarted, not broken.
    if (!scored.ww && !scored.pt && !scored.qa) continue;
    sheetsExamined += 1;

    const weight: Record<Component, number> = {
      ww: num(config.ww_weight),
      pt: num(config.pt_weight),
      qa: num(config.qa_weight),
    };

    const missing = (['ww', 'pt', 'qa'] as Component[]).filter(
      (c) => !scored[c] && weight[c] > 0
    );
    if (missing.length === 0) continue;

    const presentWeight = (['ww', 'pt', 'qa'] as Component[])
      .filter((c) => scored[c])
      .reduce((sum, c) => sum + weight[c], 0);
    if (presentWeight <= 0) continue;

    const factor = 1 / presentWeight;
    const redistributed: Record<Component, number> = {
      ww: scored.ww ? weight.ww * factor : 0,
      pt: scored.pt ? weight.pt * factor : 0,
      qa: scored.qa ? weight.qa * factor : 0,
    };

    const nowGrades: number[] = [];
    const afterGrades: number[] = [];

    for (const e of sheetEntries) {
      const input = {
        ww_scores: pad(e.ww_scores, wwTotals.length),
        ww_totals: wwTotals,
        pt_scores: pad(e.pt_scores, ptTotals.length),
        pt_totals: ptTotals,
        qa_score: e.qa_score,
        qa_total: sheet.qa_total,
      };
      const now = computeQuarterly({
        ...input,
        ww_weight: weight.ww,
        pt_weight: weight.pt,
        qa_weight: weight.qa,
      });
      const after = computeQuarterly({
        ...input,
        ww_weight: redistributed.ww,
        pt_weight: redistributed.pt,
        qa_weight: redistributed.qa,
      });
      if (now.quarterly_grade == null || after.quarterly_grade == null)
        continue;
      nowGrades.push(now.quarterly_grade);
      afterGrades.push(after.quarterly_grade);
    }

    if (nowGrades.length === 0) continue;

    findings.push({
      sheetId: sheet.id,
      ayCode: ay.ay_code,
      termNumber: term.term_number,
      subjectCode: subject.code,
      sectionName: sectionById.get(sheet.section_id)?.name ?? '?',
      isLocked: sheet.is_locked,
      missing,
      lostWeightPct: Math.round(
        missing.reduce((s, c) => s + weight[c], 0) * 100
      ),
      studentsAffected: nowGrades.length,
      meanNow: mean(nowGrades),
      meanRedistributed: mean(afterGrades),
    });
  }

  if (json) {
    console.log(JSON.stringify({ sheetsExamined, findings }, null, 2));
    process.exit(findings.length > 0 ? 1 : 0);
  }

  // ---- Report ---------------------------------------------------------
  const scopeLabel = ayCode ? ayCode : 'every academic year';
  console.log(
    `\n  Missing-component weight audit — ${scopeLabel}${includeLocked ? ' (including locked sheets)' : ''}`
  );
  console.log(`  ${sheetsExamined} started grading sheet(s) examined.\n`);

  if (findings.length === 0) {
    console.log(
      '  No sheet is losing a component’s weight. Every started sheet has\n' +
        '  at least one score in every component its config gives weight to.\n'
    );
    process.exit(0);
  }

  // Grouped by (AY, term, subject) — that is the grain a fix would be set at.
  const groups = new Map<string, SheetFinding[]>();
  for (const f of findings) {
    const key = `${f.ayCode} T${f.termNumber} ${f.subjectCode}`;
    const list = groups.get(key);
    if (list) list.push(f);
    else groups.set(key, [f]);
  }

  const totalStudents = findings.reduce((s, f) => s + f.studentsAffected, 0);
  const lockedSheets = findings.filter((f) => f.isLocked).length;

  console.log(
    `  ${findings.length} sheet(s) across ${groups.size} (year × term × subject) group(s)`
  );
  console.log(`  ${totalStudents} student grade(s) affected.\n`);

  for (const [key, list] of [...groups.entries()].sort()) {
    const missingLabels = [
      ...new Set(list.flatMap((f) => f.missing.map((c) => COMPONENT_LABEL[c]))),
    ].join(' + ');
    const students = list.reduce((s, f) => s + f.studentsAffected, 0);
    const lost = list[0]?.lostWeightPct ?? 0;
    const meanNow = mean(
      list.flatMap((f) => (f.meanNow == null ? [] : [f.meanNow]))
    );
    const meanAfter = mean(
      list.flatMap((f) =>
        f.meanRedistributed == null ? [] : [f.meanRedistributed]
      )
    );

    console.log(`  ${key}`);
    console.log(
      `    no scores in: ${missingLabels}  (${lost}% of the grade, multiplied by zero)`
    );
    console.log(
      `    ${list.length} sheet(s), ${students} student(s)` +
        (list.some((f) => f.isLocked) ? '  ⚠ includes locked' : '')
    );
    if (meanNow != null && meanAfter != null) {
      console.log(
        `    mean quarterly now ${meanNow}  →  ${meanAfter} if the weight were redistributed`
      );
    }
    console.log(
      `    classes: ${[...new Set(list.map((f) => f.sectionName))].sort().join(', ')}`
    );
    console.log('');
  }

  if (lockedSheets > 0) {
    console.log(
      `  ⚠ ${lockedSheets} of these sheet(s) are LOCKED. A locked sheet has already\n` +
        '    been published, so Hard Rule #5 applies — those need a change request,\n' +
        '    not a recompute.\n'
    );
  }

  console.log(
    '  Read this as a FLOOR, not a total. A component only counts as missing\n' +
      '  when not one student on the sheet has a score in it, so a term whose exam\n' +
      '  never happened but where one mark was typed is not listed above.\n'
  );

  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
