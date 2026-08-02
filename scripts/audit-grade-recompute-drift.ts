// scripts/audit-grade-recompute-drift.ts
//
// Recomputes every grade entry from its OWN stored raw scores and its sheet's
// stored totals, then compares the result against the stored ww_ps / pt_ps /
// qa_ps / initial_grade / quarterly_grade. Reports every row where the stored
// value is not what the canonical formula produces.
//
// Why this exists. `sync_grading_sheets_from_config`
// (supabase/migrations/052_sync_grading_sheets_from_config.sql) runs whenever a
// coordinator changes ww_max_slots / pt_max_slots / qa_max on a subject_configs
// row. It fans out to every unlocked grading sheet using that config — all four
// terms, every section — and updates grading_sheets.{ww_totals, pt_totals,
// qa_total} plus the SHAPE of grade_entries.{ww_scores, pt_scores}. It never
// recomputes the derived columns, and being a SQL function it cannot call
// lib/compute/quarterly.ts. So the denominator moves and the grade does not.
//
// That matters because the STORED quarterly_grade is what gets printed:
// lib/report-card/build-report-card.ts selects it and renders it directly. A
// stale value is a wrong report card, not a stale cache. It stays wrong until
// someone happens to re-save a score on that sheet, which re-runs the recompute
// in app/api/grading-sheets/[id]/entries/[entryId]/route.ts.
//
// This script answers the only question that decides how serious that is: are
// there wrong grades in production right now, and where.
//
// STRICTLY READ-ONLY. It issues SELECTs and nothing else — no update, no
// insert, no rpc, and there is deliberately no --fix flag. Safe to point at
// production.
//
// Run:
//   npx tsx --env-file=.env.local scripts/audit-grade-recompute-drift.ts
//   npx tsx --env-file=.env.local scripts/audit-grade-recompute-drift.ts --ay AY2025
//   npx tsx --env-file=.env.local scripts/audit-grade-recompute-drift.ts --all --json
//
// Flags:
//   --ay <code>  audit a specific academic year (default: the current one)
//   --all        also audit LOCKED sheets. Drift there is worse, not better —
//                a locked sheet has already been published — but the fix will
//                not touch it (Hard Rule #5), so it needs a human decision.
//   --json       emit machine-readable output instead of the report
//
// Exit code is 0 when every stored grade matches the formula, 1 when any
// QUARTERLY_DRIFT or SHAPE_MISMATCH is found, so it can be wired into CI later
// without modification.
import { computeQuarterly } from '../lib/compute/quarterly';
import { fetchAllPages, fetchInChunks } from '../lib/supabase/paginate';
import { createServiceClient } from '../lib/supabase/service';

// The stored percentage columns are numeric(7,4), so they come back already
// rounded on write. Comparing them with === would report every single row.
const PS_EPSILON = 1e-4;

type AcademicYearRow = { id: string; ay_code: string; is_current: boolean };
type TermRow = { id: string; academic_year_id: string; term_number: number };
type SectionRow = { id: string; name: string; academic_year_id: string };
type SubjectRow = { id: string; code: string; is_examinable: boolean };
type ConfigRow = {
  id: string;
  ww_weight: number;
  pt_weight: number;
  qa_weight: number;
  ww_max_slots: number;
  pt_max_slots: number;
  qa_max: number;
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
  section_student_id: string;
  ww_scores: (number | null)[] | null;
  pt_scores: (number | null)[] | null;
  qa_score: number | null;
  ww_ps: number | null;
  pt_ps: number | null;
  qa_ps: number | null;
  initial_grade: number | null;
  quarterly_grade: number | null;
  is_na: boolean;
};
// PostgREST types an embedded relation as an array even when the FK makes it
// at most one row, so this is `students[]` rather than `students | null`.
type EnrolmentRow = {
  id: string;
  students: { student_number: string }[] | null;
};

type Finding = {
  kind:
    | 'QUARTERLY_DRIFT'
    | 'GRADE_WITHOUT_SCORES'
    | 'PS_DRIFT_ONLY'
    | 'SHAPE_MISMATCH'
    | 'CONFIG_OVER_CEILING';
  sheetId: string;
  entryId: string | null;
  studentNumber: string | null;
  isNa: boolean;
  storedQuarterly: number | null;
  computedQuarterly: number | null;
  detail: string;
};

