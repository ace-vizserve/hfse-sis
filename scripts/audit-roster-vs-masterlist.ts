// Compare the SIS roster against the school's own class list workbook.
//
// WHY. Nothing has ever checked the SIS's rosters and index numbers against a
// human-maintained list. "Misaligned index numbers" is one of the school's own
// stated pain points, and teachers call students BY number in class, so a
// number that disagrees with the paper list is a daily problem rather than a
// cosmetic one.
//
// ✅ WHAT THIS FILE IS. `List of Students.xlsx` IS the student master list —
// the one Apple Grace was asked for at the 2026-09-15 Admissions training
// (items 19/22). Confirmed by Mr Ace, 2026-09-20. An earlier version of this
// header called it "a graduation/photoshoot logistics workbook, not Miss Jo's
// masterlist", which conflated two things: the workbook DOES carry photoshoot
// tabs (TOGA, Medals, Class Photos), and it is not the registrar's own file —
// but its "Class Lists" tab is the school's authoritative roster, with every
// section, index number and student number.
//
// ⚠ WHAT IT STILL CANNOT DO, and this part of the old note holds. Verified
// 2026-09-17: 14 of the 16 withdrawn-without-a-class students are absent from
// all 29 sheets by given name, and its index holes are literally blank rows
// (`["5"]` with no name) — the same holes the SIS has, with nobody named in
// them. Being the master list does not make it a record of children who have
// left. It CANNOT place those students; it can only say where the two lists
// disagree about the children both of them DO know about.
//
// ⚠ Consequence worth knowing: the 206 school student numbers loaded on
// 2026-09-19 (`backfill/apply-school-student-numbers.ts`) came from this
// file's Class Lists tab — so they came from the authoritative source, not
// from a logistics spreadsheet.
//
// Reads only — no writes, safe to re-run.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/audit-roster-vs-masterlist.ts
//   npx tsx --env-file=.env.local scripts/audit-roster-vs-masterlist.ts --section "P4 Trust"

import * as XLSX from 'xlsx';

import { createServiceClient } from '../lib/supabase/service';

const WORKBOOK = 'List of Students.xlsx';
const AY = 'AY2026';

const onlySection = (() => {
  const i = process.argv.indexOf('--section');
  return i >= 0 ? process.argv[i + 1] : null;
})();

// ── Workbook side ──────────────────────────────────────────────────────────

type SheetEntry = {
  sheetSection: string;
  adviser: string | null;
  index: number | null;
  name: string;
  studentNumber: string | null;
};

/** Lines that describe the block rather than name it. */
const META = /^(form class adviser|room)\s*:/i;

function parseWorkbook(): SheetEntry[] {
  const wb = XLSX.readFile(WORKBOOK);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Class Lists'], {
    header: 1,
    blankrows: false,
  }) as unknown[][];

  const out: SheetEntry[] = [];
  let section = '(none)';
  let adviser: string | null = null;

  for (const r of rows) {
    const cells = r.map((c) => (c == null ? '' : String(c).trim()));
    const nonEmpty = cells.filter(Boolean);
    if (!nonEmpty.length) continue;
    if (cells[0]?.toLowerCase() === 'index #') continue;

    if (nonEmpty.length === 1) {
      const v = nonEmpty[0];
      if (META.test(v)) {
        if (/adviser/i.test(v))
          adviser = v.split(':').slice(1).join(':').trim();
        continue;
      }
      // A lone number is a vacated index slot — the hole itself. Recorded so
      // the comparison can say "the school's list has a gap here too".
      if (/^\d+$/.test(v)) {
        out.push({
          sheetSection: section,
          adviser,
          index: Number(v),
          name: '',
          studentNumber: null,
        });
        continue;
      }
      section = v;
      adviser = null;
      continue;
    }

    const idx = Number(cells[0]);
    out.push({
      sheetSection: section,
      adviser,
      index: Number.isFinite(idx) && cells[0] !== '' ? idx : null,
      name: cells[1] ?? '',
      studentNumber: cells[2] || null,
    });
  }
  return out;
}

