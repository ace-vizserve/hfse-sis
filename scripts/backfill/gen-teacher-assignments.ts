// scripts/backfill/gen-teacher-assignments.ts
//
// Generates teacher-assignments-{preview,apply}.sql from Mr Hanafi's
// "Teachers Deployment" workbook. Emits SQL for review — does NOT write to the
// database, exactly like the house and grading importers it is modelled on.
//
// Run (parse + report only, NO database, no credentials needed):
//   npx tsx scripts/backfill/gen-teacher-assignments.ts --parse-only
// Run (full — resolves against production and writes the SQL):
//   npx tsx --env-file=.env.local scripts/backfill/gen-teacher-assignments.ts
//
// ─────────────────────────────────────────────────────────────────────────
// WHY THIS EXISTS
//
// AY2026 has ZERO form advisers, which blocks report-card publishing school
// wide. That has been on hold waiting for this workbook.
//
// WHAT IT WILL NOT DO
//
// It does not guess. Three things in the workbook cannot be resolved by any
// rule and are REPORTED, not decided:
//
//   1. Sec 4 Excellence names TWO advisers ("Ms Med & Ms Elaine"). The schema
//      allows one per section — `teacher_assignments_form_adviser_unique` is on
//      `(section_id)` alone. Mr Ace's call, 2026-08-26: ask Mr Hanafi. Sec 4
//      gets no adviser row until he answers.
//   2. A subject shared between two teachers across different days — Sec 3
//      Humanities is Ms Elaine Tue/Fri and Ms Carl Wed. ⚠ THE WORKBOOK IS NOT
//      WRONG; all three sheets agree and this is ordinary timetabling. Our
//      migration 118 allows one subject teacher per (section, subject) because
//      a grading sheet has one owner (KD #158). So a TEACHER OF RECORD must be
//      named per class+subject. This script reports every such split and
//      refuses to pick.
//   3. Anyone with no account. No migration can create one (auth.users is
//      GoTrue-owned) and two teachers on the roster have no email at all.
import { writeFileSync } from 'node:fs';

import * as XLSX from 'xlsx';

import {
  classTokensIn,
  deriveClassIdentity,
  normaliseNickname,
  normaliseSectionName,
  parseClassMajorSheet,
  parseTeacherMajorSheet,
  type LessonCell,
  type NoTeacherCell,
} from '../../lib/sis/backfill/deployment/workbook';
import { createServiceClient } from '../../lib/supabase/service';
import { listAllAuthUsers } from '../../lib/supabase/paginate';

const WORKBOOK_PATH =
  'Teachers Deployment_Updated 29 Jun 26_Teacherscopy (1).xlsx';
const AY_CODE = 'AY2026';
const OUT_PREVIEW = 'scripts/backfill/teacher-assignments-preview.sql';
const OUT_APPLY = 'scripts/backfill/teacher-assignments-apply.sql';

const CLASS_MAJOR_SHEETS = ['Primary_New', 'Secondary_New'];
const TEACHER_MAJOR_SHEET = 'Final Update_New';
const PER_TEACHER_SHEETS = [
  'Mr Joseph',
  'Ms Jing',
  'Ms Jenny',
  'Ms Lhen',
  'Ms Med',
  'Ms J',
  'Ms Melissa',
];

/**
 * Nickname → school email.
 *
 * The workbook names teachers ONLY by nickname, punctuated inconsistently
 * (`Ms.Jing` / `Ms Jing`, `Ms J` / `Ms.J`, bare `Elaine`). The email on
 * `Teachers List` encodes the legal name as `firstname.lastname`, so resolving
 * the nickname to an email resolves it to a person.
 *
 * Entries carry a `why` only where the mapping is NOT obvious from the name —
 * a nickname that is simply a shortening of the listed name needs no defence.
 */
type NicknameEntry = { email: string | null; why?: string };

