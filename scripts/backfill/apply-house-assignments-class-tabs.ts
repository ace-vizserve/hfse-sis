// scripts/backfill/apply-house-assignments-class-tabs.ts
//
// Corrects AY2026 `students.house_id` from the PER-CLASS tabs of
// `house/Student House Color Assignment.xlsx` — the live allocation (confirmed
// by Mr Ace on 2026-08-06).
//
// WHY. On 2026-09-17 scripts/backfill/apply-house-assignments.ts set every
// house from a CSV export of the workbook's FIRST tab, a superseded master:
// 292 of its 389 rows disagree with the class tabs, and it puts whole classes
// in one house. The house-points workbook agrees with the class tabs, which is
// how it surfaced. This script re-reads the class tabs through
// lib/sis/backfill/house/workbook.ts (which skips the master, HFSE Staff, YS
// and VizSchool BY NAME and ignores each tab's hand-typed totals) and changes
// only the rows that differ.
//
// MATCHING. Each sheet row is matched to a student sitting in THAT class
// (non-withdrawn `section_students` row), with the same three-tier unique name
// match the first script used (exact → reordered → subset;
// lib/sis/backfill/house/section-name-match.ts). No match, an ambiguous match,
// or two sheet rows landing on the same child → nothing is assigned and it is
// reported.
//
// NOT TOUCHED: any student no class-tab row claims (reported — with and
// without a house), and every section no tab covers (YS, VizSchool, anything
// new). Only `house_id` is written.
//
// AUDIT. Unlike the first script, every changed student gets an `audit_log`
// row shaped exactly like the per-student house route
// (app/api/sis/students/[enroleeNumber]/house/route.ts): action
// `sis.house.update`, entity `enrolment_application` / enroleeNumber, context
// { enroleeNumber, studentNumber, student_id, before, after, before_name,
// after_name } plus `source`. The row records a real person, so --apply needs
// --actor <auth user uuid> holding a placement-writer role.
//
// NAMES never go to stdout, the repo, or a commit. The per-student detail
// goes only to the file named by --report (keep it outside the repo).
//
// Dry run by default.
//
//   npx tsx --env-file=.env.local scripts/backfill/apply-house-assignments-class-tabs.ts --report <path.md>
//   npx tsx --env-file=.env.local scripts/backfill/apply-house-assignments-class-tabs.ts --report <path.md> --apply --actor <auth user uuid>

import { writeFileSync } from 'node:fs';

import { logActions } from '../../lib/audit/log-action';
import { ENROLMENT_PLACEMENT_WRITERS } from '../../lib/auth/student-record';
import {
  HOUSE_CODE_BY_COLOUR,
  parseHouseWorkbook,
  type HouseSheetRow,
} from '../../lib/sis/backfill/house/workbook';
import {
  LEVEL_TO_PREFIX,
  matchName,
  nameKey,
  normaliseSection,
  whyNoMatch,
  type NameMatchTier,
} from '../../lib/sis/backfill/house/section-name-match';
import { createServiceClient } from '../../lib/supabase/service';

const WORKBOOK = 'house/Student House Color Assignment.xlsx';
const AY = 'AY2026';
const SOURCE = 'class-tabs-correction-2026-09-29';

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
function argValue(flag: string): string | null {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}
const ACTOR_ID = argValue('--actor');
const REPORT_PATH = argValue('--report');

type Service = ReturnType<typeof createServiceClient>;
type Actor = { id: string; email: string | null; role: string | null };
type House = { id: string; name: string; code: string };
type Student = {
  id: string;
  last_name: string | null;
  first_name: string | null;
  student_number: string | null;
  house_id: string | null;
};
type RosterRow = {
  section_id: string;
  student_id: string;
  enrollment_status: string;
  enrolee_number: string | null;
};

// ── Actor (same convention as apply-ay2026-house-points.ts) ────────────────

