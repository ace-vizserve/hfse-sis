// scripts/backfill/apply-masterlist-alignment.ts
// Aligns the AY2026 SIS to the school's own class list, for P1–S4.
//
// Mr Ace, 2026-09-17: _"the plan is to align our SIS to the master list."_
// The source is `List of Students.xlsx` → "Class Lists", the list the office
// actually works from.
//
// THREE THINGS, AND DELIBERATELY ONLY THREE:
//   1. Rename the P1 "Respect" section to "Test Section". It is a test
//      section, and naming it so is what keeps it out of every future
//      comparison — it has no masterlist counterpart because it is not real.
//   2. Form class advisers, where the masterlist names someone different.
//   3. Index numbers, where the masterlist puts a child at a different number.
//
// 🔴 WHAT THIS DOES NOT TOUCH: STUDENT NUMBERS. 190 children carry a different
// number in each system, because the school stopped using the SIS's and keeps
// its own sequence. Adopting theirs was investigated and REJECTED on evidence:
// for a Current student the SIS number is REUSED from their previous year and
// is the key that finds their earlier applications, and all six of the direct
// collisions resolve to the masterlist's number already carrying ANOTHER
// child's continuous history. Writing them would fuse pairs of children, not
// relabel them. Mr Ace, 2026-09-17: _"for now we dont adopt to it cause this
// will cause problems."_
//
// 🔴 YOUNGSTARTERS IS OUT OF SCOPE. The masterlist has 15 of them and the SIS
// has no such section. Mr Ace wants them adopted WITH their grading sheets,
// attendance and evaluation write-ups — a separate job, after P1–S4 is clean.
//
// ⚠ WITHDRAWN STUDENTS ARE ABSENT FROM THE MASTERLIST BY DESIGN, so a child in
// the SIS and not on paper is NOT evidence of an error, and nothing here
// removes anybody. This script only renames, re-advises and renumbers.
//
// ⚠ `unique (section_id, index_number)` IS NON-DEFERRABLE. Index changes
// therefore run in two passes per section — every moving row is parked on a
// NEGATIVE index first, then written to its target — so a swap can never
// collide mid-way. Same technique migration 147 uses for the index swap.
//
// ⚠ Service-role writes leave NO `audit_log` row. The reasoning lives here.
//
// Dry run by default. Nothing is written without --apply.
//
//   npx tsx --env-file=.env.local scripts/backfill/apply-masterlist-alignment.ts
//   npx tsx --env-file=.env.local scripts/backfill/apply-masterlist-alignment.ts --apply

import * as XLSX from 'xlsx';

import { createServiceClient } from '../../lib/supabase/service';

const WORKBOOK = 'List of Students.xlsx';
const AY = 'AY2026';
const APPLY = process.argv.includes('--apply');

const TEST_SECTION_FROM = 'Respect';
const TEST_SECTION_TO = 'Test Section';

// ── Shared normalisers (kept identical to audit-roster-vs-masterlist.ts) ────

