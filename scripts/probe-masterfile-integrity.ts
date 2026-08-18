// scripts/probe-masterfile-integrity.ts
//
// Two questions, answered against a live database.
//
//   1. IS THE MASTERFILE LOSING ROWS? `lib/markbook/masterfile.ts` paginates
//      `grade_entries` and `attendance_records` with `.range()` and no
//      `ORDER BY`. PostgREST guarantees no row order without one, so once a
//      single chunk exceeds the 1000-row page size, pages can repeat rows and
//      skip others — silently, as a plausible smaller number. The same defect
//      was measured in the Academic Overview loader on 2026-08-17: 4,640
//      AY2026 grade entries came back as 3,534 distinct keys unordered.
//      Here we re-run each read three ways per level — an exact COUNT, the
//      unordered walk, and the ordered walk — and compare.
//
//   2. WHAT IS ACTUALLY IN THE DATA that the Attendance Summary and Awards
//      pages are meant to show? Both were designed against a schema, not
//      against production. Before adding charts to either, measure whether
//      the things they would chart exist at all: excused days, award tiers,
//      general averages, per-term coverage.
//
// STRICTLY READ-ONLY. Every statement below is a SELECT. Nothing is written,
// nothing is recomputed, so it is safe to point at production.
//
// WHAT THIS CANNOT TELL YOU. It reads with the SERVICE client, which bypasses
// row-level security. It proves what the DATA looks like, never what a signed-
// in user can see.
//
// Run:
//   npx tsx --env-file=.env.local scripts/probe-masterfile-integrity.ts
//   npx tsx --env-file=.env.local scripts/probe-masterfile-integrity.ts AY2025
//
// Exit code is always 0 — this reports, it does not judge.
import { createServiceClient } from '../lib/supabase/service';

const PAGE = 1000;

function bar(n: number, max: number, width = 28): string {
  if (max <= 0) return '';
  return '#'.repeat(Math.max(n > 0 ? 1 : 0, Math.round((n / max) * width)));
}

function pct(part: number, total: number): string {
  return total > 0 ? `${((part / total) * 100).toFixed(1)}%` : '—';
}

/** Walk `.range()` to exhaustion, exactly as `fetchAllPages` does. */
async function walk<T>(
  query: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw new Error(JSON.stringify(error));
    const page = data ?? [];
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out;
}

/** Chunked `.in()` — the URL ceiling is ~14.3KB, so ids go in slices. */
async function inChunks<T>(
  ids: string[],
  run: (slice: string[]) => Promise<T[]>,
  size = 150
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += size) {
    out.push(...(await run(ids.slice(i, i + size))));
  }
  return out;
}

/** A `head: true` count query, already filtered by the caller. */
type CountQuery = PromiseLike<{
  count: number | null;
  error: { message: string } | null;
}>;

