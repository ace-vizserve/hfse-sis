// scripts/backfill/apply-house-assignments.ts
//
// 🔴 DO NOT RE-RUN THIS SCRIPT. It read the WRONG allocation.
//
// The CSV below is the export of the workbook's FIRST tab, which is a
// superseded master: 292 of its 389 rows disagree with the per-class tabs, and
// it puts whole classes in one house. The live allocation is the PER-CLASS tabs
// of `house/Student House Color Assignment.xlsx` (confirmed by Mr Ace on
// 2026-08-06; see lib/sis/backfill/house/workbook.ts's header). This script was
// applied on 2026-09-17 and set `students.house_id` from the master, and the
// house-points workbook — which agrees with the class tabs — is how that
// surfaced. The correction is:
//
//   scripts/backfill/apply-house-assignments-class-tabs.ts
//
// Kept (not deleted) as the record of what was written on 2026-09-17.
//
// ─────────────────────────────────────────────────────────────────────────
// Assigns AY2026 students to their house from the school's own allocation.
//
// Source: "Student House Color Assignment - Student House Color Assignment.csv"
// — section header, then "Student Name,House Color" rows. 389 students, four
// houses split almost exactly evenly (Orange 99, Green 97, Blue 97, Yellow 96).
//
// WHY THIS IS NEEDED. The four houses have existed since 2026-08-03 with their
// colour tokens, titles and core values — but only ONE student row carried a
// `house_id`, and that one is the `Test, Testing Two` record. So the House
// column renders an em-dash for every real child, and nothing house-based has
// ever had data behind it. The structure was built; the allocation never
// arrived until now.
//
// ⚠ MATCHED ON NAME WITHIN A SECTION, because the CSV carries no student
// number — only "SURNAME, Given" and a colour. Three tiers, each requiring a
// UNIQUE hit, identical to apply-masterlist-alignment.ts: exact (accents
// stripped), same tokens REORDERED, then one name's tokens a SUBSET of the
// other's. An ambiguous match assigns nothing and is reported, because the
// failure here puts a child in their classmate's house.
//
// ⚠ Service-role writes leave NO `audit_log` row. The reasoning lives here.
//
// Dry run by default.
//
//   npx tsx --env-file=.env.local scripts/backfill/apply-house-assignments.ts
//   npx tsx --env-file=.env.local scripts/backfill/apply-house-assignments.ts --apply

import { readFileSync } from 'node:fs';

import * as XLSX from 'xlsx';

import {
  LEVEL_TO_PREFIX,
  matchName,
  nameKey,
  normaliseSection,
} from '../../lib/sis/backfill/house/section-name-match';
import { createServiceClient } from '../../lib/supabase/service';

const CSV =
  'Student House Color Assignment - Student House Color Assignment.csv';
const AY = 'AY2026';
const APPLY = process.argv.includes('--apply');

// Name matching and section aliases now live in
// lib/sis/backfill/house/section-name-match.ts, shared with the correction
// script. Unchanged in behaviour.

// ── Parse ──────────────────────────────────────────────────────────────────

type Allocation = { name: string; house: string };

