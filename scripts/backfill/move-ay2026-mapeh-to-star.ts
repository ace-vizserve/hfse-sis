// scripts/backfill/move-ay2026-mapeh-to-star.ts
// Moves AY2026's MAPEH data onto the real STAR subject. AY2025 stays MAPEH.
//
// WHY. Since migration 137 (KD #203) AY2026's "STAR" has been MAPEH with a
// per-year name laid over it: `subject_configs.display_name = 'STAR'` on the
// AY2026 MAPEH config, the subject underneath still code MAPEH. Mr Ace,
// 2026-09-29: STAR REPLACED MAPEH — from AY2026 on the grades must belong to a
// real STAR subject, not MAPEH wearing a name. Miss Joann created that subject
// the same day (code STAR, name "STAR", non-examinable, standard_sheet — the
// same two flags MAPEH carries, which this script checks before it moves
// anything). It had no configs, offerings, sheets or assignments.
//
// WHAT MOVES — every AY2026 row that names MAPEH, repointed to STAR:
//   subject_configs              the one AY2026 MAPEH config: subject_id -> STAR,
//                                display_name -> NULL (it existed only to say
//                                STAR; the subject now says it itself).
//                                report_label is already NULL. `description`
//                                ("Sports, Talent, Arts and Rythm") is KEPT: it
//                                spells out what STAR is, which is still true.
//   subject_level_offerings      AY2026 rows (academic_year_id).
//   grading_sheets               the sheets on that config. They carry
//                                subject_id AS WELL AS subject_config_id, so
//                                both have to agree — the config move alone
//                                would leave subject_id saying MAPEH.
//   teacher_assignments          rows on AY2026 sections. Sheet RLS matches
//                                `ta.subject_id = gs.subject_id`, so these move
//                                straight after the sheets.
//   evaluation_subject_comments  rows on AY2026 terms.
//   evaluation_checklist_items   rows on AY2026 terms.
//   subject_report_map           gains STAR's self-row (STAR -> STAR), like every
//                                other subject. MAPEH's self-row stays for AY2025.
//
// WHAT MOVES WITH THE CONFIG, UNTOUCHED — hangs off an id that does not change:
//   grade_entries (grading_sheet_id), section_subjects (subject_config_id),
//   grade_change_requests / grade_audit_log (grading_sheet_id).
//   ⚠ NO GRADE IS WRITTEN. The grade derive trigger (152/177/178) and the grade
//   audit trigger (165) are on grade_entries only; nothing here updates that
//   table, and no table this script does update carries a trigger. So no grade
//   is recomputed and no grade_audit_log row is written.
//
// WHAT STAYS:
//   Every AY2025 row — config, offerings, sheets, grades, assignments,
//   evaluation rows — stays MAPEH. The script counts them before and after and
//   stops if a single number differs. AY2027 has no config for either subject;
//   any MAPEH row found in another year is REPORTED and NOT moved.
//   History tables are left as written: audit_log / grade_audit_log contexts and
//   subject_weight_reconciliation_log (migration 080's frozen log) record what
//   the subject was called at the time.
//
// NOT SUBJECT REFERENCES, though the column names say "subject":
//   approval_requests.subject_id (the thing being approved, typed by
//   subject_type — a declaration, never a school subject) and the
//   school_config.subject_award_* thresholds.
//
// NO audit_log ROW. This runs with the service role, outside any route, so
// nothing records it but this header. The header is the record.
//
// ONE TRANSACTION? PostgREST cannot span tables in one, and the repo has no
// SQL-exec RPC. So there are two ways to apply, same end state:
//   --apply  writes table by table through the service client, in the order
//            above. Every step selects its rows by the ids the plan listed AND
//            `subject_id = MAPEH`, so it is idempotent: if a step fails, re-run
//            and it picks up only what is left. A partial run is never wrong,
//            only transitional: between the sheet step and the assignment step
//            (milliseconds apart) a STAR teacher cannot open their sheet.
//   --sql    prints the same move as ONE `begin; … commit;` block with the ids
//            resolved, ending in an assertion that raises (and so rolls back) if
//            any AY2026 MAPEH row is left or an AY2025 count moved. Paste it into
//            the Supabase SQL editor for an all-or-nothing apply.
//
// How to run (from the repo root):
//   npx tsx --env-file=.env.local scripts/backfill/move-ay2026-mapeh-to-star.ts          # dry run
//   npx tsx --env-file=.env.local scripts/backfill/move-ay2026-mapeh-to-star.ts --sql    # print SQL
//   npx tsx --env-file=.env.local scripts/backfill/move-ay2026-mapeh-to-star.ts --apply  # write
//
// Code-keyed lists changed with this move (2026-09-29): 'STAR' joined
// MAPEH_FAMILY_CODES (lib/sis/subjects/weight-defaults.ts, the 20/60/20
// default) and the `MAPEH: ['star']` alias left SUBJECT_ALIASES
// (lib/sis/deployment-workbook.ts) — a STAR cell now matches STAR by name.