async function exactCount(query: CountQuery): Promise<number> {
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

// ───────────────────────────────────────────────────────────────────────────

async function main() {
  const ayCode = process.argv[2] ?? null;
  const service = createServiceClient();

  const { data: ayRows } = await service
    .from('academic_years')
    .select('id, ay_code, is_current')
    .order('ay_code', { ascending: false });
  const years = (ayRows ?? []) as {
    id: string;
    ay_code: string;
    is_current: boolean | null;
  }[];
  const ay = ayCode
    ? years.find((y) => y.ay_code === ayCode)
    : (years.find((y) => y.is_current) ?? years[0]);
  if (!ay) {
    console.log(`No academic year found${ayCode ? ` for ${ayCode}` : ''}.`);
    console.log(`Available: ${years.map((y) => y.ay_code).join(', ')}`);
    return;
  }

  console.log('='.repeat(76));
  console.log(`MASTERFILE INTEGRITY + DATA PROBE — ${ay.ay_code}`);
  console.log('='.repeat(76));

  const [{ data: termRows }, { data: levelRows }, { data: sectionRows }] =
    await Promise.all([
      service
        .from('terms')
        .select('id, term_number, label, start_date, end_date')
        .eq('academic_year_id', ay.id)
        .order('term_number'),
      service.from('levels').select('id, code, label, sort_order'),
      service
        .from('sections')
        .select('id, name, level_id')
        .eq('academic_year_id', ay.id)
        .order('id'),
    ]);

  const terms = (termRows ?? []) as {
    id: string;
    term_number: number;
    label: string | null;
    start_date: string | null;
    end_date: string | null;
  }[];
  const levels = (levelRows ?? []) as {
    id: string;
    code: string;
    label: string;
    sort_order: number | null;
  }[];
  const sections = (sectionRows ?? []) as {
    id: string;
    name: string;
    level_id: string | null;
  }[];
  const levelById = new Map(levels.map((l) => [l.id, l]));

  const activeLevels = levels
    .filter((l) => sections.some((s) => s.level_id === l.id))
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  console.log(
    `\n${terms.length} term rows · ${activeLevels.length} levels with classes · ${sections.length} classes`
  );
  console.log(
    `Terms: ${terms.map((t) => `T${t.term_number}${t.end_date ? '' : ' (no end date)'}`).join(', ') || 'none'}`
  );

  // ── 1. THE PAGINATION QUESTION ──────────────────────────────────────────
  console.log(`\n${'-'.repeat(76)}`);
  console.log('1. UNORDERED PAGINATION — does the masterfile lose rows?');
  console.log('-'.repeat(76));
  console.log(
    'Per level, three reads of the same filter: exact COUNT, the unordered'
  );
  console.log(
    'walk masterfile.ts performs today, and the same walk with .order("id").\n'
  );
  console.log(
    'Level             Rows  Pages  Unordered  distinct   Ordered  distinct  Verdict'
  );

  let anyLoss = false;
  const perLevel: {
    level: string;
    rows: number;
    unorderedDistinct: number;
    orderedDistinct: number;
  }[] = [];

  for (const level of activeLevels) {
    const levelSectionIds = sections
      .filter((s) => s.level_id === level.id)
      .map((s) => s.id);
    if (levelSectionIds.length === 0) continue;

    const enrolments = await inChunks(levelSectionIds, (slice) =>
      walk<{ id: string }>((from, to) =>
        service
          .from('section_students')
          .select('id')
          .in('section_id', slice)
          .order('id')
          .range(from, to)
      )
    );
    const enrolmentIds = enrolments.map((e) => e.id);

    const sheets = await inChunks(levelSectionIds, (slice) =>
      walk<{ id: string }>((from, to) =>
        service
          .from('grading_sheets')
          .select('id')
          .in('section_id', slice)
          .order('id')
          .range(from, to)
      )
    );
    const sheetIds = sheets.map((s) => s.id);
    if (sheetIds.length === 0 || enrolmentIds.length === 0) continue;

    // masterfile.ts puts BOTH `.in()` filters in one request, so mirror that.
    const truth = await exactCount(
      service
        .from('grade_entries')
        .select('*', { count: 'exact', head: true })
        .in('grading_sheet_id', sheetIds)
        .in('section_student_id', enrolmentIds)
    );

    type Row = { grading_sheet_id: string; section_student_id: string };
    const key = (r: Row) => `${r.grading_sheet_id}|${r.section_student_id}`;

    const unordered = await walk<Row>((from, to) =>
      service
        .from('grade_entries')
        .select('grading_sheet_id, section_student_id')
        .in('grading_sheet_id', sheetIds)
        .in('section_student_id', enrolmentIds)
        .range(from, to)
    );
    const ordered = await walk<Row>((from, to) =>
      service
        .from('grade_entries')
        .select('grading_sheet_id, section_student_id')
        .in('grading_sheet_id', sheetIds)
        .in('section_student_id', enrolmentIds)
        .order('id')
        .range(from, to)
    );

    const uDistinct = new Set(unordered.map(key)).size;
    const oDistinct = new Set(ordered.map(key)).size;
    const pages = Math.ceil(truth / PAGE);
    const lost = truth - uDistinct;
    if (lost > 0) anyLoss = true;

    perLevel.push({
      level: level.label,
      rows: truth,
      unorderedDistinct: uDistinct,
      orderedDistinct: oDistinct,
    });

    const verdict =
      pages <= 1
        ? 'single page — cannot bite'
        : lost > 0
          ? `LOSES ${lost} (${pct(lost, truth)})`
          : 'clean this run';

    console.log(
      `${level.label.padEnd(17)}${String(truth).padStart(5)}${String(pages).padStart(7)}` +
        `${String(unordered.length).padStart(11)}${String(uDistinct).padStart(10)}` +
        `${String(ordered.length).padStart(10)}${String(oDistinct).padStart(10)}  ${verdict}`
    );
  }

  const multiPage = perLevel.filter((p) => p.rows > PAGE);
  console.log(
    `\n  ${multiPage.length} of ${perLevel.length} levels exceed the ${PAGE}-row page, so only those can be affected.`
  );
  console.log(
    anyLoss
      ? '  >> ROWS ARE BEING LOST TODAY. The unordered walk is not safe.'
      : '  >> No loss observed in THIS run. Note that an unordered query has no' +
          '\n     guarantee either way — Postgres happened to return a stable order.' +
          '\n     A clean run is not a fix; the ordering is still missing.'
  );

  // Attendance rollups — the same read, far fewer rows.
  const allEnrolments = await inChunks(
    sections.map((s) => s.id),
    (slice) =>
      walk<{ id: string; section_id: string }>((from, to) =>
        service
          .from('section_students')
          .select('id, section_id')
          .in('section_id', slice)
          .order('id')
          .range(from, to)
      )
  );
  const attCount = await inChunks(
    allEnrolments.map((e) => e.id),
    async (slice) => {
      const n = await exactCount(
        service
          .from('attendance_records')
          .select('*', { count: 'exact', head: true })
          .in('section_student_id', slice)
      );
      return [n];
    }
  );
  const attTotal = attCount.reduce((a, b) => a + b, 0);
  console.log(
    `\n  attendance_records for the whole year: ${attTotal} rows across ${allEnrolments.length} enrolments.`
  );
  console.log(
    `  masterfile.ts reads these per LEVEL, so a level would need >${PAGE} rows to be at risk.`
  );

  // ── 2. WHAT IS IN THE DATA ──────────────────────────────────────────────
  console.log(`\n${'-'.repeat(76)}`);
  console.log('2. ATTENDANCE — what the Attendance Summary could show');
  console.log('-'.repeat(76));

  type Att = {
    section_student_id: string;
    term_id: string;
    school_days: number | null;
    days_present: number | null;
    days_late: number | null;
    days_excused: number | null;
    days_absent: number | null;
  };
  const att = await inChunks(
    allEnrolments.map((e) => e.id),
    (slice) =>
      walk<Att>((from, to) =>
        service
          .from('attendance_records')
          .select(
            'section_student_id, term_id, school_days, days_present, days_late, days_excused, days_absent'
          )
          .in('section_student_id', slice)
          .order('section_student_id')
          .range(from, to)
      )
  );

  const sumOf = (f: (r: Att) => number | null) =>
    att.reduce((a, r) => a + (f(r) ?? 0), 0);
  const days = sumOf((r) => r.school_days);
  const present = sumOf((r) => r.days_present);
  const late = sumOf((r) => r.days_late);
  const excused = sumOf((r) => r.days_excused);
  const absent = sumOf((r) => r.days_absent);

  console.log(`  ${att.length} rollup rows`);
  console.log(`  school_days   ${days}`);
  console.log(`  days_present  ${present}  (${pct(present, days)})`);
  console.log(`  days_late     ${late}  (${pct(late, days)})`);
  console.log(
    `  days_excused  ${excused}  (${pct(excused, days)})   <-- the masterfile never reads this column`
  );
  console.log(`  days_absent   ${absent}  (${pct(absent, days)})`);
  console.log(
    `  onTime        ${present - late - excused}  (present - late - excused)`
  );

  const excusedRows = att.filter((r) => (r.days_excused ?? 0) > 0);
  console.log(
    `\n  ${excusedRows.length} of ${att.length} rollups carry at least one excused day` +
      ` (${pct(excusedRows.length, att.length)}).`
  );
  console.log(
    excusedRows.length === 0
      ? '  >> Nothing is marked EX. An excused/unexcused split would be an empty column.'
      : '  >> Excused days exist and are invisible on every masterfile-fed surface.'
  );

  // Per-student rate distribution — is the 95/85 banding meaningful?
  const byStudent = new Map<string, { d: number; p: number }>();
  for (const r of att) {
    const slot = byStudent.get(r.section_student_id) ?? { d: 0, p: 0 };
    slot.d += r.school_days ?? 0;
    slot.p += r.days_present ?? 0;
    byStudent.set(r.section_student_id, slot);
  }
  const rates = [...byStudent.values()]
    .filter((s) => s.d > 0)
    .map((s) => (s.p / s.d) * 100);
  rates.sort((a, b) => a - b);

  const buckets: { label: string; test: (r: number) => boolean }[] = [
    { label: '100%', test: (r) => r >= 99.995 },
    { label: '97–99.9%', test: (r) => r >= 97 && r < 99.995 },
    { label: '95–96.9%', test: (r) => r >= 95 && r < 97 },
    { label: '90–94.9%', test: (r) => r >= 90 && r < 95 },
    { label: '85–89.9%', test: (r) => r >= 85 && r < 90 },
    { label: '80–84.9%', test: (r) => r >= 80 && r < 85 },
    { label: 'below 80%', test: (r) => r < 80 },
  ];
  const counts = buckets.map((b) => rates.filter((r) => b.test(r)).length);
  const widest = Math.max(...counts, 1);
  console.log(`\n  Per-student attendance rate, ${rates.length} students:`);
  buckets.forEach((b, i) => {
    console.log(
      `    ${b.label.padEnd(11)}${String(counts[i]).padStart(4)}  ${bar(counts[i], widest)}`
    );
  });
  if (rates.length > 0) {
    const at = (q: number) => rates[Math.floor((rates.length - 1) * q)];
    console.log(
      `    min ${rates[0].toFixed(1)}%  p10 ${at(0.1).toFixed(1)}%  median ${at(0.5).toFixed(1)}%  max ${rates[rates.length - 1].toFixed(1)}%`
    );
  }
  console.log(
    `\n  Thresholds in use across the app: 95/85 (this page), 90 (Classroom, Academic Summary).`
  );
  buckets.forEach(() => {});
  for (const cut of [95, 90, 85, 80]) {
    const n = rates.filter((r) => r < cut).length;
    console.log(
      `    below ${cut}%: ${String(n).padStart(4)}  (${pct(n, rates.length)})`
    );
  }

  // Per-term coverage — can a trend be drawn?
  console.log(`\n  Rollups per term (a trend needs at least two):`);
  for (const t of terms) {
    const forTerm = att.filter((r) => r.term_id === t.id);
    const d = forTerm.reduce((a, r) => a + (r.school_days ?? 0), 0);
    const p = forTerm.reduce((a, r) => a + (r.days_present ?? 0), 0);
    console.log(
      `    T${t.term_number}  ${String(forTerm.length).padStart(4)} rollups  ${String(d).padStart(6)} days  rate ${d > 0 ? ((p / d) * 100).toFixed(1) + '%' : '—'}`
    );
  }

  // ── 3. AWARDS ───────────────────────────────────────────────────────────
  console.log(`\n${'-'.repeat(76)}`);
  console.log('3. AWARDS — what the Awards page could show');
  console.log('-'.repeat(76));

  type ConfigRow = {
    subject_award_bronze_min: number | null;
    subject_award_silver_min: number | null;
    subject_award_gold_min: number | null;
  };
  const { data: cfgRow } = await service
    .from('school_config')
    .select(
      'subject_award_bronze_min, subject_award_silver_min, subject_award_gold_min'
    )
    .limit(1)
    .maybeSingle();
  const cfg = cfgRow as ConfigRow | null;
  const thresholds = {
    bronze: cfg?.subject_award_bronze_min ?? 88.5,
    silver: cfg?.subject_award_silver_min ?? 91.5,
    gold: cfg?.subject_award_gold_min ?? 95.5,
  };
  console.log(
    `  Thresholds — Bronze >= ${thresholds.bronze} · Silver >= ${thresholds.silver} · Gold >= ${thresholds.gold}`
  );

  const { data: subjRows } = await service
    .from('subjects')
    .select('id, name, is_examinable');
  const subjects = (subjRows ?? []) as {
    id: string;
    name: string;
    is_examinable: boolean | null;
  }[];
  const examinable = new Set(
    subjects.filter((s) => s.is_examinable === true).map((s) => s.id)
  );

  const allSheets = await inChunks(
    sections.map((s) => s.id),
    (slice) =>
      walk<{
        id: string;
        term_id: string;
        subject_id: string;
        section_id: string;
      }>((from, to) =>
        service
          .from('grading_sheets')
          .select('id, term_id, subject_id, section_id')
          .in('section_id', slice)
          .order('id')
          .range(from, to)
      )
  );
  const sheetById = new Map(allSheets.map((s) => [s.id, s]));

  const entries = await inChunks(
    allSheets.map((s) => s.id),
    (slice) =>
      walk<{
        grading_sheet_id: string;
        section_student_id: string;
        quarterly_grade: number | null;
        is_na: boolean | null;
      }>((from, to) =>
        service
          .from('grade_entries')
          .select(
            'grading_sheet_id, section_student_id, quarterly_grade, is_na'
          )
          .in('grading_sheet_id', slice)
          .order('id')
          .range(from, to)
      )
  );

  // Subject Overall = mean of a student's quarterly grades in that subject
  // across ALL FOUR terms. Anything short of four is not an award period.
  const perStudentSubject = new Map<
    string,
    { sum: number; terms: Set<number> }
  >();
  for (const e of entries) {
    const sheet = sheetById.get(e.grading_sheet_id);
    if (!sheet || !examinable.has(sheet.subject_id)) continue;
    if (e.is_na === true || e.quarterly_grade == null) continue;
    const term = terms.find((t) => t.id === sheet.term_id);
    if (!term) continue;
    const k = `${e.section_student_id}|${sheet.subject_id}`;
    const slot = perStudentSubject.get(k) ?? { sum: 0, terms: new Set() };
    slot.sum += e.quarterly_grade;
    slot.terms.add(term.term_number);
    perStudentSubject.set(k, slot);
  }

  const termCountHisto = new Map<number, number>();
  for (const [, v] of perStudentSubject) {
    termCountHisto.set(
      v.terms.size,
      (termCountHisto.get(v.terms.size) ?? 0) + 1
    );
  }
  console.log(
    `\n  ${perStudentSubject.size} (student x examinable subject) pairs have marks.`
  );
  console.log('  Terms marked per pair — a Subject Overall needs all four:');
  for (const n of [1, 2, 3, 4]) {
    const c = termCountHisto.get(n) ?? 0;
    console.log(
      `    ${n} term${n === 1 ? ' ' : 's'}  ${String(c).padStart(5)}  ${bar(c, perStudentSubject.size || 1)}`
    );
  }
  const complete = termCountHisto.get(4) ?? 0;
  console.log(
    complete === 0
      ? '  >> NOT ONE pair has four terms. Every Subject Overall is null, so every\n' +
          '     award tier on the page is "Not eligible" and the donut is one slice.'
      : `  >> ${complete} pairs are complete and can carry a tier.`
  );

  // What a General Average would look like IF the year were complete — using
  // the marks that exist, so the shape of the distribution is visible.
  const provisional = new Map<string, number[]>();
  for (const [k, v] of perStudentSubject) {
    const [enrolmentId] = k.split('|');
    const mean = v.sum / v.terms.size;
    const arr = provisional.get(enrolmentId) ?? [];
    arr.push(mean);
    provisional.set(enrolmentId, arr);
  }
  const provAverages = [...provisional.values()]
    .filter((a) => a.length > 0)
    .map(
      (a) => Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10
    );
  provAverages.sort((a, b) => b - a);

  const tierOf = (s: number) =>
    s < thresholds.bronze
      ? 'Not eligible'
      : s < thresholds.silver
        ? 'Bronze'
        : s < thresholds.gold
          ? 'Silver'
          : 'Gold';
  const tierCounts = new Map<string, number>();
  for (const s of provAverages)
    tierCounts.set(tierOf(s), (tierCounts.get(tierOf(s)) ?? 0) + 1);

  console.log(
    `\n  PROVISIONAL general average across ${provAverages.length} students,`
  );
  console.log(
    `  computed from the terms that ARE marked (this is not the official award):`
  );
  for (const t of ['Gold', 'Silver', 'Bronze', 'Not eligible']) {
    const c = tierCounts.get(t) ?? 0;
    console.log(
      `    ${t.padEnd(13)}${String(c).padStart(5)}  (${pct(c, provAverages.length)})  ${bar(c, provAverages.length || 1)}`
    );
  }

  // Near-miss: who sits just under a threshold. This is the figure the page
  // has no way to show today, and the only actionable one on it.
  console.log(`\n  Students within 1.0 point BELOW a tier boundary:`);
  for (const [name, cut] of [
    ['Bronze', thresholds.bronze],
    ['Silver', thresholds.silver],
    ['Gold', thresholds.gold],
  ] as const) {
    const near = provAverages.filter((s) => s >= cut - 1 && s < cut).length;
    console.log(`    just under ${name.padEnd(7)} ${String(near).padStart(4)}`);
  }
  if (provAverages.length > 0) {
    console.log(
      `    range ${provAverages[provAverages.length - 1].toFixed(1)} – ${provAverages[0].toFixed(1)}`
    );
  }

  // Per-level tier spread — the comparison the page cannot draw today.
  const enrolmentToLevel = new Map<string, string>();
  const sectionLevel = new Map(sections.map((s) => [s.id, s.level_id ?? '']));
  for (const e of allEnrolments) {
    enrolmentToLevel.set(e.id, sectionLevel.get(e.section_id) ?? '');
  }
  const byLevelTier = new Map<string, Map<string, number>>();
  for (const [enrolmentId, arr] of provisional) {
    if (arr.length === 0) continue;
    const score =
      Math.round((arr.reduce((x, y) => x + y, 0) / arr.length) * 10) / 10;
    const levelId = enrolmentToLevel.get(enrolmentId) ?? '';
    const label = levelById.get(levelId)?.label ?? 'Unknown';
    const m = byLevelTier.get(label) ?? new Map<string, number>();
    m.set(tierOf(score), (m.get(tierOf(score)) ?? 0) + 1);
    byLevelTier.set(label, m);
  }
  console.log(`\n  Provisional tiers by grade level:`);
  console.log(
    `    ${'Level'.padEnd(17)}${'Gold'.padStart(6)}${'Silver'.padStart(8)}${'Bronze'.padStart(8)}${'None'.padStart(7)}`
  );
  for (const level of activeLevels) {
    const m = byLevelTier.get(level.label);
    if (!m) continue;
    console.log(
      `    ${level.label.padEnd(17)}${String(m.get('Gold') ?? 0).padStart(6)}` +
        `${String(m.get('Silver') ?? 0).padStart(8)}${String(m.get('Bronze') ?? 0).padStart(8)}` +
        `${String(m.get('Not eligible') ?? 0).padStart(7)}`
    );
  }

  console.log(`\n${'='.repeat(76)}`);
  console.log('Read-only. Nothing was written.');
  console.log('='.repeat(76));
}

main().catch((e) => {
  console.error('Probe failed:', e);
  process.exit(1);
});
