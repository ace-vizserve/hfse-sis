// scripts/audit-blank-slot-denominator.ts
//
// How many stored grades change if a blank WW/PT slot counts as zero against
// the FULL total, the way HFSE's grading workbooks compute it?
//
// Every AY2025 workbook (38 files, 4,719 PS formulas) divides by the header
// row's fixed total: `G10 = (F10/$F$9)*100`. lib/compute/quarterly.ts instead
// drops a blank slot from the denominator as well as the numerator, so a
// student with a blank slot beside a scored one gets a higher grade than the
// workbook would give. Example: WW 2 × 15, only WW1 = 14 → SIS 14/15, Excel
// 14/30; quarterly 69 vs 64.
//
// Only a PARTIALLY filled component differs. A wholly blank component is 0
// either way (null PS contributes 0 today; 0/total is 0 corrected), and QA is
// a single slot.
//
// STRICTLY READ-ONLY — SELECTs only, no --fix flag.
//
// Run:
//   npx tsx --env-file=.env.local scripts/audit-blank-slot-denominator.ts
//   npx tsx --env-file=.env.local scripts/audit-blank-slot-denominator.ts --json
import { computeQuarterly } from '../lib/compute/quarterly';
import { resolveSheetWeights } from '../lib/grading/resolve-sheet-weights';
import { fetchAllPages, fetchInChunks } from '../lib/supabase/paginate';
import { createServiceClient } from '../lib/supabase/service';

type AcademicYearRow = { id: string; ay_code: string };
type TermRow = { id: string; academic_year_id: string; term_number: number };
type SectionRow = { id: string; name: string };
type SubjectRow = { id: string; code: string; is_examinable: boolean };
type ConfigRow = {
  id: string;
  ww_weight: number;
  pt_weight: number;
  qa_weight: number;
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
  ww_weight: number | null;
  pt_weight: number | null;
  qa_weight: number | null;
  is_locked: boolean;
};
type EntryRow = {
  id: string;
  grading_sheet_id: string;
  section_student_id: string;
  ww_scores: (number | null)[] | null;
  pt_scores: (number | null)[] | null;
  qa_score: number | null;
  quarterly_grade: number | null;
  is_na: boolean;
};
type EnrolmentRow = {
  id: string;
  students: { student_number: string }[] | { student_number: string } | null;
};
type PublicationRow = { term_id: string; section_id: string };

type Change = {
  ay: string;
  term: number;
  subject: string;
  section: string;
  studentNumber: string | null;
  locked: boolean;
  published: boolean;
  stored: number | null;
  current: number | null;
  corrected: number | null;
  detail: string;
};

function pad(arr: (number | null)[] | null, length: number): (number | null)[] {
  const out: (number | null)[] = new Array(length).fill(null);
  const src = arr ?? [];
  for (let i = 0; i < Math.min(src.length, length); i++)
    out[i] = src[i] == null ? null : Number(src[i]);
  return out;
}

const numOrNull = (v: unknown): number | null =>
  v == null || !Number.isFinite(Number(v)) ? null : Number(v);

// A component where some slots are scored and some are blank — the only shape
// the two denominators disagree on.
const isPartial = (scores: (number | null)[]) =>
  scores.some((v) => v == null) && scores.some((v) => v != null);