import { createServiceClient } from '../../lib/supabase/service';

const APPLY = process.argv.includes('--apply');
const PRINT_SQL = process.argv.includes('--sql');
const MOVE_AY = 'AY2026';
const KEEP_AY = 'AY2025';

const sb = createServiceClient();

type Row = Record<string, unknown> & { id: string };

// ── helpers ───────────────────────────────────────────────────────────────

async function fetchAll(
  table: string,
  select: string,
  filter: (q: any) => any
): Promise<Row[]> {
  const out: Row[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await filter(sb.from(table).select(select)).range(
      from,
      from + PAGE - 1
    );
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as Row[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

async function countIn(
  table: string,
  col: string,
  ids: string[]
): Promise<number> {
  let total = 0;
  for (const part of chunk(ids, 100)) {
    const { count, error } = await sb
      .from(table)
      .select('id', { count: 'exact', head: true })
      .in(col, part);
    if (error) throw new Error(`${table}: ${error.message}`);
    total += count ?? 0;
  }
  return total;
}

function fail(msg: string): never {
  console.error(`\n✗ STOP: ${msg}`);
  process.exit(1);
}

// ── the catalog ───────────────────────────────────────────────────────────

type Catalog = {
  mapeh: { id: string; is_examinable: boolean; grading_method: string };
  star: { id: string; is_examinable: boolean; grading_method: string };
  ayCode: Map<string, string>;
  ayId: (code: string) => string;
  termAy: Map<string, string>;
  termLabel: Map<string, string>;
  sectionAy: Map<string, string>;
  sectionLabel: Map<string, string>;
  levelCode: Map<string, string>;
};

async function loadCatalog(): Promise<Catalog> {
  const subjects = await fetchAll(
    'subjects',
    'id, code, name, is_examinable, grading_method',
    (q) => q.in('code', ['MAPEH', 'STAR'])
  );
  const mapeh = subjects.find((s) => s.code === 'MAPEH') as any;
  const star = subjects.find((s) => s.code === 'STAR') as any;
  if (!mapeh) fail('no subject with code MAPEH');
  if (!star) fail('no subject with code STAR');

  const ays = await fetchAll('academic_years', 'id, ay_code', (q) => q);
  const ayCode = new Map(ays.map((a) => [a.id, a.ay_code as string]));
  const ayId = (code: string) => {
    const hit = ays.find((a) => a.ay_code === code);
    if (!hit) fail(`no academic year ${code}`);
    return hit.id;
  };

  const terms = await fetchAll(
    'terms',
    'id, academic_year_id, term_number',
    (q) => q
  );
  const termAy = new Map(
    terms.map((t) => [t.id, ayCode.get(t.academic_year_id as string) ?? '?'])
  );
  const termLabel = new Map(
    terms.map((t) => [
      t.id,
      `${ayCode.get(t.academic_year_id as string)} T${t.term_number}`,
    ])
  );

  const sections = await fetchAll(
    'sections',
    'id, name, academic_year_id, levels(code)',
    (q) => q
  );
  const sectionAy = new Map(
    sections.map((s) => [s.id, ayCode.get(s.academic_year_id as string) ?? '?'])
  );
  const sectionLabel = new Map(
    sections.map((s) => {
      const lv = s.levels as { code: string } | { code: string }[] | null;
      const code = (Array.isArray(lv) ? lv[0] : lv)?.code ?? '??';
      return [s.id, `${code} ${s.name}`];
    })
  );

  const levels = await fetchAll('levels', 'id, code', (q) => q);
  const levelCode = new Map(levels.map((l) => [l.id, l.code as string]));

  return {
    mapeh,
    star,
    ayCode,
    ayId,
    termAy,
    termLabel,
    sectionAy,
    sectionLabel,
    levelCode,
  };
}

// ── one spec per table that carries subject_id ────────────────────────────

type Spec = {
  table: string;
  select: string;
  ayOf: (r: Row) => string;
  /** Unique keys this row occupies with the given subject id — collision check. */
  keys: (r: Row, subjectId: string) => string[];
  describe: (r: Row) => string;
};

function specs(c: Catalog): Spec[] {
  return [
    {
      table: 'subject_configs',
      select:
        'id, academic_year_id, subject_id, display_name, report_label, description',
      ayOf: (r) => c.ayCode.get(r.academic_year_id as string) ?? '?',
      keys: (r, s) => [`${r.academic_year_id}|${s}`],
      describe: (r) =>
        `${c.ayCode.get(r.academic_year_id as string)} display_name=${JSON.stringify(r.display_name)} report_label=${JSON.stringify(r.report_label)} description=${JSON.stringify(r.description)}`,
    },
    {
      table: 'subject_level_offerings',
      select: 'id, academic_year_id, level_id, subject_id',
      ayOf: (r) => c.ayCode.get(r.academic_year_id as string) ?? '?',
      keys: (r, s) => [`${s}|${r.level_id}|${r.academic_year_id}`],
      describe: (r) =>
        `${c.ayCode.get(r.academic_year_id as string)} ${c.levelCode.get(r.level_id as string)}`,
    },
    {
      table: 'grading_sheets',
      select:
        'id, term_id, section_id, subject_id, subject_config_id, is_locked',
      ayOf: (r) => c.termAy.get(r.term_id as string) ?? '?',
      keys: (r, s) => [`${r.term_id}|${r.section_id}|${s}`],
      describe: (r) =>
        `${c.termLabel.get(r.term_id as string)} ${c.sectionLabel.get(r.section_id as string)}${r.is_locked ? ' (locked)' : ''}`,
    },
    {
      table: 'teacher_assignments',
      select: 'id, teacher_user_id, section_id, subject_id, role',
      ayOf: (r) => c.sectionAy.get(r.section_id as string) ?? '?',
      keys: (r, s) => {
        const k = [
          `person|${r.teacher_user_id}|${r.section_id}|${s}|${r.role}`,
        ];
        // migration 118: one subject_teacher per (section, subject)
        if (r.role === 'subject_teacher') k.push(`class|${r.section_id}|${s}`);
        // migration 124: a person once per sheet across subject/co teacher
        if (r.role === 'subject_teacher' || r.role === 'co_teacher')
          k.push(`sheet|${r.teacher_user_id}|${r.section_id}|${s}`);
        return k;
      },
      describe: (r) =>
        `${c.sectionLabel.get(r.section_id as string)} ${r.role}`,
    },
    {
      table: 'evaluation_subject_comments',
      select: 'id, term_id, student_id, section_id, subject_id',
      ayOf: (r) => c.termAy.get(r.term_id as string) ?? '?',
      keys: (r, s) => [`${r.term_id}|${r.student_id}|${s}`],
      describe: (r) =>
        `${c.termLabel.get(r.term_id as string)} ${c.sectionLabel.get(r.section_id as string)}`,
    },
    {
      table: 'evaluation_checklist_items',
      select: 'id, term_id, section_id, subject_id, item_text',
      ayOf: (r) => c.termAy.get(r.term_id as string) ?? '?',
      keys: (r, s) => [`${r.term_id}|${s}|${r.section_id}|${r.item_text}`],
      describe: (r) =>
        `${c.termLabel.get(r.term_id as string)} ${c.sectionLabel.get(r.section_id as string)} "${String(r.item_text).slice(0, 40)}"`,
    },
  ];
}

// ── the snapshot: every MAPEH/STAR row, by table and year ─────────────────

type Snapshot = {
  rows: Map<string, Row[]>; // table -> rows naming MAPEH or STAR
  gradeEntries: Map<string, number>; // `${ay}|${subject}` -> grade_entries under those sheets
  sectionSubjects: Map<string, number>; // config id -> section_subjects rows
  reportMap: Row[];
};

async function snapshot(c: Catalog, ss: Spec[]): Promise<Snapshot> {
  const rows = new Map<string, Row[]>();
  for (const s of ss) {
    rows.set(
      s.table,
      await fetchAll(s.table, s.select, (q) =>
        q.in('subject_id', [c.mapeh.id, c.star.id]).order('id')
      )
    );
  }

  const gradeEntries = new Map<string, number>();
  const sheets = rows.get('grading_sheets')!;
  for (const ay of new Set(
    sheets.map((r) => c.termAy.get(r.term_id as string) ?? '?')
  )) {
    for (const [code, id] of [
      ['MAPEH', c.mapeh.id],
      ['STAR', c.star.id],
    ] as const) {
      const ids = sheets
        .filter(
          (r) => r.subject_id === id && c.termAy.get(r.term_id as string) === ay
        )
        .map((r) => r.id);
      if (ids.length)
        gradeEntries.set(
          `${ay}|${code}`,
          await countIn('grade_entries', 'grading_sheet_id', ids)
        );
    }
  }

  const sectionSubjects = new Map<string, number>();
  for (const cfg of rows.get('subject_configs')!) {
    sectionSubjects.set(
      cfg.id,
      await countIn('section_subjects', 'subject_config_id', [cfg.id])
    );
  }

  const reportMap = await fetchAll(
    'subject_report_map',
    'id, subject_id, report_subject_id',
    (q) =>
      q.or(
        `subject_id.in.(${c.mapeh.id},${c.star.id}),report_subject_id.in.(${c.mapeh.id},${c.star.id})`
      )
  );

  return { rows, gradeEntries, sectionSubjects, reportMap };
}

/** Everything that must read the same after the move: every AY2025 number. */
function keepFingerprint(c: Catalog, snap: Snapshot): string {
  const parts: string[] = [];
  for (const [table, rows] of snap.rows) {
    const kept = rows.filter((r) => tableAy(c, table, r) === KEEP_AY);
    const mapeh = kept
      .filter((r) => r.subject_id === c.mapeh.id)
      .map((r) => r.id)
      .sort();
    const star = kept.filter((r) => r.subject_id === c.star.id).length;
    parts.push(`${table}: MAPEH=${mapeh.length} [${hash(mapeh)}] STAR=${star}`);
  }
  parts.push(
    `grade_entries under ${KEEP_AY} MAPEH sheets: ${snap.gradeEntries.get(`${KEEP_AY}|MAPEH`) ?? 0}`
  );
  parts.push(
    `grade_entries under ${KEEP_AY} STAR sheets: ${snap.gradeEntries.get(`${KEEP_AY}|STAR`) ?? 0}`
  );
  const keepCfg = snap.rows
    .get('subject_configs')!
    .find(
      (r) =>
        tableAy(c, 'subject_configs', r) === KEEP_AY &&
        r.subject_id === c.mapeh.id
    );
  parts.push(
    `section_subjects on ${KEEP_AY} MAPEH config: ${keepCfg ? snap.sectionSubjects.get(keepCfg.id) : 'no config'}`
  );
  return parts.join('\n');
}

let SPECS_BY_TABLE = new Map<string, Spec>();
function tableAy(_c: Catalog, table: string, r: Row): string {
  return SPECS_BY_TABLE.get(table)!.ayOf(r);
}

function hash(ids: string[]): string {
  let h = 0;
  for (const ch of ids.join(',')) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return (h >>> 0).toString(16);
}

// ── main ──────────────────────────────────────────────────────────────────

async function main() {
  const c = await loadCatalog();
  const ss = specs(c);
  SPECS_BY_TABLE = new Map(ss.map((s) => [s.table, s]));

  console.log(
    `Mode: ${APPLY ? 'APPLY' : PRINT_SQL ? 'PRINT SQL' : 'DRY RUN (nothing written)'}`
  );
  console.log(
    `MAPEH ${c.mapeh.id}  is_examinable=${c.mapeh.is_examinable} grading_method=${c.mapeh.grading_method}`
  );
  console.log(
    `STAR  ${c.star.id}  is_examinable=${c.star.is_examinable} grading_method=${c.star.grading_method}`
  );

  // A sheet's grade is read against these two flags. If they differed the
  // move would change how every AY2026 STAR grade is read, not just its name.
  if (c.mapeh.is_examinable !== c.star.is_examinable)
    fail(
      'STAR and MAPEH differ on is_examinable — the move would change how the grades are read'
    );
  if (c.mapeh.grading_method !== c.star.grading_method)
    fail(
      'STAR and MAPEH differ on grading_method — the move would change how the grades are read'
    );

  const before = await snapshot(c, ss);

  // ── per-table plan ──
  const plan = new Map<string, Row[]>(); // table -> rows to repoint
  let problems = 0;
  console.log('\n══ Per table: rows naming MAPEH / STAR, by academic year ══');
  for (const s of ss) {
    const rows = before.rows.get(s.table)!;
    const byAy = new Map<string, { MAPEH: number; STAR: number }>();
    for (const r of rows) {
      const ay = s.ayOf(r);
      const b = byAy.get(ay) ?? { MAPEH: 0, STAR: 0 };
      b[r.subject_id === c.mapeh.id ? 'MAPEH' : 'STAR'] += 1;
      byAy.set(ay, b);
    }
    const move = rows.filter(
      (r) => r.subject_id === c.mapeh.id && s.ayOf(r) === MOVE_AY
    );
    plan.set(s.table, move);

    console.log(`\n── ${s.table}`);
    if (byAy.size === 0) console.log('   (no MAPEH or STAR rows in any year)');
    for (const [ay, n] of [...byAy].sort())
      console.log(`   ${ay}: MAPEH=${n.MAPEH} STAR=${n.STAR}`);
    console.log(
      `   → would repoint ${move.length} ${MOVE_AY} row(s) MAPEH → STAR`
    );
    for (const r of move.slice(0, 5))
      console.log(`     e.g. ${r.id}  ${s.describe(r)}`);
    if (move.length > 5) console.log(`     … and ${move.length - 5} more`);

    // Rows in a year that is neither moved nor kept — reported, never moved.
    for (const [ay, n] of byAy) {
      if (ay !== MOVE_AY && ay !== KEEP_AY && n.MAPEH > 0)
        console.log(
          `   ⚠ ${n.MAPEH} MAPEH row(s) in ${ay} — NOT moved (only ${MOVE_AY} moves)`
        );
      if (ay !== MOVE_AY && n.STAR > 0) {
        console.log(
          `   ✗ ${n.STAR} STAR row(s) in ${ay} — STAR was meant to be unused outside ${MOVE_AY}`
        );
        problems++;
      }
    }

    // Unique-key collisions against rows STAR already holds.
    const held = new Set(
      rows
        .filter((r) => r.subject_id === c.star.id)
        .flatMap((r) => s.keys(r, c.star.id))
    );
    const collide = move.filter((r) =>
      s.keys(r, c.star.id).some((k) => held.has(k))
    );
    if (collide.length) {
      console.log(
        `   ✗ ${collide.length} row(s) would collide with an existing STAR row on a unique key`
      );
      problems++;
    }
  }

  // ── the config, and the sheets that must follow it ──
  const cfgs = plan.get('subject_configs')!;
  const starCfg26 = before.rows
    .get('subject_configs')!
    .find(
      (r) =>
        r.subject_id === c.star.id &&
        c.ayCode.get(r.academic_year_id as string) === MOVE_AY
    );
  const cfg = cfgs[0] ?? starCfg26;
  if (cfgs.length > 1)
    fail(`${cfgs.length} ${MOVE_AY} MAPEH configs — expected one`);
  if (!cfg) fail(`no ${MOVE_AY} config for MAPEH or STAR`);
  const sheets = before.rows.get('grading_sheets')!;
  const onCfgWrongYear = sheets.filter(
    (r) =>
      r.subject_config_id === cfg.id &&
      c.termAy.get(r.term_id as string) !== MOVE_AY
  );
  if (onCfgWrongYear.length) {
    console.log(
      `\n✗ ${onCfgWrongYear.length} sheet(s) outside ${MOVE_AY} point at the ${MOVE_AY} config`
    );
    problems++;
  }
  const movingSheetsOffCfg = plan
    .get('grading_sheets')!
    .filter((r) => r.subject_config_id !== cfg.id);
  if (movingSheetsOffCfg.length) {
    console.log(
      `\n✗ ${movingSheetsOffCfg.length} ${MOVE_AY} MAPEH sheet(s) point at a different config`
    );
    problems++;
  }

  console.log('\n══ Moves with the config / sheets, untouched ══');
  console.log(
    `   section_subjects on the ${MOVE_AY} config: ${before.sectionSubjects.get(cfg.id) ?? 0}`
  );
  console.log(
    `   grade_entries under ${MOVE_AY} MAPEH sheets: ${before.gradeEntries.get(`${MOVE_AY}|MAPEH`) ?? 0}`
  );
  console.log(
    `   grade_entries under ${MOVE_AY} STAR sheets:  ${before.gradeEntries.get(`${MOVE_AY}|STAR`) ?? 0}`
  );
  const locked = plan.get('grading_sheets')!.filter((r) => r.is_locked).length;
  console.log(
    `   (${locked} of the moving sheets are locked — a subject_id repoint is not a grade edit; no trigger fires)`
  );

  console.log('\n══ subject_report_map ══');
  for (const r of before.reportMap)
    console.log(
      `   ${r.subject_id === c.mapeh.id ? 'MAPEH' : 'STAR'} → ${r.report_subject_id === c.mapeh.id ? 'MAPEH' : r.report_subject_id === c.star.id ? 'STAR' : r.report_subject_id}`
    );
  const starSelf = before.reportMap.some(
    (r) => r.subject_id === c.star.id && r.report_subject_id === c.star.id
  );
  const otherInto = before.reportMap.filter(
    (r) => r.report_subject_id === c.mapeh.id && r.subject_id !== c.mapeh.id
  );
  if (otherInto.length)
    console.log(
      `   ⚠ ${otherInto.length} other subject(s) report INTO MAPEH — not changed; review by hand`
    );
  console.log(
    starSelf ? '   STAR self-row already present' : '   → would add STAR → STAR'
  );

  console.log(`\n══ ${KEEP_AY} — must read identically after the move ══`);
  const keepBefore = keepFingerprint(c, before);
  console.log(keepBefore.replace(/^/gm, '   '));
  // Assert: nothing in the plan belongs to the kept year.
  for (const [table, rows] of plan) {
    const stray = rows.filter(
      (r) => SPECS_BY_TABLE.get(table)!.ayOf(r) !== MOVE_AY
    );
    if (stray.length)
      fail(`${table}: ${stray.length} planned row(s) are not ${MOVE_AY}`);
  }
  console.log(
    `   ✓ no planned row belongs to ${KEEP_AY} (or any year but ${MOVE_AY})`
  );

  if (problems) fail(`${problems} problem(s) above — nothing written`);

  const total =
    [...plan.values()].reduce((n, r) => n + r.length, 0) + (starSelf ? 0 : 1);
  console.log(`\nTotal rows that would change: ${total}`);

  if (PRINT_SQL) {
    printSql(c, cfg.id, before, keepBefore);
    return;
  }
  if (!APPLY) {
    console.log(
      '\nDry run — nothing written. --apply to write, --sql for a one-transaction SQL block.'
    );
    return;
  }

  // ── APPLY, in order ──
  const ok = (label: string, n: number, want: number) => {
    console.log(`   ${n === want ? '✓' : '✗'} ${label}: ${n}/${want}`);
    if (n !== want)
      fail(
        `${label} changed ${n}, planned ${want} — re-run to finish; each step is idempotent`
      );
  };

  console.log('\n══ Applying ══');
  if (!starSelf) {
    const { error } = await sb
      .from('subject_report_map')
      .upsert(
        { subject_id: c.star.id, report_subject_id: c.star.id },
        { onConflict: 'subject_id,report_subject_id', ignoreDuplicates: true }
      );
    if (error) fail(`subject_report_map: ${error.message}`);
    console.log('   ✓ subject_report_map: STAR → STAR');
  }

  for (const table of [
    'subject_configs',
    'subject_level_offerings',
    'grading_sheets',
    'teacher_assignments',
    'evaluation_subject_comments',
    'evaluation_checklist_items',
  ]) {
    const ids = plan.get(table)!.map((r) => r.id);
    let changed = 0;
    for (const part of chunk(ids, 100)) {
      const patch: Record<string, unknown> = { subject_id: c.star.id };
      if (table === 'subject_configs') patch.display_name = null;
      const { data, error } = await sb
        .from(table)
        .update(patch)
        .in('id', part)
        .eq('subject_id', c.mapeh.id)
        .select('id');
      if (error)
        fail(
          `${table}: ${error.message} — re-run to finish; each step is idempotent`
        );
      changed += data?.length ?? 0;
    }
    ok(table, changed, ids.length);
  }

  // ── verify ──
  const after = await snapshot(c, ss);
  let left = 0;
  for (const s of ss)
    left += after.rows
      .get(s.table)!
      .filter(
        (r) => r.subject_id === c.mapeh.id && s.ayOf(r) === MOVE_AY
      ).length;
  if (left) fail(`${left} ${MOVE_AY} MAPEH row(s) still present`);
  const keepAfter = keepFingerprint(c, after);
  if (keepAfter !== keepBefore) {
    console.log(keepAfter);
    fail(`${KEEP_AY} changed — compare the fingerprint above with the dry run`);
  }
  const ge = (s: Snapshot) =>
    (s.gradeEntries.get(`${MOVE_AY}|MAPEH`) ?? 0) +
    (s.gradeEntries.get(`${MOVE_AY}|STAR`) ?? 0);
  if (ge(after) !== ge(before))
    fail(`${MOVE_AY} grade_entries count moved ${ge(before)} → ${ge(after)}`);
  console.log(
    `\n✓ Done. ${MOVE_AY} MAPEH rows left: 0. ${KEEP_AY} unchanged. ${MOVE_AY} grade_entries: ${ge(after)} (was ${ge(before)}).`
  );
}

function printSql(c: Catalog, cfgId: string, before: Snapshot, _keep: string) {
  const ay26 = c.ayId(MOVE_AY);
  const ay25 = c.ayId(KEEP_AY);
  const M = `'${c.mapeh.id}'::uuid`;
  const S = `'${c.star.id}'::uuid`;
  const keep25 = (table: string) =>
    before.rows
      .get(table)!
      .filter(
        (r) =>
          r.subject_id === c.mapeh.id &&
          SPECS_BY_TABLE.get(table)!.ayOf(r) === KEEP_AY
      ).length;
  console.log(`
-- move-ay2026-mapeh-to-star — one transaction. Generated ${new Date().toISOString()}.
begin;

insert into public.subject_report_map (subject_id, report_subject_id)
values (${S}, ${S}) on conflict (subject_id, report_subject_id) do nothing;

update public.subject_configs set subject_id = ${S}, display_name = null
 where id = '${cfgId}' and subject_id = ${M};

update public.subject_level_offerings set subject_id = ${S}
 where academic_year_id = '${ay26}' and subject_id = ${M};

update public.grading_sheets set subject_id = ${S}
 where subject_config_id = '${cfgId}' and subject_id = ${M};

update public.teacher_assignments ta set subject_id = ${S}
  from public.sections s
 where s.id = ta.section_id and s.academic_year_id = '${ay26}' and ta.subject_id = ${M};

update public.evaluation_subject_comments e set subject_id = ${S}
  from public.terms t
 where t.id = e.term_id and t.academic_year_id = '${ay26}' and e.subject_id = ${M};

update public.evaluation_checklist_items e set subject_id = ${S}
  from public.terms t
 where t.id = e.term_id and t.academic_year_id = '${ay26}' and e.subject_id = ${M};

do $$
declare n int;
begin
  -- nothing in ${MOVE_AY} may still name MAPEH
  select (select count(*) from public.subject_configs where academic_year_id = '${ay26}' and subject_id = ${M})
       + (select count(*) from public.subject_level_offerings where academic_year_id = '${ay26}' and subject_id = ${M})
       + (select count(*) from public.grading_sheets g join public.terms t on t.id = g.term_id where t.academic_year_id = '${ay26}' and g.subject_id = ${M})
       + (select count(*) from public.teacher_assignments a join public.sections s on s.id = a.section_id where s.academic_year_id = '${ay26}' and a.subject_id = ${M})
       + (select count(*) from public.evaluation_subject_comments e join public.terms t on t.id = e.term_id where t.academic_year_id = '${ay26}' and e.subject_id = ${M})
       + (select count(*) from public.evaluation_checklist_items e join public.terms t on t.id = e.term_id where t.academic_year_id = '${ay26}' and e.subject_id = ${M})
    into n;
  if n <> 0 then raise exception '% ${MOVE_AY} MAPEH row(s) left — rolled back', n; end if;

  -- ${KEEP_AY} must read exactly as the dry run counted it
  if (select count(*) from public.subject_configs where academic_year_id = '${ay25}' and subject_id = ${M}) <> ${keep25('subject_configs')}
  or (select count(*) from public.subject_level_offerings where academic_year_id = '${ay25}' and subject_id = ${M}) <> ${keep25('subject_level_offerings')}
  or (select count(*) from public.grading_sheets g join public.terms t on t.id = g.term_id where t.academic_year_id = '${ay25}' and g.subject_id = ${M}) <> ${keep25('grading_sheets')}
  or (select count(*) from public.teacher_assignments a join public.sections s on s.id = a.section_id where s.academic_year_id = '${ay25}' and a.subject_id = ${M}) <> ${keep25('teacher_assignments')}
  or (select count(*) from public.evaluation_subject_comments e join public.terms t on t.id = e.term_id where t.academic_year_id = '${ay25}' and e.subject_id = ${M}) <> ${keep25('evaluation_subject_comments')}
  or (select count(*) from public.evaluation_checklist_items e join public.terms t on t.id = e.term_id where t.academic_year_id = '${ay25}' and e.subject_id = ${M}) <> ${keep25('evaluation_checklist_items')}
  then raise exception '${KEEP_AY} MAPEH counts moved — rolled back'; end if;
end $$;

commit;
`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