const NICKNAME_MAP: Record<string, NicknameEntry> = {
  // ── Secondary ──────────────────────────────────────────────────────────
  carl: {
    email: 'christine.sarmiento@hfse.edu.sg',
    why: 'Ms Christine Carl Sarmiento — "Carl" is her middle name, not a surname',
  },
  med: { email: 'medelyn.azucena@hfse.edu.sg' },
  jun: { email: 'jun.chong@hfse.edu.sg' },
  koh: { email: 'kohsuat.hoon@hfse.edu.sg' },
  j: {
    email: 'jocelyn.saguid@hfse.edu.sg',
    why: 'Ms J = Jocelyn Saguid. A single letter, so it can never be inferred',
  },
  elaine: {
    email: 'elaine.wee@hfse.edu.sg',
    why:
      'May Ling Elaine Wee — NOT Fong Mei Yin Elaine (elaine.fong@), who was ' +
      'named as a relief teacher on 2026-08-25, months after this 29 June ' +
      'workbook. Secondary_New R43C7 annotates a subject "(Secondary 3, ' +
      'AY2024 Elaine)", placing this Elaine here in AY2024',
  },
  chandana: { email: 'chandana.dileep@hfse.edu.sg' },
  tina: {
    email: 'natividad.laguyo@hfse.edu.sg',
    why: 'Ms Tina = Natividad Laguyo — nickname shares no letters with the name',
  },
  sharon: { email: 'sharonanne.menezes@hfse.edu.sg' },
  hanafi: { email: 'muhammad.hanafi@hfse.edu.sg' },

  // ── Primary ────────────────────────────────────────────────────────────
  jasmine: {
    email: null,
    why: 'Ms Jasmine Zhou Qi has NO email on Teachers List, so no account and no legal name',
  },
  li: {
    email: null,
    why: 'Ms Li Qun has NO email on Teachers List, so no account and no legal name',
  },
  kristel: { email: 'kristel.conado@hfse.edu.sg' },
  aida: {
    email: 'zuraidah.zainal@hfse.edu.sg',
    why: 'Ms Aida = Zuraidah Zainal — nickname is from the second half of "Zuraidah"',
  },
  jenny: { email: 'jenny.wong@hfse.edu.sg' },
  wai: { email: 'waichung.low@hfse.edu.sg' },
  shaf: { email: 'shafika.jasni@hfse.edu.sg' },
  parmi: { email: 'parmithaa.reddy@hfse.edu.sg' },
  mae: { email: 'mae.juni@hfse.edu.sg' },
  melissa: { email: 'melissa.balantac@hfse.edu.sg' },
  lhen: {
    email: 'lhen.mendoza@hfse.edu.sg',
    why: 'Teachers List writes it out: "Ms. Hermilita Mendoza (Ms. Lhen)"',
  },
  karen: { email: 'karengrace.ledbetter@hfse.edu.sg' },
  arlene: { email: 'arlene.raralio@hfse.edu.sg' },
  jing: { email: 'jing.lim@hfse.edu.sg' },
  radhika: { email: 'radhika.putrevu@hfse.edu.sg' },
  joseph: { email: 'joseph.ong@hfse.edu.sg' },
  jospeh: {
    email: 'joseph.ong@hfse.edu.sg',
    why: 'Roster typo for Joseph, present in Final Update_New C21. Kept so the typo resolves rather than being silently dropped',
  },

  // ── Not people ─────────────────────────────────────────────────────────
  'relief teacher': {
    email: null,
    why:
      'A ROLE the workbook staffs a slot with, not a name. Final Update_New ' +
      'gives it its own column (C27) covering Sec 3 English and Sec 1D2 ' +
      'English. Ms Fong Mei Yin Elaine (elaine.fong@) was named for exactly ' +
      'this on 2026-08-25, but she has no account yet and the workbook has ' +
      'never carried her name — so this stays unresolved here',
  },
  khim: {
    email: null,
    why: 'Heads the YoungStarters column in Final Update_New (C2) but appears NOWHERE on Teachers List. A 27th person, unaccounted for',
  },
};

/**
 * Workbook subject wording → our subject `code`.
 *
 * Codes are from `supabase/seed.sql`. ⚠ `HUM` vs `HIST` is not a choice this
 * map makes: `lib/sis/track-bundles.ts` swaps HIST→HUM at S3/S4, and the
 * workbook agrees (History in Sec 1–2, Humanities in Sec 3–4), so both map
 * straight through.
 */
const SUBJECT_MAP: Record<string, string | null> = {
  english: 'ENG',
  mathematics: 'MATH',
  mathermatics: 'MATH', // workbook typo, Final Update_New C28
  science: 'SCI',
  'science - biology': 'SCI',
  'science - chemistry': 'SCI',
  'science - chemisty': 'SCI', // workbook typo
  humanities: 'HUM',
  history: 'HIST',
  literature: 'LIT',
  economics: 'ECON',
  'global perspectives': 'GP',
  computing: 'COMP',
  ict: 'COMP',
  'contemporary art': 'CA',
  'art & design': 'ARTD',
  'art and design': 'ARTD',
  'arts and design': 'ARTD',
  'physical education and health': 'PEH',
  'pe and health': 'PEH',
  'pastoral ministry & personal development': 'PMPD',
  'pastoral ministry and personal development': 'PMPD',
  'pastrol ministry and personal development': 'PMPD', // workbook typo
  filipino: 'FIL',

  // STAR is our MAPEH — Mr Ace, 2026-08-26. The workbook writes it four ways.
  // ⚠ The parenthetical is unresolved and belongs to admin action item #4:
  // this workbook says "Sports, Talent, Arts and Rhythm" throughout, the admin
  // session recorded the approved name as "Sports, Talent, Arts, and
  // Research". That is a NAMING question, not a mapping one — either way the
  // subject is MAPEH.
  star: 'MAPEH',
  'star (sports, talent, arts and rhythm)': 'MAPEH',
  'star (sports, talent, arts and rhythm) [pe]': 'MAPEH',
  'star (sports, talent, arts & rhythm)': 'MAPEH',

  // Mother Tongue has categories and they differ by section — Mr Ace,
  // 2026-08-26. So the qualified forms map straight to the language.
  'mother tongue (filipino)': 'FIL',
  'mother tongue (mandarin)': 'MANDARIN',
  mandarin: 'MANDARIN',

  // ⚠ Bare "Mother Tongue" is the one that cannot be mapped from the cell
  // alone: it names the slot, not the language, and which language a section
  // takes is a property of the section. `MT` exists as a subject, so this
  // resolves against the SECTION's own subject list at resolution time rather
  // than being decided here — see resolveSubjectForSection.
  'mother tongue': null,
};