// Same padding rule as app/api/grading-sheets/[id]/totals/route.ts:168-173.
// Pads with null, never 0 — Hard Rule #3, blank is not a zero.
function pad(arr: (number | null)[] | null, length: number): (number | null)[] {
  const out: (number | null)[] = new Array(length).fill(null);
  const src = arr ?? [];
  for (let i = 0; i < Math.min(src.length, length); i++)
    out[i] = src[i] ?? null;
  return out;
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function psDiffers(stored: number | null, computed: number | null): boolean {
  if (stored == null && computed == null) return false;
  if (stored == null || computed == null) return true;
  return Math.abs(stored - computed) > PS_EPSILON;
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

  // ---- Resolve the academic year -------------------------------------
  const { data: ayData, error: ayErr } = await service
    .from('academic_years')
    .select('id, ay_code, is_current');
  if (ayErr) fail(`Could not read academic_years: ${ayErr.message}`);
  const years = (ayData ?? []) as AcademicYearRow[];
  const ay = ayCode
    ? years.find((y) => y.ay_code === ayCode)
    : years.find((y) => y.is_current);
  if (!ay) {
    fail(
      ayCode
        ? `No academic year with code ${ayCode}. Known: ${years.map((y) => y.ay_code).join(', ')}`
        : 'No academic year is marked is_current, and no --ay was given.'
    );
  }

  // ---- Reference data for labels -------------------------------------
  const [termsRes, sectionsRes, subjectsRes, configsRes] = await Promise.all([
    service.from('terms').select('id, academic_year_id, term_number'),
    service.from('sections').select('id, name, academic_year_id'),
    service.from('subjects').select('id, code, is_examinable'),
    service
      .from('subject_configs')
      .select(
        'id, ww_weight, pt_weight, qa_weight, ww_max_slots, pt_max_slots, qa_max'
      ),
  ]);
  for (const [label, res] of [
    ['terms', termsRes],
    ['sections', sectionsRes],
    ['subjects', subjectsRes],
    ['subject_configs', configsRes],
  ] as const) {
    if (res.error) fail(`Could not read ${label}: ${res.error.message}`);
  }

  const terms = (termsRes.data ?? []) as TermRow[];
  const sections = (sectionsRes.data ?? []) as SectionRow[];
  const subjects = (subjectsRes.data ?? []) as SubjectRow[];
  const configs = (configsRes.data ?? []) as ConfigRow[];

  const termById = new Map(terms.map((t) => [t.id, t]));
  const sectionById = new Map(sections.map((s) => [s.id, s]));
  const subjectById = new Map(subjects.map((s) => [s.id, s]));
  const configById = new Map(configs.map((c) => [c.id, c]));

  const ayTermIds = terms
    .filter((t) => t.academic_year_id === ay!.id)
    .map((t) => t.id);
  if (ayTermIds.length === 0) fail(`${ay!.ay_code} has no term rows.`);

  // ---- Grading sheets in scope ---------------------------------------
  const allSheets = (await fetchInChunks(ayTermIds, (slice) =>
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

  const sheets = includeLocked
    ? allSheets
    : allSheets.filter((s) => !s.is_locked);
  const lockedCount = allSheets.filter((s) => s.is_locked).length;

  if (sheets.length === 0) {
    console.log(`\n  ${ay!.ay_code} has no grading sheets in scope.\n`);
    process.exit(0);
  }

  // ---- Entries --------------------------------------------------------
  const sheetIds = sheets.map((s) => s.id);
  const entries = (await fetchInChunks(sheetIds, (slice) =>
    fetchAllPages<EntryRow>((from, to) =>
      service
        .from('grade_entries')
        .select(
          'id, grading_sheet_id, section_student_id, ww_scores, pt_scores, qa_score, ww_ps, pt_ps, qa_ps, initial_grade, quarterly_grade, is_na'
        )
        .in('grading_sheet_id', slice)
        .order('id')
        .range(from, to)
    )
  )) as EntryRow[];

  // student_number for readable samples. Chunked because section_student_id is
  // a uuid and HFSE's roster is already past the ~396-uuid URL ceiling
  // documented in lib/supabase/paginate.ts.
  const enrolmentIds = [...new Set(entries.map((e) => e.section_student_id))];
  const enrolments = (await fetchInChunks(enrolmentIds, (slice) =>
    fetchAllPages<EnrolmentRow>((from, to) =>
      service
        .from('section_students')
        .select('id, students(student_number)')
        .in('id', slice)
        .order('id')
        .range(from, to)
    )
  )) as EnrolmentRow[];
  const studentNumberByEnrolment = new Map(
    enrolments.map((e) => [e.id, e.students?.[0]?.student_number ?? null])
  );

  const entriesBySheet = new Map<string, EntryRow[]>();
  for (const e of entries) {
    const list = entriesBySheet.get(e.grading_sheet_id);
    if (list) list.push(e);
    else entriesBySheet.set(e.grading_sheet_id, [e]);
  }

  // ---- Compare --------------------------------------------------------
  const findings: Finding[] = [];
  const sheetLabel = (s: SheetRow) => {
    const t = termById.get(s.term_id);
    return [
      subjectById.get(s.subject_id)?.code ?? '???',
      sectionById.get(s.section_id)?.name ?? '???',
      t ? `T${t.term_number}` : '???',
    ].join(' · ');
  };

  // Non-examinable subjects (MAPEH family — CA, PEH, MUSIC, ARTS, PE, HE …)
  // do NOT store a formula output in quarterly_grade. Per KD #95/#100/#104 they
  // are letter-graded, and the AY2025 backfill stores a band-representative
  // integer (95/87/82/70) that numericToLetter maps back to a letter; the
  // number itself is never shown. Recomputing those from components is
  // meaningless — the components are decorative where they exist at all — so
  // comparing them against computeQuarterly reports thousands of false
  // positives and buries the real ones. Skipped entirely, and counted so the
  // report says out loud what it did not look at.
  let skippedNonExaminable = 0;

  for (const sheet of sheets) {
    if (subjectById.get(sheet.subject_id)?.is_examinable === false) {
      skippedNonExaminable += (entriesBySheet.get(sheet.id) ?? []).length;
      continue;
    }
    const config = configById.get(sheet.subject_config_id);
    if (!config) {
      findings.push({
        kind: 'CONFIG_OVER_CEILING',
        sheetId: sheet.id,
        entryId: null,
        studentNumber: null,
        isNa: false,
        storedQuarterly: null,
        computedQuarterly: null,
        detail: `sheet references subject_config ${sheet.subject_config_id}, which does not exist`,
      });
      continue;
    }

    const wwTotals = (sheet.ww_totals ?? []).map((v) => Number(v));
    const ptTotals = (sheet.pt_totals ?? []).map((v) => Number(v));
    const qaTotal = numOrNull(sheet.qa_total);

    // A sheet may hold FEWER slots than the config ceiling — the totals route
    // permits length <= max_slots. Only exceeding it is an invariant breach.
    if (
      wwTotals.length > config.ww_max_slots ||
      ptTotals.length > config.pt_max_slots
    ) {
      findings.push({
        kind: 'CONFIG_OVER_CEILING',
        sheetId: sheet.id,
        entryId: null,
        studentNumber: null,
        isNa: false,
        storedQuarterly: null,
        computedQuarterly: null,
        detail: `ww ${wwTotals.length}/${config.ww_max_slots}, pt ${ptTotals.length}/${config.pt_max_slots}`,
      });
    }

    for (const entry of entriesBySheet.get(sheet.id) ?? []) {
      const rawWw = (entry.ww_scores ?? []).map(numOrNull);
      const rawPt = (entry.pt_scores ?? []).map(numOrNull);
      const studentNumber =
        studentNumberByEnrolment.get(entry.section_student_id) ?? null;

      // A migrated year carries final grades imported from the old workbooks
      // with no component marks behind them. computeQuarterly correctly
      // returns null from nothing, so this reads as drift when it is really
      // "there is nothing to recompute FROM". It is a data-completeness fact
      // about the import, not a formula disagreement, and lumping the two
      // together makes the headline number useless on AY2025.
      const hasNoRawScores =
        rawWw.every((v) => v == null) &&
        rawPt.every((v) => v == null) &&
        numOrNull(entry.qa_score) == null;

      // The resize-without-recompute signature: the RPC pads the score array
      // to the new slot count, so a mismatch means the array was NOT resized
      // alongside the totals — or was resized while the grade was left alone.
      // An empty score array against a populated totals array is the import
      // artifact above, not a resize, so it is reported under that heading.
      if (
        !hasNoRawScores &&
        (rawWw.length !== wwTotals.length || rawPt.length !== ptTotals.length)
      ) {
        findings.push({
          kind: 'SHAPE_MISMATCH',
          sheetId: sheet.id,
          entryId: entry.id,
          studentNumber,
          isNa: entry.is_na,
          storedQuarterly: entry.quarterly_grade,
          computedQuarterly: null,
          detail: `ww ${rawWw.length} scores vs ${wwTotals.length} totals, pt ${rawPt.length} vs ${ptTotals.length}`,
        });
      }

      const computed = computeQuarterly({
        ww_scores: pad(rawWw, wwTotals.length),
        ww_totals: wwTotals,
        pt_scores: pad(rawPt, ptTotals.length),
        pt_totals: ptTotals,
        qa_score: numOrNull(entry.qa_score),
        qa_total: qaTotal,
        ww_weight: Number(config.ww_weight),
        pt_weight: Number(config.pt_weight),
        qa_weight: Number(config.qa_weight),
      });

      const storedQ = entry.quarterly_grade;
      const quarterlyDiffers =
        (storedQ == null) !== (computed.quarterly_grade == null) ||
        (storedQ != null &&
          computed.quarterly_grade != null &&
          storedQ !== computed.quarterly_grade);

      if (quarterlyDiffers && hasNoRawScores) {
        findings.push({
          kind: 'GRADE_WITHOUT_SCORES',
          sheetId: sheet.id,
          entryId: entry.id,
          studentNumber,
          isNa: entry.is_na,
          storedQuarterly: storedQ,
          computedQuarterly: computed.quarterly_grade,
          detail: `stored ${storedQ ?? 'null'} with no component scores on file`,
        });
        continue;
      }

      if (quarterlyDiffers) {
        findings.push({
          kind: 'QUARTERLY_DRIFT',
          sheetId: sheet.id,
          entryId: entry.id,
          studentNumber,
          isNa: entry.is_na,
          storedQuarterly: storedQ,
          computedQuarterly: computed.quarterly_grade,
          detail: `stored ${storedQ ?? 'null'} vs computed ${computed.quarterly_grade ?? 'null'}`,
        });
        continue;
      }

      const psDrift =
        psDiffers(numOrNull(entry.ww_ps), computed.ww_ps) ||
        psDiffers(numOrNull(entry.pt_ps), computed.pt_ps) ||
        psDiffers(numOrNull(entry.qa_ps), computed.qa_ps) ||
        psDiffers(numOrNull(entry.initial_grade), computed.initial_grade);

      if (psDrift) {
        findings.push({
          kind: 'PS_DRIFT_ONLY',
          sheetId: sheet.id,
          entryId: entry.id,
          studentNumber,
          isNa: entry.is_na,
          storedQuarterly: storedQ,
          computedQuarterly: computed.quarterly_grade,
          detail: 'component percentages stale; transmuted grade coincides',
        });
      }
    }
  }

  // ---- Report ---------------------------------------------------------
  const byKind = (k: Finding['kind']) => findings.filter((f) => f.kind === k);
  const quarterly = byKind('QUARTERLY_DRIFT');
  const noScores = byKind('GRADE_WITHOUT_SCORES');
  const shape = byKind('SHAPE_MISMATCH');
  const psOnly = byKind('PS_DRIFT_ONLY');
  const ceiling = byKind('CONFIG_OVER_CEILING');

  // is_na rows are broken out so they never inflate the headline number: an
  // N.A. entry legitimately carries no grade for a term the student was not
  // enrolled in (KD #148).
  const realQuarterly = quarterly.filter((f) => !f.isNa);
  const naQuarterly = quarterly.filter((f) => f.isNa);

  if (json) {
    console.log(
      JSON.stringify(
        {
          academicYear: ay!.ay_code,
          includeLocked,
          sheetsAudited: sheets.length,
          entriesAudited: entries.length,
          findings,
        },
        null,
        2
      )
    );
    process.exit(quarterly.length + shape.length > 0 ? 1 : 0);
  }

  console.log(`\n  ${ay!.ay_code} — grade recompute drift`);
  console.log(
    `  ${sheets.length} sheets audited (${
      includeLocked
        ? `${lockedCount} locked included`
        : `${lockedCount} locked skipped — pass --all to include`
    }), ${entries.length} entries`
  );
  console.log(
    `  ${skippedNonExaminable} entries on non-examinable subjects skipped — they carry a\n` +
      '  band-representative number standing in for a letter, not a formula result.\n'
  );

  const sheetsWith = (list: Finding[]) => new Set(list.map((f) => f.sheetId));

  const section = (
    label: string,
    list: Finding[],
    note: string,
    sample = 8
  ) => {
    if (list.length === 0) return;
    console.log(
      `  ${label} — ${list.length} entries across ${sheetsWith(list).size} sheets`
    );
    console.log(`    ${note}`);
    const bySheet = new Map<string, Finding[]>();
    for (const f of list) {
      const g = bySheet.get(f.sheetId);
      if (g) g.push(f);
      else bySheet.set(f.sheetId, [f]);
    }
    let shown = 0;
    for (const [sheetId, group] of bySheet) {
      if (shown >= sample) {
        console.log(`      … and ${bySheet.size - shown} more sheets`);
        break;
      }
      const sheet = sheets.find((s) => s.id === sheetId);
      const locked = sheet?.is_locked ? '  [LOCKED]' : '';
      console.log(
        `      ${sheet ? sheetLabel(sheet) : sheetId}  ${group.length} entries${locked}`
      );
      for (const f of group.slice(0, 3)) {
        console.log(
          `        ${(f.studentNumber ?? f.entryId ?? '?').padEnd(14)} ${f.detail}`
        );
      }
      shown += 1;
    }
    console.log('');
  };

  section(
    'QUARTERLY DRIFT',
    realQuarterly,
    'The stored grade is not what the formula produces. THIS IS WHAT THE\n' +
      '    REPORT CARD PRINTS.\n' +
      '    Drift proves the two disagree, NOT which one is wrong. Where the same\n' +
      '    sheet also appears under SHAPE MISMATCH or OVER CONFIG CEILING,\n' +
      '    suspect the TOTALS, not the grades: compare the sheet against its\n' +
      '    siblings (same subject + term, other sections) before recomputing.\n' +
      '    Recomputing against corrupted totals would replace correct grades\n' +
      '    with wrong ones for every student on the sheet.'
  );
  section(
    'QUARTERLY DRIFT (is_na rows)',
    naQuarterly,
    'Entries marked N.A. Expected to carry no grade — listed for completeness,\n' +
      '    excluded from the verdict.'
  );
  section(
    'GRADE WITH NO COMPONENT SCORES',
    noScores,
    'A final grade is on file with no marks behind it. Normal for a migrated\n' +
      "    year — the old workbooks' totals were imported, the raw marks were not.\n" +
      '    Nothing to recompute; excluded from the verdict. On a LIVE year this\n' +
      '    would instead mean scores were wiped without clearing the grade.'
  );
  section(
    'SHAPE MISMATCH',
    shape,
    'Score array length does not match the totals array. This is the\n' +
      '    signature of a resize that never recomputed.'
  );
  section(
    'PERCENTAGES STALE ONLY',
    psOnly,
    'Component percentages are stale but the transmuted grade coincides.\n' +
      '    Not visible on a report card; still wrong in the database.'
  );
  section(
    'SHEET OVER CONFIG CEILING',
    ceiling,
    'The sheet holds more slots than its subject config permits.'
  );

  const dirty = realQuarterly.length > 0 || shape.length > 0;
  console.log(
    dirty
      ? `  DRIFT. ${realQuarterly.length} entries carry a stored quarterly_grade the\n` +
          `  formula does not produce, and ${shape.length} entries have a score array that\n` +
          `  does not match their sheet's totals.\n`
      : '  CLEAN. Every stored grade in scope matches the canonical computation.\n'
  );
  process.exit(dirty ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
