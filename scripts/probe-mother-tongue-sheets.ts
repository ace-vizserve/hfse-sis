// TEMPORARY, read-only. Delete after running.
//
// What do the Mother Tongue / Filipino / Mandarin grading sheets actually look
// like? Three questions:
//
//   1. AY2025 has 88 MT sheets AND 12 FIL/MANDARIN sheets. Are both graded, or
//      is one set empty? If MT is the graded one, the languages are the
//      display detail; if the languages are graded, MT is the grouping.
//   2. AY2026 has 41 FIL/MANDARIN sheets and NO MT sheet. So the current year
//      grades the languages directly.
//   3. Which sections, so the answer can be checked on a real screen.
//
// Run: npx tsx --env-file=.env.local scripts/probe-mother-tongue-sheets.ts
import { createServiceClient } from '../lib/supabase/service';

async function main() {
  const service = createServiceClient();

  const { data: years } = await service
    .from('academic_years')
    .select('id, ay_code, is_current');
  const ayById = new Map(
    (
      (years ?? []) as { id: string; ay_code: string; is_current: boolean }[]
    ).map((y) => [y.id, y.ay_code])
  );

  const { data: subjects } = await service
    .from('subjects')
    .select('id, code, name, report_label')
    .in('code', ['FIL', 'MANDARIN', 'MT']);
  const subs = (subjects ?? []) as {
    id: string;
    code: string;
    name: string;
    report_label: string | null;
  }[];
  const codeById = new Map(subs.map((s) => [s.id, s.code]));

  const { data: sheets } = await service
    .from('grading_sheets')
    .select(
      'id, subject_id, term_id, is_locked, teacher_name, section:sections!inner(name, academic_year_id, level:levels(code))'
    )
    .in(
      'subject_id',
      subs.map((s) => s.id)
    );

  type SheetRow = {
    id: string;
    subject_id: string;
    is_locked: boolean;
    teacher_name: string | null;
    section: {
      name: string;
      academic_year_id: string;
      level: { code: string } | { code: string }[] | null;
    };
  };
  const rows = ((sheets ?? []) as unknown as SheetRow[]).map((r) => {
    const sec = Array.isArray(r.section) ? r.section[0] : r.section;
    const lvl = Array.isArray(sec.level) ? sec.level[0] : sec.level;
    return {
      id: r.id,
      code: codeById.get(r.subject_id) ?? '?',
      ay: ayById.get(sec.academic_year_id) ?? '?',
      section: `${lvl?.code ?? '?'} ${sec.name}`,
      locked: r.is_locked,
      teacher: r.teacher_name,
    };
  });

  // How many entries carry a real mark, per sheet?
  const { data: entries } = await service
    .from('grade_entries')
    .select('grading_sheet_id, quarterly_grade, letter_grade, is_na')
    .in(
      'grading_sheet_id',
      rows.map((r) => r.id)
    );
  const marked = new Map<string, number>();
  const total = new Map<string, number>();
  for (const e of (entries ?? []) as {
    grading_sheet_id: string;
    quarterly_grade: number | null;
    letter_grade: string | null;
    is_na: boolean | null;
  }[]) {
    total.set(e.grading_sheet_id, (total.get(e.grading_sheet_id) ?? 0) + 1);
    const has =
      e.quarterly_grade != null ||
      (e.letter_grade != null && e.letter_grade !== 'NA') ||
      e.is_na === true;
    if (has)
      marked.set(e.grading_sheet_id, (marked.get(e.grading_sheet_id) ?? 0) + 1);
  }

  console.log('── per (code, AY): sheets, and how many hold any mark ──');
  const group = new Map<string, { sheets: number; withMarks: number }>();
  for (const r of rows) {
    const k = `${r.code} · ${r.ay}`;
    const g = group.get(k) ?? { sheets: 0, withMarks: 0 };
    g.sheets++;
    if ((marked.get(r.id) ?? 0) > 0) g.withMarks++;
    group.set(k, g);
  }
  for (const [k, g] of [...group].sort())
    console.log(
      `  ${k.padEnd(20)} sheets=${g.sheets} withMarks=${g.withMarks}`
    );

  console.log('\n── AY2026 sections holding a language sheet ──');
  const seen = new Set<string>();
  for (const r of rows.filter((r) => r.ay === 'AY2026').sort()) {
    const key = `${r.section} · ${r.code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(
      `  ${key.padEnd(40)} marks=${marked.get(r.id) ?? 0}/${total.get(r.id) ?? 0} teacher=${r.teacher ?? '-'}`
    );
  }

  console.log('\n── the three subjects as the catalogue holds them ──');
  for (const s of subs)
    console.log(
      `  ${s.code.padEnd(9)} name="${s.name}" report_label=${s.report_label ? `"${s.report_label}"` : 'null'}`
    );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