/**
 * Subject codes a bare "Mother Tongue" cell may resolve to, in the order they
 * are tried against the section's own subject list.
 */
const MOTHER_TONGUE_CANDIDATES = ['MT', 'FIL', 'MANDARIN'];

/**
 * ⚠ ONE SUBJECT THE CATALOGUE HOLDS UNDER TWO CODES, BECAUSE THE TWO CURRICULA
 * NAME IT DIFFERENTLY. Found 2026-08-27 by auditing sheets-without-a-teacher,
 * NOT by anything the generator reported — it wrote all five PE rows happily.
 *
 * `PEH` ("Physical Education and Health") is the Global/Cambridge subject and
 * carried every secondary class in AY2025. `PESTD` ("Physical Education") was
 * created 2026-07-16 with the rest of the AY2026 curriculum, and the STANDARD
 * classes moved to it — S1 Discipline 2, S2 Integrity 2, S3, S4 — while the
 * Global ones stayed on `PEH`. Both are PE. The split is the school's and is
 * deliberate; nothing here should try to collapse it.
 *
 * The workbook cannot express that, and should not have to: Mr Hanafi teaches
 * PE to the whole secondary school and writes "Physical Education and Health"
 * in every cell. A flat name→code map therefore lands every class on `PEH`,
 * which is right for two classes and wrong for three — and wrong SILENTLY,
 * because the row inserts cleanly against a subject the class does not run
 * while the mark sheet it should have claimed reads unstaffed.
 *
 * So the same principle as bare "Mother Tongue" applies, and for the same
 * reason: WHICH of these a class takes is a property of the SECTION, and the
 * school already answered it by creating that section's sheets. Ask the data.
 */
const EQUIVALENT_SUBJECT_CODES: string[][] = [['PEH', 'PESTD']];

/**
 * The two teachers the workbook writes with no title at all, so
 * `splitSubjectTeacher` may use its dash form for them and only them.
 * "Mother Tongue (Mandarin) - Jasmine" is the shape.
 */
const BARE_NAMES = new Set(['jasmine', 'li', 'elaine']);

const stripTitle = normaliseNickname;

const sqlStr = (v: string): string => `'${v.replace(/'/g, "''")}'`;