async function main() {
  const json = process.argv.includes('--json');
  const service = createServiceClient();
  const fail = (msg: string): never => {
    console.error(`\n  ${msg}\n`);
    process.exit(1);
  };

  const [aysRes, termsRes, sectionsRes, subjectsRes, configsRes] =
    await Promise.all([
      service.from('academic_years').select('id, ay_code'),
      service.from('terms').select('id, academic_year_id, term_number'),
      service.from('sections').select('id, name'),
      service.from('subjects').select('id, code, is_examinable'),
      service
        .from('subject_configs')
        .select('id, ww_weight, pt_weight, qa_weight'),
    ]);
  for (const [label, res] of [
    ['academic_years', aysRes],
    ['terms', termsRes],
    ['sections', sectionsRes],
    ['subjects', subjectsRes],
    ['subject_configs', configsRes],
  ] as const) {
    if (res.error) fail(`Could not read ${label}: ${res.error.message}`);
  }
  const ayById = new Map(
    ((aysRes.data ?? []) as AcademicYearRow[]).map((a) => [a.id, a])
  );
  const terms = (termsRes.data ?? []) as TermRow[];
  const termById = new Map(terms.map((t) => [t.id, t]));
  const sectionById = new Map(
    ((sectionsRes.data ?? []) as SectionRow[]).map((s) => [s.id, s])
  );
  const subjectById = new Map(
    ((subjectsRes.data ?? []) as SubjectRow[]).map((s) => [s.id, s])
  );
  const configById = new Map(
    ((configsRes.data ?? []) as ConfigRow[]).map((c) => [c.id, c])
  );

  const sheets = (await fetchAllPages<SheetRow>((from, to) =>
    service
      .from('grading_sheets')
      .select(
        'id, term_id, section_id, subject_id, subject_config_id, ww_totals, pt_totals, qa_total, ww_weight, pt_weight, qa_weight, is_locked'
      )
      .order('id')
      .range(from, to)
  )) as SheetRow[];

  const publications = (await fetchAllPages<PublicationRow>((from, to) =>
    service
      .from('report_card_publications')
      .select('term_id, section_id')
      .order('term_id')
      .range(from, to)
  )) as PublicationRow[];
  const published = new Set(
    publications.map((p) => `${p.term_id}|${p.section_id}`)
  );

  const examinable = sheets.filter(
    (s) => subjectById.get(s.subject_id)?.is_examinable !== false
  );
  const entries = (await fetchInChunks(
    examinable.map((s) => s.id),
    (slice) =>
      fetchAllPages<EntryRow>((from, to) =>
        service
          .from('grade_entries')
          .select(
            'id, grading_sheet_id, section_student_id, ww_scores, pt_scores, qa_score, quarterly_grade, is_na'
          )
          .in('grading_sheet_id', slice)
          .order('id')
          .range(from, to)
      )
  )) as EntryRow[];

  const enrolments = (await fetchInChunks(
    [...new Set(entries.map((e) => e.section_student_id))],
    (slice) =>
      fetchAllPages<EnrolmentRow>((from, to) =>
        service
          .from('section_students')
          .select('id, students(student_number)')
          .in('id', slice)
          .order('id')
          .range(from, to)
      )
  )) as EnrolmentRow[];
  const studentNumberOf = new Map(
    enrolments.map((e) => {
      const s = Array.isArray(e.students) ? e.students[0] : e.students;
      return [e.id, s?.student_number ?? null];
    })
  );

  const entriesBySheet = new Map<string, EntryRow[]>();
  for (const e of entries) {
    const list = entriesBySheet.get(e.grading_sheet_id);
    if (list) list.push(e);
    else entriesBySheet.set(e.grading_sheet_id, [e]);
  }

  const changes: Change[] = [];
  const scanned = new Map<string, { entries: number; partial: number }>();

  for (const sheet of examinable) {
    const term = termById.get(sheet.term_id);
    const ay = term ? ayById.get(term.academic_year_id) : undefined;
    if (!term || !ay) continue;
    const config = configById.get(sheet.subject_config_id);
    if (!config) continue;
    const weights = resolveSheetWeights(sheet, config);
    const wwTotals = (sheet.ww_totals ?? []).map(Number);
    const ptTotals = (sheet.pt_totals ?? []).map(Number);
    const qaTotal = numOrNull(sheet.qa_total);
    const key = `${ay.ay_code} T${term.term_number}`;
    const tally = scanned.get(key) ?? { entries: 0, partial: 0 };
    scanned.set(key, tally);

    for (const entry of entriesBySheet.get(sheet.id) ?? []) {
      if (entry.is_na) continue;
      const ww = pad(entry.ww_scores, wwTotals.length);
      const pt = pad(entry.pt_scores, ptTotals.length);
      const qa = numOrNull(entry.qa_score);
      if (
        ww.every((v) => v == null) &&
        pt.every((v) => v == null) &&
        qa == null
      )
        continue;
      tally.entries += 1;
      if (!isPartial(ww) && !isPartial(pt)) continue;
      tally.partial += 1;

      const base = {
        ww_totals: wwTotals,
        pt_totals: ptTotals,
        qa_score: qa,
        qa_total: qaTotal,
        ...weights,
      };
      const current = computeQuarterly({
        ...base,
        ww_scores: ww,
        pt_scores: pt,
      }).quarterly_grade;
      const corrected = computeQuarterly({
        ...base,
        ww_scores: ww.map((v) => v ?? 0),
        pt_scores: pt.map((v) => v ?? 0),
      }).quarterly_grade;
      if (current === corrected) continue;

      const blanks = [
        ...ww.flatMap((v, i) => (v == null ? [`WW${i + 1}`] : [])),
        ...pt.flatMap((v, i) => (v == null ? [`PT${i + 1}`] : [])),
      ];
      changes.push({
        ay: ay.ay_code,
        term: term.term_number,
        subject: subjectById.get(sheet.subject_id)?.code ?? '???',
        section: sectionById.get(sheet.section_id)?.name ?? '???',
        studentNumber: studentNumberOf.get(entry.section_student_id) ?? null,
        locked: sheet.is_locked,
        published: published.has(`${sheet.term_id}|${sheet.section_id}`),
        stored: numOrNull(entry.quarterly_grade),
        current,
        corrected,
        detail: `blank ${blanks.join(',')}`,
      });
    }
  }

  if (json) {
    console.log(
      JSON.stringify({ scanned: Object.fromEntries(scanned), changes }, null, 2)
    );
    return;
  }

  console.log(
    '\n  Blank WW/PT slot counted against the full total — grade changes\n'
  );
  console.log(
    '  term           graded  partly-blank  grade changes  (locked / published)'
  );
  for (const key of [...scanned.keys()].sort()) {
    const t = scanned.get(key)!;
    const c = changes.filter((x) => `${x.ay} T${x.term}` === key);
    if (t.entries === 0) continue;
    console.log(
      `  ${key.padEnd(14)} ${String(t.entries).padStart(6)}  ${String(t.partial).padStart(12)}  ${String(c.length).padStart(13)}  (${c.filter((x) => x.locked).length} / ${c.filter((x) => x.published).length})`
    );
  }

  const drops = changes.map((c) => (c.current ?? 0) - (c.corrected ?? 0));
  const crossesPass = changes.filter(
    (c) => (c.current ?? 0) >= 75 && (c.corrected ?? 0) < 75
  );
  console.log(`\n  ${changes.length} grades change in total.`);
  if (changes.length) {
    drops.sort((a, b) => a - b);
    console.log(
      `  Drop: median ${drops[Math.floor(drops.length / 2)]}, max ${drops[drops.length - 1]}. ` +
        `${crossesPass.length} go from 75+ to below 75.`
    );
    const stale = changes.filter((c) => c.stored !== c.current).length;
    if (stale)
      console.log(
        `  ${stale} of them already have a stored grade that differs from today's formula (separate drift).`
      );
    console.log('\n  Largest changes:');
    for (const c of [...changes]
      .sort((a, b) => b.current! - b.corrected! - (a.current! - a.corrected!))
      .slice(0, 15)) {
      console.log(
        `    ${c.ay} T${c.term} ${c.subject.padEnd(6)} ${c.section.padEnd(18)} ${(c.studentNumber ?? '?').padEnd(10)} ${c.current} → ${c.corrected}  ${c.detail}${c.locked ? '  [LOCKED]' : ''}${c.published ? '  [PUBLISHED]' : ''}`
      );
    }
  }
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