/**
 * Workbook section titles carry session and stream in the same string —
 * "P4 Trust (Morning Session)", "Sec 2 Integrity 2- Standard". The SIS stores
 * level and name separately, so this reduces the title to a comparable key.
 */
function normaliseSection(title: string): string {
  // ⚠ `\(.*?\)` alone is not enough — one title in the workbook is
  // "P1 Patience (Morning Session | GLOBAL" with NO closing bracket, so the
  // paired form left it intact and the section was reported as missing from
  // the workbook when it was there all along. Drop from the first "(" to the
  // end, then the session/stream words wherever they appear unbracketed.
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

  // The masterlist drops the "1" on the Global stream: "Sec 1 Discipline-
  // Global" vs the SIS's "Discipline 1". Without this the section does not
  // match and is reported as missing from both lists — which is how three
  // wrong index numbers stayed hidden until a teacher reported two of them.
  // Kept identical to the copy in backfill/apply-masterlist-alignment.ts.
  const ALIASES: Record<string, string> = {
    'S1 DISCIPLINE': 'S1 DISCIPLINE 1',
  };
  return ALIASES[key] ?? key;
}

/**
 * A comparison key for a child's name across the two lists.
 *
 * The SIS stores "Andir, Reneane Cristea"; the workbook writes
 * "ANDIR, Reneane Cristea A." — same child, trailing middle initial. So the
 * key keeps the surname and the given names, uppercases, strips punctuation
 * and drops any single-letter token (an initial, never a name).
 *
 * Deliberately NOT fuzzy. A near-match between two children in the same class
 * is exactly how one child's records get attached to another — the same trap
 * the duplicate-student merge hit, where matching on first given name alone
 * would have paired siblings.
 */