async function main() {
  const parseOnly = process.argv.includes('--parse-only');

  console.log(`Workbook: ${WORKBOOK_PATH}`);
  const wb = XLSX.readFile(WORKBOOK_PATH);
  console.log(`Sheets:   ${wb.SheetNames.length}\n`);

  // ── 1. Class-major sheets — the primary source ─────────────────────────
  const lessons: LessonCell[] = [];
  const advisers: { classRaw: string; teacherRaw: string; source: string }[] =
    [];
  const noTeacher: NoTeacherCell[] = [];
  const unparsed: { source: string; classRaw: string; text: string }[] = [];
  const classesSeen: string[] = [];

  for (const name of CLASS_MAJOR_SHEETS) {
    const ws = wb.Sheets[name];
    if (!ws) throw new Error(`missing sheet: ${name}`);
    const p = parseClassMajorSheet(name, ws, BARE_NAMES);
    lessons.push(...p.lessons);
    advisers.push(...p.advisers);
    noTeacher.push(...p.noTeacher);
    unparsed.push(...p.unparsed);
    for (const c of p.classes)
      if (!classesSeen.includes(c)) classesSeen.push(c);
    console.log(
      `  ${name.padEnd(16)} classes=${String(p.classes.length).padStart(2)}  ` +
        `lessons=${String(p.lessons.length).padStart(4)}  ` +
        `advisers=${String(p.advisers.length).padStart(3)}  ` +
        `noTeacher=${String(p.noTeacher.length).padStart(3)}  ` +
        `unparsed=${p.unparsed.length}`
    );
  }

  // ── 2. Teacher-major sheets — cross-check only ─────────────────────────
  const crossRows = [
    ...parseTeacherMajorSheet(
      TEACHER_MAJOR_SHEET,
      wb.Sheets[TEACHER_MAJOR_SHEET]
    ),
    ...PER_TEACHER_SHEETS.flatMap((n) =>
      wb.Sheets[n] ? parseTeacherMajorSheet(n, wb.Sheets[n], 1) : []
    ),
  ];
  const crossTeachers = new Set(crossRows.map((r) => stripTitle(r.teacherRaw)));
  console.log(
    `\n  cross-check rows=${crossRows.length} across ${crossTeachers.size} teacher columns`
  );

  // ── 3. Aggregate to unique (class, subject, teacher) ───────────────────
  type Pair = {
    classRaw: string;
    subjectRaw: string;
    teacherRaw: string;
    days: Set<string>;
    sources: string[];
  };
  const pairs = new Map<string, Pair>();
  for (const l of lessons) {
    const key = `${l.classRaw}|${l.subjectRaw.toLowerCase()}|${stripTitle(l.teacherRaw)}`;
    const p = pairs.get(key);
    if (p) {
      p.days.add(l.day);
      p.sources.push(l.source);
    } else {
      pairs.set(key, {
        classRaw: l.classRaw,
        subjectRaw: l.subjectRaw,
        teacherRaw: l.teacherRaw,
        days: new Set([l.day]),
        sources: [l.source],
      });
    }
  }
  console.log(`  unique class+subject+teacher pairs: ${pairs.size}`);

  // ── 4. The three things that are reported, never decided ───────────────
  console.log('\n═══ NEEDS A HUMAN DECISION ═══');

  // 4a. Two advisers on one class.
  // ⚠ Keyed on the NORMALISED nickname — the workbook writes "Ms.Melissa" and
  // "Ms Melissa" for the same person in the same class, which read as two
  // advisers until this was normalised. The display keeps the raw spelling.
  const adviserByClass = new Map<string, Map<string, string>>();
  for (const a of advisers) {
    const m = adviserByClass.get(a.classRaw) ?? new Map<string, string>();
    m.set(normaliseNickname(a.teacherRaw), a.teacherRaw);
    adviserByClass.set(a.classRaw, m);
  }
  const splitAdvisers = [...adviserByClass.entries()].filter(
    ([, m]) => m.size > 1 || [...m.values()].some((n) => /&|\band\b/i.test(n))
  );
  console.log(
    `\nA. Classes whose adviser is not one person: ${splitAdvisers.length}`
  );
  for (const [cls, who] of splitAdvisers) {
    console.log(`   ${cls}  =>  ${[...who.values()].join('  |  ')}`);
  }
  console.log(
    '   → one form_adviser per section is DB-enforced. These get NO adviser row.'
  );

  // 4b. A subject taught by more than one teacher in the same class.
  const teachersBySubject = new Map<string, Pair[]>();
  for (const p of pairs.values()) {
    const key = `${p.classRaw}|${p.subjectRaw.toLowerCase()}`;
    teachersBySubject.set(key, [...(teachersBySubject.get(key) ?? []), p]);
  }
  const shared = [...teachersBySubject.entries()].filter(
    ([, v]) => v.length > 1
  );
  console.log(
    `\nB. Class+subject taught by more than one teacher: ${shared.length}`
  );
  for (const [key, v] of shared) {
    const [cls, subj] = key.split('|');
    console.log(`   ${cls} — ${subj}`);
    for (const p of v) {
      console.log(
        `      ${p.teacherRaw.padEnd(14)} ${[...p.days].sort().join(',')}`
      );
    }
  }
  console.log(
    '   → NOT a workbook defect; ordinary timetabling. Migration 118 needs ONE\n' +
      '     teacher of record per (section, subject). Name them before applying.'
  );

  // 4c. Nicknames with no account behind them.
  const unknownNicknames = new Set<string>();
  const accountless = new Set<string>();
  for (const p of pairs.values()) {
    const nick = stripTitle(p.teacherRaw);
    const entry = NICKNAME_MAP[nick];
    if (!entry) unknownNicknames.add(p.teacherRaw);
    else if (!entry.email) accountless.add(nick);
  }
  console.log(`\nC. Nicknames not in NICKNAME_MAP: ${unknownNicknames.size}`);
  for (const n of unknownNicknames) console.log(`   ${n}`);
  console.log(
    `   Known but with no email/account: ${[...accountless].join(', ')}`
  );

  // 4d. Subjects with no mapping.
  const unmappedSubjects = new Set<string>();
  const deliberatelyUnmapped = new Set<string>();
  for (const p of pairs.values()) {
    const key = p.subjectRaw.toLowerCase();
    if (!(key in SUBJECT_MAP)) unmappedSubjects.add(p.subjectRaw);
    else if (SUBJECT_MAP[key] === null) deliberatelyUnmapped.add(p.subjectRaw);
  }
  console.log(`\nD. Subjects not in SUBJECT_MAP: ${unmappedSubjects.size}`);
  for (const s of unmappedSubjects) console.log(`   ${s}`);
  console.log(
    `   Mapped to null on purpose (need a decision): ${[...deliberatelyUnmapped].join(', ')}`
  );

  // 4e. Lessons with a subject but no teacher — a real staffing gap.
  const gapByClass = new Map<string, Set<string>>();
  for (const n of noTeacher) {
    const s = gapByClass.get(n.classRaw) ?? new Set<string>();
    s.add(n.subjectRaw);
    gapByClass.set(n.classRaw, s);
  }
  console.log(
    `\nE. Subjects timetabled with NO teacher named: ${noTeacher.length} cells ` +
      `across ${gapByClass.size} classes`
  );
  for (const [cls, subs] of gapByClass) {
    console.log(`   ${cls}`);
    console.log(`      ${[...subs].sort().join(' · ')}`);
  }
  console.log(
    '   → check Final Update_New before calling any of these a gap: the\n' +
      '     teacher-major sheet staffs some of them.'
  );

  if (unparsed.length > 0) {
    console.log(`\nF. Cells that could not be read at all: ${unparsed.length}`);
    for (const u of unparsed.slice(0, 25)) {
      console.log(`   ${u.source} ${JSON.stringify(u.text)}`);
    }
    if (unparsed.length > 25)
      console.log(`   … and ${unparsed.length - 25} more`);
  }

  console.log('\n═══ CLASSES FOUND ═══');
  for (const c of classesSeen) {
    const adv = adviserByClass.get(c);
    console.log(
      `   ${c.padEnd(50)} adviser: ${adv ? [...adv.values()].join(' | ') : '— NONE —'}`
    );
  }

  if (parseOnly) {
    console.log('\n--parse-only: stopping before any database access.');
    return;
  }

  // ── 5. Resolve against production ──────────────────────────────────────
  const service = createServiceClient();

  // The column is `ay_code`, not `code` (migration 001).
  const { data: ay, error: ayErr } = await service
    .from('academic_years')
    .select('id, ay_code')
    .eq('ay_code', AY_CODE)
    .single();
  if (ayErr) throw ayErr;

  const { data: sections, error: secErr } = await service
    .from('sections')
    .select('id, name, level_id, levels(code)')
    .eq('academic_year_id', ay.id);
  if (secErr) throw secErr;

  const { data: subjects, error: subErr } = await service
    .from('subjects')
    .select('id, code, name');
  if (subErr) throw subErr;
  const subjectByCode = new Map(
    (subjects ?? []).map((s: { id: string; code: string }) => [s.code, s])
  );

  // ⚠ Which language a class's "Mother Tongue" slot means is a property of the
  // SECTION, and the school already answered it — every section that teaches a
  // language has a grading sheet for it. So this is looked up rather than
  // asked: read the AY's sheets and see which of MT / Filipino / Mandarin each
  // section actually holds.
  const { data: sheets, error: sheetsErr } = await service
    .from('grading_sheets')
    .select('section_id, subject_id, terms!inner(academic_year_id)')
    .eq('terms.academic_year_id', ay.id);
  if (sheetsErr) throw sheetsErr;

  const subjectCodeById = new Map(
    (subjects ?? []).map((s: { id: string; code: string }) => [s.id, s.code])
  );
  const languagesBySection = new Map<string, Set<string>>();
  // Every subject code each section actually holds a sheet for. This is the
  // section's real curriculum, and it is what `EQUIVALENT_SUBJECT_CODES` is
  // checked against below.
  const sheetCodesBySection = new Map<string, Set<string>>();
  for (const row of sheets ?? []) {
    const r = row as unknown as { section_id: string; subject_id: string };
    const code = subjectCodeById.get(r.subject_id);
    if (!code) continue;
    const all = sheetCodesBySection.get(r.section_id) ?? new Set<string>();
    all.add(code);
    sheetCodesBySection.set(r.section_id, all);
    if (!MOTHER_TONGUE_CANDIDATES.includes(code)) continue;
    const set = languagesBySection.get(r.section_id) ?? new Set<string>();
    set.add(code);
    languagesBySection.set(r.section_id, set);
  }

  const users = await listAllAuthUsers(service);
  const userByEmail = new Map(
    users.filter((u) => !!u.email).map((u) => [u.email!.toLowerCase(), u])
  );

  console.log(
    `\nProduction: ${sections?.length ?? 0} ${AY_CODE} sections, ` +
      `${subjects?.length ?? 0} subjects, ${users.length} auth users`
  );

  // ── 6. Match workbook classes to live sections ─────────────────────────
  //
  // ⚠ Matched on LEVEL + NAME, never on name alone: section names repeat
  // across levels in this catalogue, and a near-miss puts a teacher in front of
  // the wrong children. Anything that does not match exactly is REPORTED, never
  // resolved by similarity.
  type LiveSection = { id: string; name: string; levelCode: string };
  const live: LiveSection[] = (sections ?? []).map((row) => {
    const r = row as unknown as {
      id: string;
      name: string;
      levels: { code: string } | { code: string }[] | null;
    };
    const lv = Array.isArray(r.levels) ? r.levels[0] : r.levels;
    return { id: r.id, name: r.name, levelCode: lv?.code ?? '??' };
  });
  const liveByKey = new Map(
    live.map((l) => [`${l.levelCode}|${normaliseSectionName(l.name)}`, l])
  );

  const sectionForClass = new Map<string, LiveSection>();
  const unmatchedClasses: { classRaw: string; guess: string }[] = [];
  for (const c of classesSeen) {
    const identity = deriveClassIdentity(c);
    if (!identity) {
      unmatchedClasses.push({ classRaw: c, guess: '(could not read a level)' });
      continue;
    }
    const hit = liveByKey.get(
      `${identity.levelCode}|${normaliseSectionName(identity.sectionName)}`
    );
    if (hit) sectionForClass.set(c, hit);
    else
      unmatchedClasses.push({
        classRaw: c,
        guess: `${identity.levelCode} ${identity.sectionName}`,
      });
  }

  console.log('\n═══ SECTION MATCHING ═══');
  console.log(
    `  matched ${sectionForClass.size} of ${classesSeen.length} workbook classes ` +
      `against ${live.length} live ${AY_CODE} sections`
  );
  if (unmatchedClasses.length > 0) {
    console.log(
      `\n  UNMATCHED (${unmatchedClasses.length}) — nothing is written for these:`
    );
    for (const u of unmatchedClasses) {
      console.log(`    ${u.classRaw.padEnd(50)} read as: ${u.guess}`);
    }
  }
  // ⚠ TWO WORKBOOK CLASSES RESOLVING TO ONE LIVE SECTION.
  //
  // `SECONDARY ONE DISCIPLINE 2 STANDARD` and `SECONDARY 1D2 (Cambridge)` are
  // separate timetables in the workbook — different advisers, different
  // teachers — but our catalogue holds ONE Sec 1 Discipline 2. Left alone this
  // emits two `form_adviser` rows for one section, and `on conflict do
  // nothing` silently keeps whichever the loop reached first. A silent,
  // order-dependent answer about who advises a class is the worst outcome
  // available, so both classes are dropped and reported instead.
  //
  // Whether Cambridge is a stream inside that section or a section we do not
  // model is a school question, not something a name match can decide.
  const classesBySection = new Map<string, string[]>();
  for (const [cls, sec] of sectionForClass) {
    classesBySection.set(sec.id, [
      ...(classesBySection.get(sec.id) ?? []),
      cls,
    ]);
  }
  const collisions = [...classesBySection.entries()].filter(
    ([, list]) => list.length > 1
  );
  for (const [secId, list] of collisions) {
    const sec = live.find((l) => l.id === secId);
    console.log(
      `\n  ⚠ COLLISION — ${list.length} workbook classes resolve to ` +
        `${sec?.levelCode} ${sec?.name}:`
    );
    for (const cls of list) console.log(`      ${cls}`);
    console.log(
      '    Nothing is written for any of them. Either they are one class and\n' +
        '    the timetables need merging, or the catalogue is missing a section.'
    );
    for (const cls of list) sectionForClass.delete(cls);
  }

  // ⚠ The reverse direction, and only this one finds a class the workbook
  // forgot. A section with no adviser is exactly what blocks report cards.
  const claimed = new Set([...sectionForClass.values()].map((l) => l.id));
  const untouched = live.filter((l) => !claimed.has(l.id));
  if (untouched.length > 0) {
    console.log(
      `\n  LIVE SECTIONS THE WORKBOOK NEVER NAMES (${untouched.length}):`
    );
    for (const l of untouched) {
      console.log(`    ${l.levelCode.padEnd(4)} ${l.name}`);
    }
  }

  // ── 7. Resolve to rows ─────────────────────────────────────────────────
  type Row = {
    teacherId: string;
    sectionId: string;
    subjectId: string | null;
    role: string;
    why: string;
  };
  let rows: Row[] = [];
  const skipped: string[] = [];
  // Rows written against a different subject code than the cell's text mapped
  // to. Reported rather than silent — a re-pointed subject is still a decision.
  const repointed: string[] = [];

  const resolveTeacher = (raw: string): string | null => {
    const entry = NICKNAME_MAP[stripTitle(raw)];
    if (!entry?.email) return null;
    return userByEmail.get(entry.email.toLowerCase())?.id ?? null;
  };

  // Advisers — the PRIMARY only. A class naming two people gets none: Mr Ace's
  // call, 2026-08-26, ask Mr Hanafi rather than pick.
  for (const [cls, whoMap] of adviserByClass) {
    const sec = sectionForClass.get(cls);
    if (!sec) continue;
    const names = [...whoMap.values()];
    if (names.length > 1 || names.some((n) => /&|\band\b/i.test(n))) {
      skipped.push(
        `adviser ${cls} — names more than one person: ${names.join(' | ')}`
      );
      continue;
    }
    const teacherId = resolveTeacher(names[0]);
    if (!teacherId) {
      skipped.push(`adviser ${cls} — no account for "${names[0]}"`);
      continue;
    }
    rows.push({
      teacherId,
      sectionId: sec.id,
      subjectId: null,
      role: 'form_adviser',
      why: `${cls} — ${names[0]}`,
    });
  }

  // Subject teachers — one owner per (section, subject). A shared subject is
  // skipped whole: which of the two owns the sheet is a staffing decision, and
  // migration 124 gives the other one a co_teacher row once that is answered.
  for (const [key, group] of teachersBySubject) {
    const [cls, subjLower] = key.split('|');
    const sec = sectionForClass.get(cls);
    if (!sec) continue;
    const code = SUBJECT_MAP[subjLower];
    if (code === undefined) {
      skipped.push(`${cls} — "${group[0].subjectRaw}" is not in SUBJECT_MAP`);
      continue;
    }
    // A bare "Mother Tongue" cell names the slot, not the language. Resolve it
    // from the section's own grading sheets — if it holds exactly one of the
    // three, that is the answer and nobody needs to be asked.
    let resolvedCode: string = code ?? '';
    if (code === null) {
      const held = [...(languagesBySection.get(sec.id) ?? [])];
      if (held.length === 1) {
        resolvedCode = held[0];
      } else {
        skipped.push(
          `${cls} — "${group[0].subjectRaw}": section holds ` +
            (held.length === 0
              ? 'no language sheet'
              : `${held.length} language sheets (${held.join(', ')})`) +
            ' — cannot tell which language this slot means'
        );
        continue;
      }
    }
    // ⚠ The class may take this subject under the OTHER curriculum's code —
    // see EQUIVALENT_SUBJECT_CODES. Only re-point when the section genuinely
    // does not hold the mapped code, so nothing that already matches moves.
    const held = sheetCodesBySection.get(sec.id);
    if (held && !held.has(resolvedCode)) {
      const family = EQUIVALENT_SUBJECT_CODES.find((f) =>
        f.includes(resolvedCode)
      );
      const alternatives = (family ?? []).filter(
        (c) => c !== resolvedCode && held.has(c)
      );
      if (alternatives.length === 1) {
        repointed.push(
          `${cls} — ${group[0].subjectRaw}: ${resolvedCode} → ${alternatives[0]} ` +
            `(this class runs ${alternatives[0]}, not ${resolvedCode})`
        );
        resolvedCode = alternatives[0];
      } else if (alternatives.length > 1) {
        skipped.push(
          `${cls} — ${group[0].subjectRaw}: section holds ${alternatives.join(
            ' and '
          )} — cannot tell which one this cell means`
        );
        continue;
      }
      // No family, or the family has nothing here either: leave it alone. A
      // subject taught but never graded (PMPD) has no sheet anywhere and is
      // still a true assignment.
    }
    const subject = subjectByCode.get(resolvedCode);
    if (!subject) {
      skipped.push(
        `${cls} — subject code ${resolvedCode} is not in the registry`
      );
      continue;
    }
    if (group.length > 1) {
      skipped.push(
        `${cls} — ${group[0].subjectRaw}: shared by ` +
          group.map((g) => g.teacherRaw).join(' + ') +
          ' — name the teacher of record'
      );
      continue;
    }
    const teacherId = resolveTeacher(group[0].teacherRaw);
    if (!teacherId) {
      skipped.push(
        `${cls} — ${group[0].subjectRaw}: no account for "${group[0].teacherRaw}"`
      );
      continue;
    }
    rows.push({
      teacherId,
      sectionId: sec.id,
      subjectId: subject.id,
      role: 'subject_teacher',
      why: `${cls} — ${group[0].subjectRaw} — ${group[0].teacherRaw}`,
    });
  }

  // ── 7b. One row per sheet ──────────────────────────────────────────────
  //
  // ⚠ THE SHARED-SUBJECT CHECK ABOVE GROUPS BY THE RAW CELL TEXT, so it misses
  // a subject the workbook spells two ways. `Secondary_New` writes both "Arts
  // and Design" and "Art and Design" for Sec 1 Discipline 1, and `Primary_New`
  // writes "STAR" and "STAR (Sports, Talent, Arts and Rhythm) [PE]" for P6
  // Grit. Each pair is one subject taught by one person, but they arrive as two
  // groups and leave as two rows for the same sheet — which
  // `teacher_assignments_person_once_per_sheet` (migration 124) rejects, taking
  // the whole insert down with it.
  //
  // Regrouping on the RESOLVED subject id also catches the more dangerous
  // version: two DIFFERENT teachers under two spellings, which the raw grouping
  // reads as two unshared subjects. That is a shared sheet, and it gets the
  // same treatment as any other — dropped, and reported for a human.
  const bySheet = new Map<string, typeof rows>();
  for (const r of rows) {
    if (r.role !== 'subject_teacher') continue;
    const key = `${r.sectionId}|${r.subjectId}`;
    bySheet.set(key, [...(bySheet.get(key) ?? []), r]);
  }
  const dropped = new Set<(typeof rows)[number]>();
  for (const [, group] of bySheet) {
    if (group.length < 2) continue;
    const teachers = new Set(group.map((g) => g.teacherId));
    if (teachers.size === 1) {
      // Same person, two spellings. Keep the first, drop the rest silently —
      // there is no decision here for anyone to make.
      for (const r of group.slice(1)) dropped.add(r);
    } else {
      for (const r of group) dropped.add(r);
      skipped.push(
        `${group[0].why.split(' — ')[0]} — one subject spelled more than one ` +
          `way and shared: ${group.map((g) => g.why).join(' | ')} — name the ` +
          `teacher of record`
      );
    }
  }
  if (dropped.size > 0) {
    rows = rows.filter((r) => !dropped.has(r));
  }

  console.log('\n═══ WRITABLE ═══');
  console.log(
    `  ${rows.length} rows  ` +
      `(${rows.filter((r) => r.role === 'form_adviser').length} advisers, ` +
      `${rows.filter((r) => r.role === 'subject_teacher').length} subject teachers)`
  );
  console.log(`  ${skipped.length} skipped:`);
  for (const sk of skipped) console.log(`    ${sk}`);
  if (repointed.length > 0) {
    console.log(
      `\n  ${repointed.length} written against the class's OWN code for the ` +
        `subject:`
    );
    for (const rp of repointed) console.log(`    ${rp}`);
  }

  // ── 8. SQL ─────────────────────────────────────────────────────────────
  //
  // Idempotent: the two unique indexes are the conflict targets, so a re-run
  // adds nothing. NOTHING IS DELETED — an assignment already in place is a
  // staffing fact somebody entered, and not this script's to revoke.
  // ⚠ The comment goes ABOVE its row, never trailing it. A trailing `--`
  // comment swallows the comma that `join` puts at the end of the line, so
  // every row after the first began with `(` and no separator — Postgres
  // answered "syntax error at or near (" and the whole file was unrunnable.
  const values = rows
    .map(
      (r) =>
        `  -- ${r.why.replace(/\s+/g, ' ')}\n` +
        `  (${sqlStr(r.teacherId)}::uuid, ${sqlStr(r.sectionId)}::uuid, ` +
        `${r.subjectId ? `${sqlStr(r.subjectId)}::uuid` : 'null'}, ` +
        `${sqlStr(r.role)})`
    )
    .join(',\n');

  const header =
    `-- AY2026 teacher assignments, generated from\n` +
    `-- ${WORKBOOK_PATH}\n` +
    `-- ${rows.length} rows. ${skipped.length} skipped — see the generator report.\n` +
    `--\n` +
    `-- Not included, deliberately:\n` +
    skipped.map((sk) => `--   ${sk.replace(/\s+/g, ' ')}`).join('\n') +
    `\n`;

  const body =
    rows.length === 0
      ? '-- nothing to write\n'
      : `insert into public.teacher_assignments\n` +
        `  (teacher_user_id, section_id, subject_id, role)\nvalues\n${values}\n` +
        `on conflict do nothing;\n`;

  writeFileSync(
    OUT_PREVIEW,
    `${header}\nbegin;\n\n${body}\n-- review the counts above, then run the apply file\nrollback;\n`,
    'utf8'
  );
  writeFileSync(OUT_APPLY, `${header}\nbegin;\n\n${body}\ncommit;\n`, 'utf8');
  console.log(`\nWrote ${OUT_PREVIEW}`);
  console.log(`Wrote ${OUT_APPLY}`);

  void classTokensIn;
  void crossTeachers;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
