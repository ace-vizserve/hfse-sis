// scripts/backfill/gen-merge-duplicate-students.ts
// Generates the SQL that merges children who exist twice — once under an
// AY2025 student number, once under an AY2026 one. Emits SQL for review;
// writes nothing itself.
//
// WHICH RECORD SURVIVES, AND WHY
// The AY2026 record survives. It is the one `ay2026_enrolment_applications`
// points at, so keeping it leaves the Admissions <-> Records link (currently
// 406/406 clean) untouched, and leaves this year's grades, attendance and
// parent access working exactly as they do now. Keeping the older record
// instead would break the admissions join for every merged child.
//
// WHAT MOVES
// Eight tables reference students(id). All eight are repointed:
//   section_students, report_card_comments, evaluation_writeups,
//   evaluation_subject_comments, evaluation_checklist_responses,
//   evaluation_ptc_feedback, student_discipline_records, student_declarations
// Grades and attendance need no statement of their own — they hang off
// `section_students.id`, which does not change; repointing that row's
// `student_id` carries the whole year's history with it.
//
// TWO FILES, ON PURPOSE
//   01 repoints everything and is safe to stop after — the old rows are left
//      in place, orphaned but harmless, and the app immediately shows last
//      year's history against this year's child.
//   02 deletes the now-orphaned student rows. Run it only once 01 has been
//      eyeballed in the app. It also trims the one student number that has a
//      trailing space, which can only happen after its duplicate is gone.
//
// Run: npx tsx --env-file=.env.local scripts/backfill/gen-merge-duplicate-students.ts
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createServiceClient } from '../../lib/supabase/service';
import { sqlString } from '../../lib/sis/backfill/enrollment/sql-escape';

const APPLY_DIR = 'scripts/backfill/merge-duplicate-students-apply';

// Every table with a foreign key to students(id).
const STUDENT_FK_TABLES = [
  'section_students',
  'report_card_comments',
  'evaluation_writeups',
  'evaluation_subject_comments',
  'evaluation_checklist_responses',
  'evaluation_ptc_feedback',
  'student_discipline_records',
  'student_declarations',
];

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

