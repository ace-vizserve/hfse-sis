// scripts/backfill/apply-merge-duplicate-students.ts
// Runs the duplicate-student merge against the database. Re-derives the pairs
// from live data every time rather than trusting ids baked into a generated
// file, so it cannot act on a stale plan.
//
// This is the REPOINT half only (file 01's work). It does not delete anything:
// the old student rows are left behind, orphaned but harmless. Removing them
// is irreversible and stays a separate, deliberate step.
//
//   dry run (default):  npx tsx --env-file=.env.local scripts/backfill/apply-merge-duplicate-students.ts
//   for real:           npx tsx --env-file=.env.local scripts/backfill/apply-merge-duplicate-students.ts --apply
import { createServiceClient } from '../../lib/supabase/service';

const APPLY = process.argv.includes('--apply');

// Every table whose migration declares a foreign key to students(id).
// `report_card_comments` is on that list in migration 001 but was dropped by
// migration 024 — its job passed to evaluation_writeups (018). Listing a table
// from migration source is therefore not proof it exists, so the run checks
// each one against the live database before touching anything.
const CANDIDATE_FK_TABLES = [
  'section_students',
  'report_card_comments',
  'evaluation_writeups',
  'evaluation_subject_comments',
  'evaluation_checklist_responses',
  'evaluation_ptc_feedback',
  'student_discipline_records',
  'student_declarations',
];

const MISSING_TABLE = '42P01';

async function resolveTables(svc: any): Promise<string[]> {
  const live: string[] = [];
  for (const t of CANDIDATE_FK_TABLES) {
    // A real row fetch, NOT `head: true` with a count — a HEAD request comes
    // back clean for a table that does not exist, which is how a dropped table
    // got through this check the first time.
    const { error } = await svc.from(t).select('student_id').limit(1);
    if (!error) {
      live.push(t);
      continue;
    }
    if (error.code === MISSING_TABLE) {
      console.log(`  ${t}: table no longer exists — skipping`);
      continue;
    }
    throw new Error(
      `cannot read ${t}: ${error.message ?? JSON.stringify(error)}`
    );
  }
  return live;
}