function nameKey(name: string): string {
  return name
    .toUpperCase()
    .replace(/[.,]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .join(' ')
    .trim();
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

// ── Main ───────────────────────────────────────────────────────────────────

type SisRow = {
  studentNumber: string | null;
  name: string;
  index: number | null;
  status: string | null;
};

async function main() {
  const supabase = createServiceClient();

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
    .select('id, name, level_id, class_type, form_class_adviser')
    .eq('academic_year_id', ayId);

  const { data: roster } = await supabase
    .from('section_students')
    .select('section_id, index_number, enrollment_status, student_id')
    .in(
      'section_id',
      ((sections ?? []) as { id: string }[]).map((s) => s.id)
    );

  const studentIds = [
    ...new Set(
      ((roster ?? []) as { student_id: string }[])
        .map((r) => r.student_id)
        .filter(Boolean)
    ),
  ];
  // ⚠ CHUNKED, AND THE ERROR IS CHECKED. A single `.in('id', [...])` with all
  // 409 ids builds a URL long enough that the request fails outright — and the
  // first version of this script destructured only `data`, so the failure was
  // silent: every SIS row came back nameless, every paper row looked unmatched,
  // and it reported 351 disagreements that did not exist. An audit that cannot
  // fetch its own data must stop, not guess.
  const studentById = new Map<string, Record<string, string>>();
  const CHUNK = 100;
  for (let i = 0; i < studentIds.length; i += CHUNK) {
    const slice = studentIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from('students')
      .select('id, student_number, last_name, first_name, middle_name')
      .in('id', slice);
    if (error) {
      throw new Error(
        `students lookup failed for ids ${i}-${i + slice.length}: ${error.message}`
      );
    }
    for (const s of (data ?? []) as Record<string, string>[]) {
      studentById.set(s.id, s);
    }
  }
  if (studentById.size < studentIds.length) {
    console.warn(
      `⚠ ${studentIds.length - studentById.size} roster rows point at a student row that does not exist.\n`
    );
  }

  // SIS sections keyed the same way the workbook titles are.
  const sisByKey = new Map<
    string,
    { label: string; adviser: string | null; rows: SisRow[] }
  >();
  for (const sec of (sections ?? []) as Record<string, string>[]) {
    const levelLabel = levelById.get(sec.level_id) ?? '?';
    const prefix = LEVEL_TO_PREFIX[levelLabel] ?? levelLabel;
    const key = normaliseSection(`${prefix} ${sec.name}`);
    const rows: SisRow[] = ((roster ?? []) as Record<string, unknown>[])
      .filter((r) => r.section_id === sec.id)
      .map((r) => {
        const st = studentById.get(String(r.student_id));
        return {
          studentNumber: st?.student_number ?? null,
          name: st
            ? `${st.last_name ?? ''}, ${st.first_name ?? ''}`.trim()
            : '(no student row)',
          index: (r.index_number as number | null) ?? null,
          status: (r.enrollment_status as string | null) ?? null,
        };
      });
    sisByKey.set(key, {
      label: `${prefix} ${sec.name}`,
      adviser: sec.form_class_adviser ?? null,
      rows,
    });
  }

  // Workbook grouped by the same key.
  const sheet = parseWorkbook();
  const bookByKey = new Map<
    string,
    { label: string; adviser: string | null; rows: SheetEntry[] }
  >();
  for (const e of sheet) {
    const key = normaliseSection(e.sheetSection);
    if (!bookByKey.has(key))
      bookByKey.set(key, {
        label: e.sheetSection,
        adviser: e.adviser,
        rows: [],
      });
    const bucket = bookByKey.get(key)!;
    if (e.adviser && !bucket.adviser) bucket.adviser = e.adviser;
    bucket.rows.push(e);
  }

  // ── Report ───────────────────────────────────────────────────────────────
  const keys = [...new Set([...sisByKey.keys(), ...bookByKey.keys()])].sort();

  let totalMismatch = 0;
  let totalOnlySis = 0;
  let totalOnlyBook = 0;
  let totalNumberDisagrees = 0;

  console.log(`SIS ${AY} roster  vs  "${WORKBOOK}" → Class Lists\n`);
  console.log(
    'NOTE: withdrawn students are absent from the workbook by design, so'
  );
  console.log('      "only in SIS + withdrawn" is expected, not a defect.\n');

  for (const key of keys) {
    if (onlySection && !key.includes(normaliseSection(onlySection))) continue;
    const sis = sisByKey.get(key);
    const book = bookByKey.get(key);

    if (!sis) {
      console.log(
        `■ ${book!.label}\n    in the workbook, NO MATCHING SIS SECTION\n`
      );
      continue;
    }
    if (!book) {
      console.log(`■ ${sis.label}\n    in the SIS, NOT IN THE WORKBOOK\n`);
      continue;
    }

    const bookNamed = book.rows.filter((r) => r.name);
    const bookByNum = new Map(
      bookNamed.filter((r) => r.studentNumber).map((r) => [r.studentNumber!, r])
    );
    const sisByNum = new Map(
      sis.rows.filter((r) => r.studentNumber).map((r) => [r.studentNumber!, r])
    );

    // ⚠ NAME is the match key for index comparison, not student number.
    //
    // 166 children carry a different student number in each system (the school
    // keeps its own sequence — see the student-number rules), so matching on
    // number would compare only the 222 that happen to agree and silently skip
    // the rest. Index alignment is the whole point of this audit, so it has to
    // cover every child both lists know about.
    const sisByNameEarly = new Map<string, SisRow>();
    for (const r of sis.rows) {
      const k = nameKey(r.name);
      if (k) sisByNameEarly.set(k, r);
    }

    const indexMismatch: string[] = [];
    for (const b of bookNamed) {
      const s = sisByNameEarly.get(nameKey(b.name));
      if (s && b.index != null && s.index != null && b.index !== s.index) {
        indexMismatch.push(
          `      ${s.name}: SIS #${s.index} → paper #${b.index}`
        );
      }
    }

    // ⚠ MATCH ON NAME AS WELL, or the report lies about what is wrong.
    // Matching on student_number alone reported ~190 children as "missing from
    // the SIS" when in fact both lists hold the same child at the same index
    // and DISAGREE ABOUT THEIR STUDENT NUMBER — Andir sits at #3 in both, as
    // H250606 in the SIS and H250075 on paper. "Missing" and "same child, two
    // identifiers" need completely different fixes, so they are counted apart.
    const sisByName = new Map<string, SisRow>();
    for (const r of sis.rows) {
      const k = nameKey(r.name);
      if (k) sisByName.set(k, r);
    }
    const bookByName = new Map<string, SheetEntry>();
    for (const r of bookNamed) {
      const k = nameKey(r.name);
      if (k) bookByName.set(k, r);
    }

    const numberDisagrees: string[] = [];
    for (const [k, b] of bookByName) {
      const s = sisByName.get(k);
      if (
        s &&
        s.studentNumber &&
        b.studentNumber &&
        s.studentNumber !== b.studentNumber
      ) {
        numberDisagrees.push(
          `      ${s.name} — SIS ${s.studentNumber} vs paper ${b.studentNumber}` +
            (s.index === b.index
              ? ` (both at #${s.index})`
              : ` (#${s.index} vs #${b.index})`)
        );
      }
    }

    const onlySis = sis.rows.filter(
      (r) =>
        r.studentNumber &&
        !bookByNum.has(r.studentNumber) &&
        !bookByName.has(nameKey(r.name))
    );
    const onlyBook = bookNamed.filter(
      (r) =>
        r.studentNumber &&
        !sisByNum.has(r.studentNumber) &&
        !sisByName.has(nameKey(r.name))
    );
    const bookHoles = book.rows.filter((r) => !r.name && r.index != null);

    const adviserDiff =
      (sis.adviser ?? '').trim().toLowerCase() !==
      (book.adviser ?? '').trim().toLowerCase();

    totalMismatch += indexMismatch.length;
    totalOnlySis += onlySis.length;
    totalOnlyBook += onlyBook.length;
    totalNumberDisagrees += numberDisagrees.length;

    const clean =
      !indexMismatch.length &&
      !onlySis.length &&
      !onlyBook.length &&
      !numberDisagrees.length &&
      !adviserDiff;
    if (clean && !onlySection) continue;

    console.log(
      `■ ${sis.label}   SIS ${sis.rows.length} · paper ${bookNamed.length}`
    );
    if (adviserDiff) {
      console.log(
        `    adviser: SIS "${sis.adviser ?? '—'}" vs paper "${book.adviser ?? '—'}"`
      );
    }
    if (indexMismatch.length) {
      console.log(`    index number disagrees (${indexMismatch.length}):`);
      indexMismatch.forEach((m) => console.log(m));
    }
    if (numberDisagrees.length) {
      console.log(
        `    SAME CHILD, TWO STUDENT NUMBERS (${numberDisagrees.length}):`
      );
      numberDisagrees.forEach((m) => console.log(m));
    }
    if (onlySis.length) {
      console.log(`    in SIS, not on paper (${onlySis.length}):`);
      for (const r of onlySis)
        console.log(
          `      #${r.index ?? '—'} ${r.name} (${r.studentNumber}) [${r.status}]`
        );
    }
    if (onlyBook.length) {
      console.log(`    on paper, not in SIS (${onlyBook.length}):`);
      for (const r of onlyBook)
        console.log(`      #${r.index ?? '—'} ${r.name} (${r.studentNumber})`);
    }
    if (bookHoles.length) {
      console.log(
        `    blank slots on paper: ${bookHoles.map((h) => `#${h.index}`).join(', ')}`
      );
    }
    console.log();
  }

  console.log('─'.repeat(64));
  console.log(`same child, two numbers   : ${totalNumberDisagrees}`);
  console.log(`index numbers disagreeing : ${totalMismatch}`);
  console.log(`in SIS, not on paper      : ${totalOnlySis}`);
  console.log(`on paper, not in SIS      : ${totalOnlyBook}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