function parseCsv(): Map<string, Allocation[]> {
  // ⚠ READ AS UTF-8 EXPLICITLY. `XLSX.readFile` on a .csv decodes as Latin-1,
  // so "CASIÑO" arrives as "CASIÃO" and "Iñigo" as "IÃ±igo" — five children
  // then match nobody and look like they are missing from the SIS. The file
  // itself is fine (verified: the bytes are 0xC3 0x91, a proper UTF-8 Ñ); the
  // reader was the problem. Reading the text ourselves and handing XLSX a
  // string keeps its CSV parsing (quoted fields contain commas — "SANTOS,
  // Kairo Alonzo V." is one field) without its encoding guess.
  const wb = XLSX.read(readFileSync(CSV, 'utf8'), {
    type: 'string',
    raw: true,
  });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
    header: 1,
    blankrows: false,
  }) as unknown[][];

  const out = new Map<string, Allocation[]>();
  let section = '(none)';
  for (const r of rows) {
    const c = r.map((x) => (x == null ? '' : String(x).trim()));
    if (!c.filter(Boolean).length) continue;
    const [name, house] = c;
    // A row with a first cell and no colour is the section heading.
    if (name && !house) {
      section = normaliseSection(name);
      continue;
    }
    if (name?.toLowerCase() === 'student name') continue; // repeated header
    if (!name || !house) continue;
    if (!out.has(section)) out.set(section, []);
    out.get(section)!.push({ name, house });
  }
  return out;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const supabase = createServiceClient();
  const csv = parseCsv();

  const { data: houses, error: houseErr } = await supabase
    .from('houses')
    .select('id, name, code');
  if (houseErr) throw new Error(`houses read failed: ${houseErr.message}`);

  // "Green" in the CSV → "Green House" in the SIS.
  const houseByColour = new Map<string, { id: string; name: string }>();
  for (const h of (houses ?? []) as Record<string, string>[]) {
    const colour = h.name
      .replace(/\s*house\s*$/i, '')
      .trim()
      .toUpperCase();
    houseByColour.set(colour, { id: h.id, name: h.name });
  }

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
    .select('id, name, level_id')
    .eq('academic_year_id', ayId);

  const { data: roster, error: rosterErr } = await supabase
    .from('section_students')
    .select('section_id, student_id, enrollment_status')
    .in(
      'section_id',
      ((sections ?? []) as { id: string }[]).map((s) => s.id)
    );
  if (rosterErr) throw new Error(`roster read failed: ${rosterErr.message}`);

  const studentIds = [
    ...new Set(
      ((roster ?? []) as { student_id: string }[])
        .map((r) => r.student_id)
        .filter(Boolean)
    ),
  ];
  const studentById = new Map<string, Record<string, string>>();
  for (let i = 0; i < studentIds.length; i += 100) {
    const { data, error } = await supabase
      .from('students')
      .select('id, last_name, first_name, student_number, house_id')
      .in('id', studentIds.slice(i, i + 100));
    if (error) throw new Error(`students read failed: ${error.message}`);
    for (const s of (data ?? []) as Record<string, string>[])
      studentById.set(s.id, s);
  }

  const writes: { id: string; houseId: string; label: string }[] = [];
  const unmatched: string[] = [];
  const orphanedCsvRows: string[] = [];
  const notes: string[] = [];
  const seenSections = new Set<string>();
  let alreadyRight = 0;

  for (const sec of (sections ?? []) as Record<string, string>[]) {
    const levelLabel = levelById.get(sec.level_id) ?? '?';
    const prefix = LEVEL_TO_PREFIX[levelLabel] ?? levelLabel;
    const label = `${prefix} ${sec.name}`;
    const alloc = csv.get(normaliseSection(label));
    if (!alloc) {
      notes.push(`${label}: not in the house CSV — skipped`);
      continue;
    }
    seenSections.add(normaliseSection(label));

    const byName = new Map<string, Allocation>();
    for (const a of alloc) byName.set(nameKey(a.name), a);
    // ⚠ THE MIRROR CHECK. A SIS child with no house could mean the list does
    // not cover them, OR that the name failed to match — those need different
    // answers, and only reporting one side cannot tell them apart. Every CSV
    // row that matches nobody is reported too.
    const csvUsed = new Set<string>();

    for (const r of (roster ?? []) as Record<string, unknown>[]) {
      if (r.section_id !== sec.id) continue;
      const st = studentById.get(String(r.student_id));
      if (!st) continue;
      const who = `${st.last_name}, ${st.first_name}`;
      const hit = matchName(who, byName);
      if (!hit) {
        // Withdrawn children are absent from the allocation by design.
        if (r.enrollment_status !== 'withdrawn') {
          unmatched.push(`   ${label}: ${who} — no house on the list`);
        }
        continue;
      }
      csvUsed.add(nameKey(hit.row.name));
      if (hit.via !== 'exact') {
        notes.push(
          `   ${label}: matched "${who}" to "${hit.row.name}" (${hit.via})`
        );
      }
      const house = houseByColour.get(hit.row.house.trim().toUpperCase());
      if (!house) {
        unmatched.push(
          `   ${label}: ${who} — unknown house colour "${hit.row.house}"`
        );
        continue;
      }
      if (st.house_id === house.id) {
        alreadyRight += 1;
        continue;
      }
      writes.push({
        id: st.id,
        houseId: house.id,
        label: `${label}: ${who} → ${house.name}${st.house_id ? ' (was a different house)' : ''}`,
      });
    }

    for (const a of alloc) {
      if (!csvUsed.has(nameKey(a.name))) {
        orphanedCsvRows.push(
          `   ${label}: "${a.name}" (${a.house}) — nobody in the SIS`
        );
      }
    }
  }

  for (const key of csv.keys()) {
    if (!seenSections.has(key))
      notes.push(`CSV section "${key}" has no SIS match`);
  }

  console.log(`House assignment — ${AY}\n`);
  console.log(`  to assign      : ${writes.length}`);
  console.log(`  already correct: ${alreadyRight}`);
  console.log(`  no house listed: ${unmatched.length}`);
  if (unmatched.length) {
    console.log('\nNot assigned:');
    unmatched.forEach((u) => console.log(u));
  }
  if (orphanedCsvRows.length) {
    console.log(
      `\nOn the house list but matching nobody in the SIS (${orphanedCsvRows.length}):`
    );
    orphanedCsvRows.forEach((o) => console.log(o));
  }
  if (notes.length) {
    console.log('\nNotes:');
    notes.forEach((n) => console.log(`  ${n}`));
  }

  if (!APPLY) {
    console.log(
      `\nDRY RUN — re-run with --apply to write ${writes.length} row(s).`
    );
    return;
  }

  console.log('\nApplying…');
  let done = 0;
  for (const w of writes) {
    const { error } = await supabase
      .from('students')
      .update({ house_id: w.houseId })
      .eq('id', w.id);
    if (error) throw new Error(`${w.label}: ${error.message}`);
    done += 1;
  }
  console.log(`  ✅ ${done} student(s) assigned`);

  // Read back — the script proves its own result rather than assuming it.
  const counts = new Map<string, number>();
  for (let i = 0; i < studentIds.length; i += 100) {
    const { data } = await supabase
      .from('students')
      .select('house_id')
      .in('id', studentIds.slice(i, i + 100));
    for (const s of (data ?? []) as { house_id: string | null }[]) {
      const key = s.house_id ?? '(none)';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const nameById = new Map(
    ((houses ?? []) as Record<string, string>[]).map((h) => [h.id, h.name])
  );
  console.log('\nHouse counts after:');
  for (const [id, n] of [...counts].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${(nameById.get(id) ?? '(no house)').padEnd(16)} ${n}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