function nameKey(last: string, first: string): string {
  const clean = (s: string) =>
    (s ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .replace(/[^A-Z ]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1)
      .join(' ');
  return `${clean(last)}|${clean(first)}`;
}

async function page<T>(svc: any, table: string, select: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await svc
      .from(table)
      .select(select)
      .range(from, from + 999);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

async function main() {
  const svc = createServiceClient();

  console.log('checking which student-linked tables actually exist...');
  const STUDENT_FK_TABLES = await resolveTables(svc);
  console.log(
    `  ${STUDENT_FK_TABLES.length} live table(s): ${STUDENT_FK_TABLES.join(', ')}\n`
  );

  const { data: years } = await svc
    .from('academic_years')
    .select('id, ay_code');
  const ayById = new Map((years as any[]).map((y) => [y.id, y.ay_code]));

  const placements = await page<any>(
    svc,
    'section_students',
    'id, index_number, students!inner(id, student_number, last_name, first_name), sections!inner(name, academic_year_id, levels!inner(code))'
  );

  const byName = new Map<string, Map<string, any[]>>();
  for (const p of placements) {
    const ay = ayById.get(p.sections.academic_year_id);
    if (!ay) continue;
    const k = nameKey(p.students.last_name, p.students.first_name);
    const m = byName.get(k) ?? new Map<string, any[]>();
    m.set(ay, [...(m.get(ay) ?? []), p]);
    byName.set(k, m);
  }

  interface Pair {
    name: string;
    oldId: string;
    oldNumber: string;
    keepId: string;
    keepNumber: string;
    where: string;
  }
  const pairs: Pair[] = [];
  for (const [k, byAy] of byName) {
    const a = byAy.get('AY2025')?.[0];
    const b = byAy.get('AY2026')?.[0];
    if (!a || !b) continue;
    if (a.students.id === b.students.id) continue;
    pairs.push({
      name: k.split('|').reverse().join(' ').trim(),
      oldId: a.students.id,
      oldNumber: a.students.student_number,
      keepId: b.students.id,
      keepNumber: b.students.student_number,
      where: `AY2025 ${a.sections.levels.code} ${a.sections.name} #${a.index_number} -> AY2026 ${b.sections.levels.code} ${b.sections.name} #${b.index_number}`,
    });
  }
  pairs.sort((x, y) => x.name.localeCompare(y.name));

  console.log(
    `${APPLY ? 'APPLYING' : 'DRY RUN'} — ${pairs.length} pair(s) still unmerged\n`
  );
  if (pairs.length === 0) {
    console.log('nothing to do — already merged');
    return;
  }

  // --- safety checks ---
  const keepIds = new Set(pairs.map((p) => p.keepId));
  const oldIds = pairs.map((p) => p.oldId);
  const problems: string[] = [];
  for (const p of pairs)
    if (keepIds.has(p.oldId))
      problems.push(
        `${p.name}: its old record is another pair's survivor (a chain) — resolve by hand`
      );
  if (new Set(oldIds).size !== oldIds.length)
    problems.push('the same old record appears in two pairs');
  for (const p of pairs)
    if (p.oldId === p.keepId)
      problems.push(`${p.name}: old and survivor are the same row`);
  if (problems.length) {
    console.error('REFUSING TO RUN:');
    problems.forEach((x) => console.error(`  ${x}`));
    process.exit(1);
  }
  console.log('safety checks passed: no chains, no repeats, no self-merges\n');

  // --- what will move ---
  const plan = new Map<string, number>();
  for (const t of STUDENT_FK_TABLES) {
    let n = 0;
    for (const p of pairs) {
      const { count, error } = await svc
        .from(t)
        .select('*', { count: 'exact', head: true })
        .eq('student_id', p.oldId);
      if (error) throw error;
      n += count ?? 0;
    }
    plan.set(t, n);
    console.log(`  ${t.padEnd(34)} ${n} row(s) move`);
  }
  console.log('');
  console.log(
    '  grades and attendance need no move — they hang off section_students.id, which does not change'
  );
  console.log('');

  if (!APPLY) {
    for (const p of pairs)
      console.log(
        `  ${p.name.padEnd(34)} ${p.oldNumber.padEnd(10)} -> ${p.keepNumber}`
      );
    console.log('\nDry run only. Re-run with --apply to write.');
    return;
  }

  // --- apply ---
  const moved = new Map<string, number>();
  for (const p of pairs) {
    for (const t of STUDENT_FK_TABLES) {
      const { data, error } = await svc
        .from(t)
        .update({ student_id: p.keepId })
        .eq('student_id', p.oldId)
        .select('*');
      if (error)
        throw new Error(
          `${t} for ${p.name}: ${error.message ?? JSON.stringify(error)}`
        );
      const n = (data ?? []).length;
      if (n) moved.set(t, (moved.get(t) ?? 0) + n);
    }
    console.log(`  merged ${p.name}  (${p.oldNumber} -> ${p.keepNumber})`);
  }

  console.log('\nrows moved:');
  for (const t of STUDENT_FK_TABLES)
    console.log(`  ${t.padEnd(34)} ${moved.get(t) ?? 0}`);

  // --- verify ---
  console.log('\nverifying nothing still points at an old record...');
  let leftover = 0;
  for (const t of STUDENT_FK_TABLES) {
    for (const p of pairs) {
      const { count, error } = await svc
        .from(t)
        .select('*', { count: 'exact', head: true })
        .eq('student_id', p.oldId);
      if (error) throw error;
      leftover += count ?? 0;
    }
  }
  console.log(`  leftover references: ${leftover} (expect 0)`);

  console.log('\nverifying each merged child now shows both years...');
  let bothYears = 0;
  for (const p of pairs) {
    const { data, error } = await svc
      .from('section_students')
      .select('id, sections!inner(academic_year_id)')
      .eq('student_id', p.keepId);
    if (error) throw error;
    const ays = new Set(
      (data as any[]).map((r) => ayById.get(r.sections.academic_year_id))
    );
    if (ays.has('AY2025') && ays.has('AY2026')) bothYears++;
    else console.log(`  !! ${p.name}: years = ${[...ays].join(', ')}`);
  }
  console.log(
    `  children with both years under one record: ${bothYears} of ${pairs.length}`
  );

  console.log(
    '\nThe old student rows are still present and now unreferenced. Removing them is a separate, irreversible step.'
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAILED:', e);
    process.exit(1);
  });