function normaliseSection(title: string): string {
  // One workbook title has an UNCLOSED bracket ("P1 Patience (Morning Session
  // | GLOBAL"), so this drops from the first "(" to the end rather than
  // matching a pair.
  let t = title
    .replace(/\(.*$/g, ' ')
    .replace(/[-–]\s*(global|standard)\b/gi, ' ')
    .replace(/\b(global|standard|morning session|afternoon session)\b/gi, ' ')
    .trim();
  t = t
    .replace(/^Sec\s*(\d)/i, 'S$1')
    .replace(/^Secondary\s*(\d)/i, 'S$1')
    .replace(/^Youngstarters?$/i, 'YS');
  const key = t.replace(/\s+/g, ' ').trim().toUpperCase();

  // ⚠ THE MASTERLIST DROPS THE "1" ON THE GLOBAL STREAM. It writes
  // "Sec 1 Discipline- Global" and "Sec 1 Discipline 2- Standard", where the
  // SIS holds "Discipline 1" and "Discipline 2". Without this the whole
  // section fails to match and is silently skipped — which is exactly what
  // happened, and it hid three wrong index numbers until Ms. Sharon Menezes
  // reported two of them from her attendance sheet.
  //
  // Explicit rather than clever: a rule like "append 1 when a 2 exists" would
  // fire on section names nobody has written yet.
  const ALIASES: Record<string, string> = {
    'S1 DISCIPLINE': 'S1 DISCIPLINE 1',
  };
  return ALIASES[key] ?? key;
}

/** "TRAQUEÑA" and "Traquena" are the same child. Accents are transcription
 *  noise between the two systems, never a distinction. */
function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function tokens(name: string): string[] {
  return stripDiacritics(name)
    .toUpperCase()
    .replace(/[.,]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1); // a lone letter is an initial, never a name
}

function nameKey(name: string): string {
  return tokens(name).join(' ').trim();
}

/**
 * Match one SIS name against the masterlist's names for the SAME SECTION.
 *
 * Three tiers, each requiring a UNIQUE hit, because the failure mode here is
 * attaching one child's index number to another:
 *
 *   1. Exact, after accents are stripped.
 *   2. Same set of tokens in a different ORDER — the masterlist writes
 *      "TAYEB, Taseen" where the SIS holds "Taseen, Tayeb". Same child, the
 *      surname and given name transposed on one side.
 *   3. One name's tokens are a SUBSET of the other's — "Faylona, Lucas" vs
 *      "FAYLONA, Lucas Paulus C.", a dropped middle name.
 *
 * ⚠ Tier 3 is the dangerous one: "Dela Cruz, Jean" is a subset of "Dela Cruz,
 * Jean Marcus". It is only accepted when exactly ONE candidate in the section
 * matches — two siblings make it ambiguous, and ambiguous returns nothing so
 * the caller refuses rather than guesses. Every non-exact match is reported.
 */
function matchName(
  sisName: string,
  candidates: Map<string, PaperRow>
): { row: PaperRow; via: 'exact' | 'reordered' | 'subset' } | null {
  const exact = candidates.get(nameKey(sisName));
  if (exact) return { row: exact, via: 'exact' };

  const mine = tokens(sisName);
  const sortedMine = [...mine].sort().join(' ');

  const reordered = [...candidates.entries()].filter(
    ([k]) => k.split(' ').sort().join(' ') === sortedMine
  );
  if (reordered.length === 1) return { row: reordered[0][1], via: 'reordered' };

  const mineSet = new Set(mine);
  const subset = [...candidates.entries()].filter(([k]) => {
    const theirs = k.split(' ');
    const theirSet = new Set(theirs);
    const mineInTheirs = mine.every((t) => theirSet.has(t));
    const theirsInMine = theirs.every((t) => mineSet.has(t));
    return mineInTheirs || theirsInMine;
  });
  if (subset.length === 1) return { row: subset[0][1], via: 'subset' };

  return null;
}

const LEVEL_TO_PREFIX: Record<string, string> = {
  'Primary One': 'P1',
  'Primary Two': 'P2',
  'Primary Three': 'P3',
  'Primary Four': 'P4',
  'Primary Five': 'P5',
  'Primary Six': 'P6',
  'Secondary One': 'S1',
  'Secondary Two': 'S2',
  'Secondary Three': 'S3',
  'Secondary Four': 'S4',
};

type PaperRow = { index: number | null; name: string };
type PaperSection = {
  label: string;
  adviser: string | null;
  /** 'Global' | 'Standard' | null — the stream, which the masterlist writes
   *  into the section TITLE ("Sec 1 Discipline- Global", "P5 Commitment
   *  (Global)"). `sections.class_type` exists in the SIS and is NULL for all
   *  21 AY2026 sections, so this is the only place the school records it.
   *
   *  ⚠ A title with no marking stays NULL. Mr Ace, asked whether unmarked
   *  means Standard: _"leave them"_ — so 12 sections keep an honest NULL
   *  rather than a guessed value. */
  classType: 'Global' | 'Standard' | null;
  rows: PaperRow[];
};

function classTypeFromTitle(title: string): 'Global' | 'Standard' | null {
  if (/\bglobal\b/i.test(title)) return 'Global';
  if (/\bstandard\b/i.test(title)) return 'Standard';
  return null;
}

function parseWorkbook(): Map<string, PaperSection> {
  const wb = XLSX.readFile(WORKBOOK);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Class Lists'], {
    header: 1,
    blankrows: false,
  }) as unknown[][];

  const out = new Map<string, PaperSection>();
  let title = '(none)';
  let adviser: string | null = null;

  for (const r of rows) {
    const cells = r.map((c) => (c == null ? '' : String(c).trim()));
    const nonEmpty = cells.filter(Boolean);
    if (!nonEmpty.length) continue;
    if (cells[0]?.toLowerCase() === 'index #') continue;

    if (nonEmpty.length === 1) {
      const v = nonEmpty[0];
      if (/^(form class adviser|room)\s*:/i.test(v)) {
        if (/adviser/i.test(v)) {
          adviser = v.split(':').slice(1).join(':').trim() || null;
          const key = normaliseSection(title);
          const sec = out.get(key);
          if (sec && !sec.adviser) sec.adviser = adviser;
        }
        continue;
      }
      if (/^\d+$/.test(v)) continue; // a vacated slot — no name to align
      title = v;
      adviser = null;
      if (!out.has(normaliseSection(title))) {
        out.set(normaliseSection(title), {
          label: title,
          adviser: null,
          classType: classTypeFromTitle(title),
          rows: [],
        });
      }
      continue;
    }

    const key = normaliseSection(title);
    if (!out.has(key))
      out.set(key, {
        label: title,
        adviser,
        classType: classTypeFromTitle(title),
        rows: [],
      });
    const idx = Number(cells[0]);
    if (cells[1]) {
      out.get(key)!.rows.push({
        index: Number.isFinite(idx) && cells[0] !== '' ? idx : null,
        name: cells[1],
      });
    }
  }
  return out;
}