async function resolveActor(svc: Service): Promise<Actor> {
  if (!ACTOR_ID || !/^[0-9a-f-]{36}$/i.test(ACTOR_ID)) {
    throw new Error(
      '--apply needs --actor <auth user uuid> (the person recorded on every audit row)'
    );
  }
  const { data, error } = await svc.auth.admin.getUserById(ACTOR_ID);
  if (error || !data?.user)
    throw new Error(
      `--actor ${ACTOR_ID}: no such auth user (${error?.message ?? 'not found'})`
    );
  const meta = (data.user.app_metadata ?? {}) as {
    role?: unknown;
    active_role?: unknown;
  };
  const roles = Array.isArray(meta.role)
    ? meta.role.map(String)
    : meta.role
      ? [String(meta.role)]
      : [];
  const writers = ENROLMENT_PLACEMENT_WRITERS as readonly string[];
  const writerRole = roles.find((r) => writers.includes(r));
  if (!writerRole) {
    throw new Error(
      `--actor ${data.user.email}: holds ${roles.join(', ') || 'no role'}, not a placement writer (${writers.join(', ')})`
    );
  }
  const active =
    typeof meta.active_role === 'string' && writers.includes(meta.active_role)
      ? meta.active_role
      : writerRole;
  return { id: data.user.id, email: data.user.email ?? null, role: active };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const svc = createServiceClient();

  // Resolve the actor FIRST on --apply: a missing actor should fail before a
  // single read, never after the plan is printed and trusted.
  const actor = APPLY ? await resolveActor(svc) : null;

  const sheet = parseHouseWorkbook(WORKBOOK);

  const { data: housesData, error: houseErr } = await svc
    .from('houses')
    .select('id, name, code');
  if (houseErr) throw new Error(`houses read failed: ${houseErr.message}`);
  const houses = (housesData ?? []) as House[];
  const houseByCode = new Map(houses.map((h) => [h.code, h]));
  const houseNameById = new Map(houses.map((h) => [h.id, h.name]));
  for (const code of Object.values(HOUSE_CODE_BY_COLOUR)) {
    if (!houseByCode.has(code))
      throw new Error(`house code ${code} not in public.houses`);
  }
  const hn = (id: string | null) =>
    id == null ? '(none)' : (houseNameById.get(id) ?? `?${id}`);

  const { data: ayRow, error: ayErr } = await svc
    .from('academic_years')
    .select('id')
    .eq('ay_code', AY)
    .single();
  if (ayErr || !ayRow) throw new Error(`${AY} not found`);
  const ayId = (ayRow as { id: string }).id;

  const { data: levels } = await svc.from('levels').select('id, code, label');
  const levelById = new Map(
    ((levels ?? []) as { id: string; code: string; label: string }[]).map(
      (l) => [l.id, l.label || l.code]
    )
  );

  const { data: sectionsData, error: secErr } = await svc
    .from('sections')
    .select('id, name, level_id')
    .eq('academic_year_id', ayId);
  if (secErr) throw new Error(`sections read failed: ${secErr.message}`);
  const sections = (sectionsData ?? []) as {
    id: string;
    name: string;
    level_id: string;
  }[];
  const labelBySection = new Map<string, string>();
  const sectionByKey = new Map<string, string>();
  for (const s of sections) {
    const level = levelById.get(s.level_id) ?? '?';
    const label = `${LEVEL_TO_PREFIX[level] ?? level} ${s.name}`;
    labelBySection.set(s.id, label);
    sectionByKey.set(normaliseSection(label), s.id);
  }

  const { data: rosterData, error: rosterErr } = await svc
    .from('section_students')
    .select('section_id, student_id, enrollment_status, enrolee_number')
    .in(
      'section_id',
      sections.map((s) => s.id)
    )
    .range(0, 4999);
  if (rosterErr) throw new Error(`roster read failed: ${rosterErr.message}`);
  // PostgREST caps a response at 1000 rows server-side; a full page means a
  // truncated roster, which would read as "not on any tab".
  if ((rosterData ?? []).length >= 1000)
    throw new Error(
      'roster read hit the 1000-row cap — paginate before trusting it'
    );
  const roster = ((rosterData ?? []) as RosterRow[]).filter(
    (r) => r.enrollment_status !== 'withdrawn'
  );

  const studentIds = [...new Set(roster.map((r) => r.student_id))];
  const studentById = new Map<string, Student>();
  for (let i = 0; i < studentIds.length; i += 100) {
    const { data, error } = await svc
      .from('students')
      .select('id, last_name, first_name, student_number, house_id')
      .in('id', studentIds.slice(i, i + 100));
    if (error) throw new Error(`students read failed: ${error.message}`);
    for (const s of (data ?? []) as Student[]) studentById.set(s.id, s);
  }
  const who = (s: Student) => `${s.last_name ?? ''}, ${s.first_name ?? ''}`;

  // A child with two active rows in the year would be counted twice below.
  const activeSectionsByStudent = new Map<string, string[]>();
  for (const r of roster) {
    const list = activeSectionsByStudent.get(r.student_id) ?? [];
    list.push(r.section_id);
    activeSectionsByStudent.set(r.student_id, list);
  }
  const multiSection = [...activeSectionsByStudent].filter(
    ([, l]) => l.length > 1
  );

  // ── Match, tab by tab ────────────────────────────────────────────────────

  const byTab = new Map<string, HouseSheetRow[]>();
  for (const r of sheet) {
    const list = byTab.get(r.tab) ?? [];
    list.push(r);
    byTab.set(r.tab, list);
  }

  type Match = {
    row: HouseSheetRow;
    sectionId: string;
    rosterRow: RosterRow;
    via: NameMatchTier;
  };
  const matches: Match[] = [];
  const ambiguous: { row: HouseSheetRow; why: string }[] = [];
  const unmatched: { row: HouseSheetRow; hint: string }[] = [];
  const tabsWithoutSection: string[] = [];
  const coveredSections = new Set<string>();

  // Everybody in the year, for the "maybe in another class" hint only.
  const yearCandidates = new Map<string, RosterRow>();
  for (const r of roster) {
    const s = studentById.get(r.student_id);
    if (s) yearCandidates.set(nameKey(who(s)), r);
  }

  for (const [tab, rows] of byTab) {
    const sectionId = sectionByKey.get(normaliseSection(tab));
    if (!sectionId) {
      tabsWithoutSection.push(`${tab} (${rows.length} rows)`);
      for (const row of rows)
        unmatched.push({ row, hint: 'tab maps to no AY2026 section' });
      continue;
    }
    coveredSections.add(sectionId);

    const candidates = new Map<string, RosterRow>();
    const dupKeys = new Set<string>();
    for (const r of roster) {
      if (r.section_id !== sectionId) continue;
      const s = studentById.get(r.student_id);
      if (!s) continue;
      const k = nameKey(who(s));
      if (candidates.has(k)) dupKeys.add(k);
      candidates.set(k, r);
    }

    for (const row of rows) {
      if (dupKeys.has(nameKey(row.rawName))) {
        ambiguous.push({ row, why: 'two classmates share this exact name' });
        continue;
      }
      const hit = matchName(row.rawName, candidates);
      if (hit) {
        matches.push({ row, sectionId, rosterRow: hit.row, via: hit.via });
        continue;
      }
      if (whyNoMatch(row.rawName, candidates) === 'ambiguous') {
        ambiguous.push({ row, why: 'fits more than one classmate' });
        continue;
      }
      const elsewhere = matchName(row.rawName, yearCandidates);
      unmatched.push({
        row,
        hint: elsewhere
          ? `a ${elsewhere.via} name match sits in ${labelBySection.get(elsewhere.row.section_id)}`
          : 'nobody by this name in the class',
      });
    }
  }

  // Two sheet rows on one child: neither is trusted.
  const rowsByStudent = new Map<string, Match[]>();
  for (const m of matches) {
    const list = rowsByStudent.get(m.rosterRow.student_id) ?? [];
    list.push(m);
    rowsByStudent.set(m.rosterRow.student_id, list);
  }
  const collided = new Set<Match>();
  for (const list of rowsByStudent.values()) {
    if (list.length < 2) continue;
    for (const m of list) {
      collided.add(m);
      ambiguous.push({
        row: m.row,
        why: `${list.length} sheet rows matched the same child`,
      });
    }
  }
  const good = matches.filter((m) => !collided.has(m));

  // ── Plan ─────────────────────────────────────────────────────────────────

  type Change = {
    student: Student;
    rosterRow: RosterRow;
    label: string;
    before: string | null;
    after: string;
    via: NameMatchTier;
    rawName: string;
  };
  const changes: Change[] = [];
  let unchanged = 0;
  const tierCount: Record<NameMatchTier, number> = {
    exact: 0,
    reordered: 0,
    subset: 0,
  };
  const claimed = new Set<string>();
  for (const m of good) {
    tierCount[m.via] += 1;
    claimed.add(m.rosterRow.student_id);
    const st = studentById.get(m.rosterRow.student_id)!;
    const target = houseByCode.get(HOUSE_CODE_BY_COLOUR[m.row.colour])!;
    if (st.house_id === target.id) {
      unchanged += 1;
      continue;
    }
    changes.push({
      student: st,
      rosterRow: m.rosterRow,
      label: labelBySection.get(m.sectionId)!,
      before: st.house_id,
      after: target.id,
      via: m.via,
      rawName: m.row.rawName,
    });
  }

  // Students the tabs do not claim — in a covered class, or in a class no tab
  // covers. Reported, never touched.
  const unclaimedCovered: RosterRow[] = [];
  const uncoveredBySection = new Map<string, RosterRow[]>();
  for (const r of roster) {
    if (claimed.has(r.student_id)) continue;
    if (coveredSections.has(r.section_id)) unclaimedCovered.push(r);
    else {
      const list = uncoveredBySection.get(r.section_id) ?? [];
      list.push(r);
      uncoveredBySection.set(r.section_id, list);
    }
  }
  const houseOf = (r: RosterRow) =>
    studentById.get(r.student_id)?.house_id ?? null;

  // Before → after, over every active AY2026 student (each counted once).
  const afterById = new Map(changes.map((c) => [c.student.id, c.after]));
  const houseOrder = [...houses.map((h) => h.id), null] as (string | null)[];
  const tally = (ids: Iterable<string>, after: boolean) => {
    const out = new Map<string | null, number>();
    for (const id of ids) {
      const s = studentById.get(id);
      if (!s) continue;
      const h = after ? (afterById.get(id) ?? s.house_id) : s.house_id;
      out.set(h, (out.get(h) ?? 0) + 1);
    }
    return out;
  };
  const fmt = (m: Map<string | null, number>) =>
    houseOrder
      .filter((h) => (m.get(h) ?? 0) > 0)
      .map((h) => `${hn(h).replace(/ House$/, '')} ${m.get(h)}`)
      .join(' · ');

  // Enrolee numbers for the audit rows — section_students carries most; the
  // admissions application covers the rest (what the route itself resolves).
  const missingEnrolee = changes
    .filter((c) => !c.rosterRow.enrolee_number && c.student.student_number)
    .map((c) => c.student.student_number!);
  const enroleeByNumber = new Map<string, string>();
  if (missingEnrolee.length) {
    const prefix = `ay${AY.replace(/^AY/i, '').toLowerCase()}`;
    const { data, error } = await svc
      .from(`${prefix}_enrolment_applications`)
      .select('enroleeNumber, studentNumber')
      .in('studentNumber', missingEnrolee);
    if (error) throw new Error(`applications read failed: ${error.message}`);
    for (const a of (data ?? []) as {
      enroleeNumber: string | null;
      studentNumber: string | null;
    }[]) {
      if (a.enroleeNumber && a.studentNumber)
        enroleeByNumber.set(a.studentNumber, a.enroleeNumber);
    }
  }
  const enroleeOf = (c: Change) =>
    c.rosterRow.enrolee_number ??
    (c.student.student_number
      ? (enroleeByNumber.get(c.student.student_number) ?? null)
      : null);
  const noEnrolee = changes.filter((c) => !enroleeOf(c));

  // ── Summary (no names) ─────────────────────────────────────────────────

  const allActive = [...activeSectionsByStudent.keys()];
  console.log(`House correction from the class tabs — ${AY}\n`);
  console.log(`  rows parsed        : ${sheet.length} (${byTab.size} tabs)`);
  console.log(
    `  matched            : ${good.length}  (exact ${tierCount.exact} · reordered ${tierCount.reordered} · subset ${tierCount.subset})`
  );
  console.log(`  ambiguous          : ${ambiguous.length}`);
  console.log(`  unmatched          : ${unmatched.length}`);
  console.log(`  unchanged          : ${unchanged}`);
  console.log(`  to change          : ${changes.length}`);
  console.log(
    `     of which from no house: ${changes.filter((c) => c.before == null).length}`
  );
  console.log(
    `  not on any tab, in a covered class: ${unclaimedCovered.length} (with a house ${unclaimedCovered.filter((r) => houseOf(r)).length}, without ${unclaimedCovered.filter((r) => !houseOf(r)).length})`
  );
  const uncoveredAll = [...uncoveredBySection.values()].flat();
  console.log(
    `  in classes no tab covers          : ${uncoveredAll.length} (with a house ${uncoveredAll.filter((r) => houseOf(r)).length}, without ${uncoveredAll.filter((r) => !houseOf(r)).length})`
  );
  for (const [sid, list] of uncoveredBySection) {
    console.log(
      `     ${(labelBySection.get(sid) ?? sid).padEnd(22)} ${list.length} students, ${list.filter((r) => houseOf(r)).length} with a house`
    );
  }
  if (tabsWithoutSection.length)
    console.log(`  ⚠ tabs with no section: ${tabsWithoutSection.join(', ')}`);
  if (multiSection.length)
    console.log(
      `  ⚠ ${multiSection.length} student(s) active in more than one ${AY} section`
    );
  if (noEnrolee.length)
    console.log(
      `  ⚠ ${noEnrolee.length} change(s) have no enroleeNumber — audit entity_id will be null`
    );

  console.log(`\nAll active ${AY} students (${allActive.length}):`);
  console.log(`  before : ${fmt(tally(allActive, false))}`);
  console.log(`  after  : ${fmt(tally(allActive, true))}`);

  console.log('\nPer class (active students), before → after:');
  const sectionOrder = [...coveredSections].sort((a, b) =>
    (labelBySection.get(a) ?? '').localeCompare(labelBySection.get(b) ?? '')
  );
  for (const sid of sectionOrder) {
    const ids = roster
      .filter((r) => r.section_id === sid)
      .map((r) => r.student_id);
    const changed = changes.filter(
      (c) => c.rosterRow.section_id === sid
    ).length;
    console.log(
      `  ${(labelBySection.get(sid) ?? sid).padEnd(22)} ${String(changed).padStart(3)} change(s) | ${fmt(tally(ids, false))}  →  ${fmt(tally(ids, true))}`
    );
  }

  // ── Detail (names) — only to --report ──────────────────────────────────

  if (REPORT_PATH) {
    const out: string[] = [];
    out.push(`# House correction from the class tabs — ${AY}`, '');
    out.push(
      `Generated ${new Date().toISOString()} · ${APPLY ? 'APPLY' : 'DRY RUN'} · source \`${SOURCE}\``,
      ''
    );
    out.push(`## To change (${changes.length})`, '');
    out.push(
      '| Class | Student | Student no. | Sheet name | Tier | Now | Class tab |'
    );
    out.push('|---|---|---|---|---|---|---|');
    for (const c of [...changes].sort((a, b) =>
      (a.label + who(a.student)).localeCompare(b.label + who(b.student))
    )) {
      out.push(
        `| ${c.label} | ${who(c.student)} | ${c.student.student_number ?? ''} | ${c.rawName} | ${c.via} | ${hn(c.before)} | ${hn(c.after)} |`
      );
    }
    out.push('', `## Matched other than exact`, '');
    for (const m of good.filter((m) => m.via !== 'exact')) {
      const s = studentById.get(m.rosterRow.student_id)!;
      out.push(
        `- ${labelBySection.get(m.sectionId)}: sheet "${m.row.rawName}" → ${who(s)} (${m.via})`
      );
    }
    out.push('', `## Ambiguous — not assigned (${ambiguous.length})`, '');
    for (const a of ambiguous)
      out.push(
        `- [${a.row.tab}] "${a.row.rawName}" (${a.row.colour}) — ${a.why}`
      );
    out.push('', `## Unmatched sheet rows (${unmatched.length})`, '');
    for (const u of unmatched)
      out.push(
        `- [${u.row.tab}] "${u.row.rawName}" (${u.row.colour}) — ${u.hint}`
      );
    out.push(
      '',
      `## In a covered class but on no tab — NOT touched (${unclaimedCovered.length})`,
      ''
    );
    for (const r of unclaimedCovered) {
      const s = studentById.get(r.student_id)!;
      out.push(
        `- ${labelBySection.get(r.section_id)}: ${who(s)} (${s.student_number ?? ''}) — house ${hn(s.house_id)}`
      );
    }
    out.push(
      '',
      `## In classes no tab covers — NOT touched (${uncoveredAll.length})`,
      ''
    );
    for (const [sid, list] of uncoveredBySection) {
      out.push(`### ${labelBySection.get(sid)} (${list.length})`, '');
      for (const r of list) {
        const s = studentById.get(r.student_id)!;
        out.push(
          `- ${who(s)} (${s.student_number ?? ''}) — house ${hn(s.house_id)}`
        );
      }
      out.push('');
    }
    if (multiSection.length) {
      out.push(
        `## Active in more than one section (${multiSection.length})`,
        ''
      );
      for (const [id, l] of multiSection) {
        const s = studentById.get(id)!;
        out.push(
          `- ${who(s)}: ${l.map((sid) => labelBySection.get(sid)).join(', ')}`
        );
      }
    }
    writeFileSync(REPORT_PATH, out.join('\n') + '\n', 'utf8');
    console.log(`\nDetail (with names) written to the --report path.`);
  } else {
    console.log('\n(no --report path given — per-student detail not written)');
  }

  if (!APPLY) {
    console.log(
      `\nDRY RUN — nothing written. Re-run with --apply --actor <auth user uuid> to change ${changes.length} row(s).`
    );
    return;
  }

  // ── Apply ─────────────────────────────────────────────────────────────

  console.log(`\nApplying as ${actor!.email} (${actor!.role})…`);
  const auditRows: Parameters<typeof logActions>[2] = [];
  const skipped: string[] = [];
  for (const c of changes) {
    // Guard on the house we planned from: a change made by hand since the
    // dry run is kept, not overwritten.
    let q = svc
      .from('students')
      .update({ house_id: c.after })
      .eq('id', c.student.id);
    q = c.before == null ? q.is('house_id', null) : q.eq('house_id', c.before);
    const { data, error } = await q.select('id');
    if (error) throw new Error(`update ${c.student.id}: ${error.message}`);
    if (!data || data.length === 0) {
      skipped.push(c.student.id);
      continue;
    }
    const enroleeNumber = enroleeOf(c);
    auditRows.push({
      action: 'sis.house.update',
      entityType: 'enrolment_application',
      entityId: enroleeNumber,
      context: {
        enroleeNumber,
        studentNumber: c.student.student_number,
        student_id: c.student.id,
        before: c.before,
        after: c.after,
        before_name:
          c.before == null ? null : (houseNameById.get(c.before) ?? null),
        after_name: houseNameById.get(c.after) ?? null,
        source: SOURCE,
      },
    });
  }
  await logActions(svc, actor!, auditRows);
  console.log(
    `  ✅ ${auditRows.length} student(s) changed, ${auditRows.length} audit row(s) written`
  );
  if (skipped.length)
    console.log(
      `  ⚠ ${skipped.length} skipped — their house changed since the plan was read; re-run the dry run`
    );

  // Read back — prove the result rather than assume it.
  const readBack = new Map<string | null, number>();
  for (let i = 0; i < allActive.length; i += 100) {
    const { data, error } = await svc
      .from('students')
      .select('house_id')
      .in('id', allActive.slice(i, i + 100));
    if (error) throw new Error(`read-back failed: ${error.message}`);
    for (const s of (data ?? []) as { house_id: string | null }[])
      readBack.set(s.house_id, (readBack.get(s.house_id) ?? 0) + 1);
  }
  console.log(`\nRead back, all active ${AY} students: ${fmt(readBack)}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