async function page<T>(
  svc: any,
  table: string,
  select: string,
  build?: (q: any) => any
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    let q = svc
      .from(table)
      .select(select)
      .range(from, from + 999);
    if (build) q = build(q);
    const { data, error } = await q;
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

async function main() {
  const svc = createServiceClient();

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
    oldWhere: string;
    keepId: string;
    keepNumber: string;
    keepWhere: string;
  }
  const pairs: Pair[] = [];
  for (const [k, byAy] of byName) {
    const a = byAy.get('AY2025')?.[0];
    const b = byAy.get('AY2026')?.[0];
    if (!a || !b) continue;
    if (a.students.id === b.students.id) continue; // already one record
    pairs.push({
      name: k.split('|').reverse().join(' ').trim(),
      oldId: a.students.id,
      oldNumber: a.students.student_number,
      oldWhere: `AY2025 ${a.sections.levels.code} ${a.sections.name} #${a.index_number}`,
      keepId: b.students.id,
      keepNumber: b.students.student_number,
      keepWhere: `AY2026 ${b.sections.levels.code} ${b.sections.name} #${b.index_number}`,
    });
  }
  pairs.sort((x, y) => x.name.localeCompare(y.name));

  // safety: a surviving id must never itself be an old id
  const keepIds = new Set(pairs.map((p) => p.keepId));
  for (const p of pairs)
    if (keepIds.has(p.oldId))
      throw new Error(
        `chain detected: ${p.name}'s old record ${p.oldId} is another pair's survivor — resolve by hand`
      );
  const oldIds = new Set(pairs.map((p) => p.oldId));
  if (oldIds.size !== pairs.length)
    throw new Error(
      'the same old record appears in two pairs — resolve by hand'
    );

  // count what actually moves, per table
  const counts = new Map<string, number>();
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
    counts.set(t, n);
  }

  const idList = pairs.map((p) => `${sqlString(p.oldId)}::uuid`).join(', ');

  // ---------------- file 01 ----------------
  const a: string[] = [];
  a.push('-- Merge duplicate student records — STEP 1 of 2: repoint');
  a.push('--');
  a.push(
    `-- ${pairs.length} children exist twice: one record carries their AY2025`
  );
  a.push(
    '-- history, another carries AY2026. studentNumber is the only thing that'
  );
  a.push(
    '-- links a child across years (Hard Rule #4), so today last year does not'
  );
  a.push('-- follow them.');
  a.push('--');
  a.push(
    '-- The AY2026 record survives — it is the one admissions points at, so'
  );
  a.push(
    '-- nothing about this year changes. Every table that names a student is'
  );
  a.push(
    '-- repointed at it. Grades and attendance need no statement: they hang off'
  );
  a.push(
    '-- section_students.id, which is untouched, so the whole year moves with it.'
  );
  a.push('--');
  a.push(
    '-- Safe to stop after this file. The old student rows are left in place,'
  );
  a.push('-- orphaned but harmless. File 02 removes them.');
  a.push(
    '-- Safe to re-run: every statement matches on the old id, which no longer'
  );
  a.push('-- matches anything once it has run.');
  a.push('--');
  a.push('-- Rows that move:');
  for (const [t, n] of counts) a.push(`--   ${t.padEnd(34)} ${n}`);
  a.push('--');
  for (const p of pairs) {
    a.push(`--   ${p.name}`);
    a.push(`--     keep ${p.keepNumber} (${p.keepWhere})`);
    a.push(`--     move ${p.oldNumber} (${p.oldWhere})`);
  }
  a.push('');
  a.push('begin;');
  a.push('');
  a.push('drop table if exists _merge_pairs;');
  a.push('create temp table _merge_pairs (old_id uuid, keep_id uuid) as');
  a.push('values');
  // The name goes on its own line ABOVE the row. Trailing it after the row
  // would swallow the comma that separates VALUES entries.
  a.push(
    pairs
      .map(
        (p) =>
          `  -- ${p.name}\n  (${sqlString(p.oldId)}::uuid, ${sqlString(p.keepId)}::uuid)`
      )
      .join(',\n') + ';'
  );
  a.push('');
  a.push('-- guard: refuse to run if any survivor has gone missing');
  a.push('do $$');
  a.push('declare missing int;');
  a.push('begin');
  a.push(
    '  select count(*) into missing from _merge_pairs m where not exists (select 1 from students s where s.id = m.keep_id);'
  );
  a.push(
    "  if missing > 0 then raise exception 'the surviving record is missing for % pair(s)', missing; end if;"
  );
  a.push(
    '  select count(*) into missing from _merge_pairs m where not exists (select 1 from students s where s.id = m.old_id);'
  );
  a.push(
    "  if missing > 0 then raise notice '% pair(s) already merged - nothing to move for them', missing; end if;"
  );
  a.push('end $$;');
  a.push('');
  for (const t of STUDENT_FK_TABLES) {
    a.push(`-- ${t} (${counts.get(t)} rows)`);
    a.push(`update ${t} t`);
    a.push('set student_id = m.keep_id');
    a.push('from _merge_pairs m');
    a.push('where t.student_id = m.old_id;');
    a.push('');
  }
  a.push('commit;');
  a.push('');
  a.push('-- === verification (read-only) ===');
  a.push('-- every merged child should now show both years under one record');
  a.push(
    'select s.student_number, s.last_name, s.first_name, ay.ay_code, l.code, sec.name, ss.index_number'
  );
  a.push('from section_students ss');
  a.push('join students s on s.id = ss.student_id');
  a.push('join sections sec on sec.id = ss.section_id');
  a.push('join levels l on l.id = sec.level_id');
  a.push('join academic_years ay on ay.id = sec.academic_year_id');
  a.push(
    `where s.id in (${pairs.map((p) => `${sqlString(p.keepId)}::uuid`).join(', ')})`
  );
  a.push('order by s.last_name, s.first_name, ay.ay_code;');
  a.push('');
  a.push('-- should return 0 rows: nothing still points at an old record');
  a.push(
    STUDENT_FK_TABLES.map(
      (t) =>
        `select '${t}' as tbl, count(*) from ${t} where student_id in (${idList})`
    ).join('\nunion all\n') + ';'
  );

  // ---------------- file 02 ----------------
  const b: string[] = [];
  b.push(
    '-- Merge duplicate student records — STEP 2 of 2: remove the leftovers'
  );
  b.push('--');
  b.push(
    '-- Run ONLY after file 01, and only once the merged children look right'
  );
  b.push(
    '-- in the app. This deletes the old student rows, which are orphaned by'
  );
  b.push('-- then. Their numbers are listed here so the trail survives:');
  b.push('--');
  for (const p of pairs)
    b.push(
      `--   ${p.name.padEnd(36)} removed ${p.oldNumber}, kept ${p.keepNumber}`
    );
  b.push('--');
  b.push('begin;');
  b.push('');
  // One DO block: a single declare/begin/end, with every check inside it.
  b.push('-- refuse to delete anything still referenced');
  b.push('do $$');
  b.push('declare n int;');
  b.push('begin');
  for (const t of STUDENT_FK_TABLES) {
    b.push(
      `  select count(*) into n from ${t} where student_id in (${idList});`
    );
    b.push(
      `  if n > 0 then raise exception '${t} still has % row(s) on an old record - run file 01 first', n; end if;`
    );
  }
  b.push('end $$;');
  b.push('');
  b.push(`delete from students where id in (${idList});`);
  b.push('');

  // the trailing-space number, fixable only once its duplicate is gone
  const spaced = pairs.filter((p) => p.keepNumber !== p.keepNumber.trim());
  if (spaced.length) {
    b.push(
      '-- student numbers stored with a trailing space. These could not be'
    );
    b.push(
      '-- tidied earlier: trimming would have collided with the duplicate.'
    );
    for (const p of spaced) {
      b.push(`-- ${p.name}: "${p.keepNumber}" -> "${p.keepNumber.trim()}"`);
      b.push(
        `update students set student_number = ${sqlString(p.keepNumber.trim())}, updated_at = now() where id = ${sqlString(p.keepId)}::uuid;`
      );
    }
    b.push('');
  }
  b.push('commit;');
  b.push('');
  b.push('-- === verification (read-only) ===');
  b.push(
    'select count(*) as leftover_old_records from students where id in (' +
      idList +
      ');'
  );
  b.push('-- expect 0');
  b.push(
    'select count(*) as untrimmed_numbers from students where student_number <> btrim(student_number);'
  );
  b.push('-- expect 0');

  rmSync(APPLY_DIR, { recursive: true, force: true });
  mkdirSync(APPLY_DIR, { recursive: true });
  writeFileSync(join(APPLY_DIR, '01-repoint.sql'), a.join('\n') + '\n');
  writeFileSync(
    join(APPLY_DIR, '02-remove-leftovers.sql'),
    b.join('\n') + '\n'
  );

  console.log(`${pairs.length} pairs to merge`);
  for (const [t, n] of counts) console.log(`  ${t.padEnd(34)} ${n} rows move`);
  console.log('');
  for (const p of pairs)
    console.log(
      `  ${p.name.padEnd(36)} ${p.oldNumber.padEnd(10)} -> ${p.keepNumber}    (${p.oldWhere}  +  ${p.keepWhere})`
    );
  console.log(
    `\nWrote ${APPLY_DIR}/01-repoint.sql and 02-remove-leftovers.sql`
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAILED:', e);
    process.exit(1);
  });