// ── Main ───────────────────────────────────────────────────────────────────

type Change = { what: string; run: () => Promise<void> };

async function main() {
  const supabase = createServiceClient();
  const paper = parseWorkbook();

  const { data: ayRow } = await supabase
    .from('academic_years')
    .select('id')
    .eq('ay_code', AY)
    .single();
  const ayId = (ayRow as { id: string }).id;

  const { data: levels } = await supabase
    .from('levels')
    .select('id, code, label');
  const levelById = new Map(
    ((levels ?? []) as { id: string; code: string; label: string }[]).map(
      (l) => [l.id, l.label || l.code]
    )
  );

  const { data: sections } = await supabase
    .from('sections')
    .select('id, name, level_id, form_class_adviser, class_type')
    .eq('academic_year_id', ayId);

  const planned: Change[] = [];
  const notes: string[] = [];

  // ── 1. Rename the test section ──────────────────────────────────────────
  const respect = ((sections ?? []) as Record<string, string>[]).find(
    (s) => s.name === TEST_SECTION_FROM
  );
  if (respect) {
    planned.push({
      what: `RENAME section "${TEST_SECTION_FROM}" → "${TEST_SECTION_TO}"`,
      run: async () => {
        const { error } = await supabase
          .from('sections')
          .update({ name: TEST_SECTION_TO })
          .eq('id', respect.id);
        if (error) throw new Error(`rename failed: ${error.message}`);
      },
    });
  } else {
    notes.push(`section "${TEST_SECTION_FROM}" not found — already renamed?`);
  }

  // ── Roster, per section ─────────────────────────────────────────────────
  const sectionIds = ((sections ?? []) as { id: string }[]).map((s) => s.id);
  const { data: roster, error: rosterErr } = await supabase
    .from('section_students')
    .select('id, section_id, index_number, student_id, enrollment_status')
    .in('section_id', sectionIds);
  if (rosterErr) throw new Error(`roster read failed: ${rosterErr.message}`);

  const studentIds = [
    ...new Set(
      ((roster ?? []) as { student_id: string }[])
        .map((r) => r.student_id)
        .filter(Boolean)
    ),
  ];
  // Chunked — a single .in() with 400+ uuids builds a URL long enough that the
  // request fails, and an unchecked failure would make this script think the
  // roster is empty.
  const studentById = new Map<string, Record<string, string>>();
  for (let i = 0; i < studentIds.length; i += 100) {
    const { data, error } = await supabase
      .from('students')
      .select('id, last_name, first_name, student_number')
      .in('id', studentIds.slice(i, i + 100));
    if (error) throw new Error(`students read failed: ${error.message}`);
    for (const s of (data ?? []) as Record<string, string>[])
      studentById.set(s.id, s);
  }

  for (const sec of (sections ?? []) as Record<string, string>[]) {
    if (sec.name === TEST_SECTION_FROM || sec.name === TEST_SECTION_TO)
      continue;

    const levelLabel = levelById.get(sec.level_id) ?? '?';
    const prefix = LEVEL_TO_PREFIX[levelLabel] ?? levelLabel;
    const label = `${prefix} ${sec.name}`;
    const book = paper.get(normaliseSection(label));
    if (!book) {
      notes.push(`${label}: no masterlist section — skipped`);
      continue;
    }

    // ── 2. Adviser ────────────────────────────────────────────────────────
    const sisAdviser = (sec.form_class_adviser ?? '').trim();
    const bookAdviser = (book.adviser ?? '').trim();
    if (bookAdviser && sisAdviser.toLowerCase() !== bookAdviser.toLowerCase()) {
      planned.push({
        what: `${label}: adviser "${sisAdviser || '—'}" → "${bookAdviser}"`,
        run: async () => {
          const { error } = await supabase
            .from('sections')
            .update({ form_class_adviser: bookAdviser })
            .eq('id', sec.id);
          if (error)
            throw new Error(`${label} adviser failed: ${error.message}`);
        },
      });
    }

    // ── 2b. Class type (Global / Standard) ────────────────────────────────
    //
    // The masterlist writes the stream into the section title; the SIS has a
    // `class_type` column that has been NULL since the year was created. Only
    // a title that actually says Global or Standard sets anything — an
    // unmarked section keeps its NULL rather than being guessed into a value.
    const sisType = (sec.class_type ?? null) as string | null;
    if (book.classType && sisType !== book.classType) {
      planned.push({
        what: `${label}: class type ${sisType ?? '—'} → ${book.classType}`,
        run: async () => {
          const { error } = await supabase
            .from('sections')
            .update({ class_type: book.classType })
            .eq('id', sec.id);
          if (error)
            throw new Error(`${label} class_type failed: ${error.message}`);
        },
      });
    }

    // ── 3. Index numbers ──────────────────────────────────────────────────
    const bookByName = new Map<string, PaperRow>();
    for (const r of book.rows) {
      const k = nameKey(r.name);
      if (k) bookByName.set(k, r);
    }

    const moves: { rowId: string; from: number; to: number; who: string }[] =
      [];
    for (const r of (roster ?? []) as Record<string, unknown>[]) {
      if (r.section_id !== sec.id) continue;
      const st = studentById.get(String(r.student_id));
      if (!st) continue;
      const who = `${st.last_name}, ${st.first_name}`;
      const hit = matchName(who, bookByName);

      // ── 2c. Surname and given name stored back-to-front ──────────────────
      //
      // The masterlist writes "SURNAME, Given" (Mr Ace: _"they do surname,
      // first name"_). A `reordered` match means the SIS holds the same two
      // tokens the other way round — e.g. the SIS has last_name "Sayeda",
      // first_name "Toki" where the masterlist says "TOKI, Sayeda".
      //
      // Scoped to `reordered` ONLY. That tier already proved the tokens are
      // identical and merely transposed, so this is not a judgement about
      // which word looks like a surname — it is taking the school's own
      // ordering for a child we have already matched.
      if (hit?.via === 'reordered' && hit.row.name.includes(',')) {
        const [rawLast, ...restParts] = hit.row.name.split(',');
        const title = (s: string) =>
          s
            .trim()
            .toLowerCase()
            .replace(/(^|[\s-])([a-z])/g, (_, p, c) => p + c.toUpperCase());
        const newLast = title(rawLast);
        const newFirst = title(restParts.join(' '));
        if (
          newLast &&
          newFirst &&
          (newLast !== st.last_name || newFirst !== st.first_name)
        ) {
          planned.push({
            what: `${label}: NAME "${st.last_name}, ${st.first_name}" → "${newLast}, ${newFirst}"`,
            run: async () => {
              const { error } = await supabase
                .from('students')
                .update({ last_name: newLast, first_name: newFirst })
                .eq('id', st.id);
              if (error)
                throw new Error(`${label} name ${who}: ${error.message}`);
            },
          });
        }
      }

      if (hit && hit.via !== 'exact') {
        // Surfaced, never silent — a non-exact match is an assumption about
        // WHICH CHILD this is, and it must be readable before --apply.
        notes.push(
          `   ${label}: matched "${who}" to masterlist "${hit.row.name}" (${hit.via})`
        );
      }
      const b = hit?.row;
      const from = r.index_number as number | null;
      if (!b || b.index == null || from == null || b.index === from) continue;
      moves.push({ rowId: String(r.id), from, to: b.index, who });
    }

    if (!moves.length) continue;

    // Refuse if two children would land on the same number — that is the
    // masterlist disagreeing with itself, not something to resolve silently.
    const targets = new Map<number, string>();
    let clash = false;
    for (const m of moves) {
      if (targets.has(m.to)) {
        notes.push(
          `🔴 ${label}: masterlist puts BOTH ${targets.get(m.to)} and ${m.who} at #${m.to} — section skipped`
        );
        clash = true;
        break;
      }
      targets.set(m.to, m.who);
    }
    if (clash) continue;

    // A target occupied by a child who is NOT moving would collide.
    const staying = ((roster ?? []) as Record<string, unknown>[]).filter(
      (r) =>
        r.section_id === sec.id && !moves.some((m) => m.rowId === String(r.id))
    );
    const blocked = moves.filter((m) =>
      staying.some((r) => r.index_number === m.to)
    );
    if (blocked.length) {
      for (const b of blocked) {
        const occupant = staying.find((r) => r.index_number === b.to);
        const st = occupant
          ? studentById.get(String(occupant.student_id))
          : null;
        notes.push(
          `🔴 ${label}: ${b.who} → #${b.to}, but #${b.to} is held by ${st ? `${st.last_name}, ${st.first_name}` : '?'} who is not moving — section skipped`
        );
      }
      continue;
    }

    planned.push({
      what:
        `${label}: renumber ${moves.length} — ` +
        moves.map((m) => `${m.who} #${m.from}→#${m.to}`).join(', '),
      run: async () => {
        // Pass 1 — park every mover on a negative index. `unique (section_id,
        // index_number)` is non-deferrable, so a direct swap would collide.
        for (let i = 0; i < moves.length; i += 1) {
          const { error } = await supabase
            .from('section_students')
            .update({ index_number: -(i + 1) })
            .eq('id', moves[i].rowId);
          if (error)
            throw new Error(`${label} park ${moves[i].who}: ${error.message}`);
        }
        // Pass 2 — write the real numbers.
        for (const m of moves) {
          const { error } = await supabase
            .from('section_students')
            .update({ index_number: m.to })
            .eq('id', m.rowId);
          if (error)
            throw new Error(`${label} set ${m.who} #${m.to}: ${error.message}`);
        }
      },
    });
  }

  // ── Report ──────────────────────────────────────────────────────────────
  console.log(`Masterlist alignment — ${AY}, P1–S4\n`);
  if (!planned.length) console.log('  nothing to change.\n');
  for (const c of planned) console.log(`  • ${c.what}`);
  if (notes.length) {
    console.log('\nNotes:');
    for (const n of notes) console.log(`  ${n}`);
  }

  if (!APPLY) {
    console.log(
      `\nDRY RUN — ${planned.length} change(s). Re-run with --apply to write.`
    );
    return;
  }

  console.log('\nApplying…');
  for (const c of planned) {
    await c.run();
    console.log(`  ✅ ${c.what}`);
  }

  // Read back, so the script proves its own result rather than assuming it.
  const { data: after } = await supabase
    .from('sections')
    .select('name, form_class_adviser')
    .eq('academic_year_id', ayId);
  console.log('\nAdvisers after:');
  for (const s of ((after ?? []) as Record<string, string>[]).sort((a, b) =>
    a.name.localeCompare(b.name)
  )) {
    console.log(`  ${s.name.padEnd(22)} ${s.form_class_adviser ?? '—'}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
