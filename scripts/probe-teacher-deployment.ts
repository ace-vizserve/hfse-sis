// scripts/probe-teacher-deployment.ts
//
// Read-only. WRITES NOTHING. This is the review gate before any teaching
// assignment is created from the school's deployment workbook
// (`Teachers Deployment_Updated 29 Jun 26_Teacherscopy.xlsx`, sheet
// `Final Update_New`).
//
// WHY A PROBE AND NOT AN IMPORT. The workbook is a printed timetable, not a
// data file. Cells are free text written for a human eye:
//
//     P5 Commitment English Mon        (no separator)
//     Sec2 I2 Mathermatics  Wed        (typo, inconsistent spacing)
//     Sec 1D1 Computing 1:30           (time embedded in the cell)
//     P4 Trust STAR (Sports, Talent, Arts and Rhythm) (Tu, W)  P5 Commitment
//                                      (two classes in one cell)
//
// A parser confident enough to read those is confident enough to invent a
// teaching assignment that nobody made, and a wrong assignment is invisible —
// it looks exactly like a right one until a teacher opens a class that is not
// hers. So this script resolves what it can, REFUSES what it cannot, and
// prints both lists for a human to read.
//
// ⚠ THE ASSEMBLY ROW IS THE RELIABLE PART. Each teacher's 08:15–08:30 cell
// names exactly one class ("Assembly - P1 Patience"), and a second assembly
// row at 13:15 covers the afternoon classes. That is a form-adviser register:
// 20 advisers, 20 distinct classes, one signal each, no parsing beyond
// stripping the word "Assembly". Everything else in the grid is weaker
// evidence and is reported separately, never mixed in.
//
// Run:
//   npx tsx --env-file=.env.local scripts/probe-teacher-deployment.ts
//   npx tsx --env-file=.env.local scripts/probe-teacher-deployment.ts --ay=AY2026
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import * as XLSX from 'xlsx';

import { createServiceClient } from '../lib/supabase/service';
import { listAllAuthUsers } from '../lib/supabase/paginate';

const WORKBOOK = resolve(
  import.meta.dirname,
  '..',
  'Teachers Deployment_Updated 29 Jun 26_Teacherscopy.xlsx'
);
const SHEET = 'Final Update_New';

// ─── Short name → account ─────────────────────────────────────────────────
// HAND-WRITTEN ON PURPOSE. Fuzzy matching was rejected: "Ms. Elaine" and the
// relief teacher "Elaine" are different people, and any edit-distance scheme
// close enough to catch the source's own typo ("Mr Jospeh" for Joseph Ong)
// is also close enough to confuse them. An explicit table is auditable; a
// similarity threshold is not.
//
// `null` means DELIBERATELY UNRESOLVED — the name is in the timetable and we
// do not know who it is. Those are reported, never guessed.
const ALIASES: Record<string, string | null> = {
  // Keys are matched AFTER whitespace collapsing, so the source's double space
  // in "Ms. Kristel  (AM)" is written single here.
  'Ms. Kristel (AM)': 'kristel.conado@hfse.edu.sg',
  'Ms Jenny (AM)': 'jenny.wong@hfse.edu.sg',
  'Mr. Wai (AM)': 'waichung.low@hfse.edu.sg',
  'Ms Parmi': 'parmithaa.reddy@hfse.edu.sg',
  'Ms. Mae': 'mae.juni@hfse.edu.sg',
  'Ms. Melissa': 'melissa.balantac@hfse.edu.sg',
  'Ms. Lhen': 'lhen.mendoza@hfse.edu.sg',
  'Ms Karen': 'karengrace.ledbetter@hfse.edu.sg',
  'Ms Arlene (AM)': 'arlene.raralio@hfse.edu.sg',
  'Ms. Jing': 'jing.lim@hfse.edu.sg',
  'Ms Radhika': 'radhika.putrevu@hfse.edu.sg',
  'Ms Carl': 'christine.sarmiento@hfse.edu.sg',
  'Ms. Med': 'medelyn.azucena@hfse.edu.sg',
  'Mr Jun': 'jun.chong@hfse.edu.sg',
  'Ms. Koh': 'kohsuat.hoon@hfse.edu.sg',
  'Ms.J': 'jocelyn.saguid@hfse.edu.sg',
  'Ms. Chandana': 'chandana.dileep@hfse.edu.sg',
  'Ms Sharon': 'sharonanne.menezes@hfse.edu.sg',
  'Mr Hanafi': 'muhammad.hanafi@hfse.edu.sg',

  // The source spells Joseph Ong's given name wrong. Recorded rather than
  // corrected, because the key has to match the workbook byte for byte.
  'Mr Jospeh': 'joseph.ong@hfse.edu.sg',

  // ⚠ Shares a column with a relief teacher ("Ms Shaf/Relief") and advises
  // P2 Honesty. Only one form adviser per section is allowed, so somebody has
  // to decide which of the two it is. Mapped to Shafika because she is the
  // named person; flagged below regardless.
  'Ms Shaf/Relief': 'shafika.jasni@hfse.edu.sg',

  // ⚠ AMBIGUOUS, resolved by POSITION and worth a second opinion. Two Elaines
  // hold accounts: May Ling Elaine Wee (Secondary) and Fong Mei Yin Elaine
  // (Relief). This column sits inside the secondary block, so it reads as Wee.
  'Ms. Elaine': 'elaine.wee@hfse.edu.sg',

  // ⚠ THE ONE TO CHECK BEFORE WRITING ANYTHING. "Ms Tina" advises Sec 2I1 and
  // teaches Science. Two candidates, and the evidence splits:
  //   • Christina Labrador — her account is literally tin.labrador@, but she
  //     holds `school_admin` and is absent from the workbook's Teachers List.
  //   • Natividad Laguyo — IS on the Teachers List as a Secondary teacher, and
  //     appears NOWHERE ELSE in this timetable, which is odd for a deployed
  //     teacher.
  // Left unresolved. Guessing here mis-assigns a whole form class.
  'Ms Tina': null,

  // On the Teachers List, no email supplied — no account can exist yet.
  'Ms. Jasmine': null,
  'Ms. Li': null,

  // Zuraidah Zainal, confirmed by Mr Ace 2026-09-09. Worth recording rather
  // than silently mapping: she is on the Teachers List under her full name and
  // in the timetable under a syllable of it, so neither list alone connects
  // them and no string comparison would have.
  'Ms Aida': 'zuraidah.zainal@hfse.edu.sg',

  // In the timetable, on no roster, matched to nobody.
  'Ms. Khim': null,
  'Relief Teacher': null,
};

type Sec = {
  id: string;
  name: string;
  academic_year_id: string;
  levels: { code: string } | { code: string }[] | null;
};

const levelCodeOf = (s: Sec) =>
  (Array.isArray(s.levels) ? s.levels[0] : s.levels)?.code ?? '??';

/** "P3 Courageous" → "P3"; "Sec 2I2" → "S2"; "Sec 4" → "S4". */
function levelTokenOf(label: string): string | null {
  const p = label.match(/^P\s*([1-6])/i);
  if (p) return `P${p[1]}`;
  const s = label.match(/^Sec\s*([1-4])/i);
  if (s) return `S${s[1]}`;
  return null;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Strip everything the SIS does not model.
 *
 * ⚠ `teacher_assignments` has NO TIME DIMENSION — it is (teacher, section,
 * subject, role) and nothing else. So every clock time, day name and day
 * abbreviation in these cells is noise, not difficulty. Treating it as
 * difficulty is what made an earlier pass call `P4 Trust STAR (Tu, W) P5
 * Commitment - STAR (Th F)` unparseable; drop the days and it is plainly two
 * assignments of the same subject to two classes.
 *
 * Order matters: clock times before day letters, or the `F` in a time range
 * survives as a phantom Friday.
 */
function stripSchedule(text: string): string {
  return (
    text
      // 8:30 - 9:15, (10:45 - 11:45), `10:30
      .replace(
        /`?\d{1,2}:\d{2}\s*(?:[-–]\s*\d{1,2}:\d{2})?\s*(?:am|pm)?/gi,
        ' '
      )
      // Full and short day names, including the run-together "MTW" and the
      // bare single letters the sheet uses (Mo, Tu, W, Th, F).
      .replace(
        /\b(mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|mon|tues?|wed|thurs?|thu|fri|mtw|mo|tu|th|fr|w|f|m)\b/gi,
        ' '
      )
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * The secondary stream shorthand, expanded.
 *
 * The school writes `Sec 1D1` / `Sec 2I2`; the sections are named
 * `Discipline 1` / `Integrity 2`. That is the sheet's own vocabulary — the
 * `Secondary_New` tab spells the headers out in full ("SECONDARY ONE
 * DISCIPLINE") — so this is a rule the school already stated, not a guess at
 * what a letter might stand for. Applied only to the tail AFTER the level
 * token, so a stray D or I elsewhere in a label cannot trigger it.
 */
function expandStream(tail: string): string {
  return tail
    .replace(/^\s*D\s*(\d)\b/i, 'Discipline $1')
    .replace(/^\s*I\s*(\d)\b/i, 'Integrity $1');
}

async function main() {
  const ayArg = process.argv
    .find((a) => a.startsWith('--ay='))
    ?.slice('--ay='.length)
    .toUpperCase();

  const service = createServiceClient();

  // ── Load the grid ────────────────────────────────────────────────────────
  const wb = XLSX.read(readFileSync(WORKBOOK), { type: 'buffer' });
  const ws = wb.Sheets[SHEET];
  if (!ws) throw new Error(`Sheet "${SHEET}" not found in ${WORKBOOK}`);
  const grid = XLSX.utils.sheet_to_json<string[]>(ws, {
    header: 1,
    raw: false,
    defval: '',
  });

  const clean = (v: unknown) =>
    String(v ?? '')
      .replace(/\s+/g, ' ')
      .trim();

  // Row index 2 carries the teacher short names. Columns 0/1 are the time and
  // duration; column 23 is the secondary block's own time column.
  const header = (grid[2] ?? []).map(clean);
  const teacherCols = header
    .map((name, col) => ({ name, col }))
    .filter(({ name, col }) => name && col !== 0 && col !== 1 && col !== 23);

  // ── Extract ──────────────────────────────────────────────────────────────
  const advisers: { teacher: string; classLabel: string }[] = [];
  const subjectCells: { teacher: string; text: string }[] = [];

  for (const row of grid.slice(3)) {
    for (const { name, col } of teacherCols) {
      const v = clean(row?.[col]);
      if (!v) continue;
      const assembly = v.match(/^Assembly\s*[-–]?\s*(.+)$/i);
      if (assembly) {
        advisers.push({ teacher: name, classLabel: clean(assembly[1]) });
        continue;
      }
      if (/^(break|lunch|cca|ys)\b/i.test(v)) continue;
      subjectCells.push({ teacher: name, text: v });
    }
  }

  // ── Resolve against the database ─────────────────────────────────────────
  const users = await listAllAuthUsers(service);
  const userByEmail = new Map(
    users
      .filter((u) => u.email)
      .map((u) => [u.email!.toLowerCase(), u] as const)
  );

  const { data: ays } = await service
    .from('academic_years')
    .select('id, ay_code')
    .order('ay_code', { ascending: false });
  const ayList = (ays ?? []) as { id: string; ay_code: string }[];
  const ay = ayArg
    ? ayList.find((a) => a.ay_code === ayArg)
    : (ayList[0] ?? null);
  if (!ay) throw new Error(`No academic year${ayArg ? ` ${ayArg}` : ''}`);

  const { data: sectionRows } = await service
    .from('sections')
    .select('id, name, academic_year_id, levels(code)')
    .eq('academic_year_id', ay.id);
  const sections = (sectionRows ?? []) as unknown as Sec[];

  const { data: subjectRows } = await service
    .from('subjects')
    .select('id, code, name');
  const subjects = (subjectRows ?? []) as {
    id: string;
    code: string;
    name: string;
  }[];

  // ⚠ The newest AY is not the live one. AY2027 exists as a nearly-empty
  // rollover shell, so defaulting to the highest ay_code silently probes a year
  // with one section and reports every class as missing. Print the whole list
  // with section counts so a wrong default is obvious rather than confusing.
  const counts = new Map<string, number>();
  const { data: allSections } = await service
    .from('sections')
    .select('academic_year_id');
  for (const s of (allSections ?? []) as { academic_year_id: string }[]) {
    counts.set(s.academic_year_id, (counts.get(s.academic_year_id) ?? 0) + 1);
  }
  console.log('Academic years available:');
  for (const a of ayList) {
    const n = counts.get(a.id) ?? 0;
    console.log(
      `  ${a.ay_code}  ${String(n).padStart(3)} sections${a.id === ay.id ? '   ← probing this one' : ''}`
    );
  }
  console.log(
    ayArg ? '' : '  (no --ay given; pass --ay=AY2026 to probe the live year)\n'
  );

  console.log(`Academic year : ${ay.ay_code}`);
  console.log(`Sections       : ${sections.length}`);
  console.log(`Subjects       : ${subjects.length}`);
  console.log(`Accounts       : ${users.length}`);
  console.log(`Subject names  : ${subjects.map((s) => s.name).join(', ')}\n`);

  // A class label resolves only when its level token matches AND exactly one
  // section in that level has a name contained in the label. Anything else is
  // reported rather than picked — "Sec 3" matching three sections is not a
  // match, it is a question.
  function resolveSection(label: string) {
    const lvl = levelTokenOf(label);
    if (!lvl) return { ok: false as const, why: 'no level token' };
    const inLevel = sections.filter((s) => levelCodeOf(s) === lvl);
    if (inLevel.length === 0)
      return { ok: false as const, why: `no sections at level ${lvl}` };
    // Match against the stream-expanded tail, so `Sec 1D1` can find
    // `Discipline 1`.
    const tail = label.replace(/^(P\s*[1-6]|Sec\s*[1-4])/i, '');
    const matchable = `${label} ${expandStream(tail)}`;
    const hits = inLevel.filter((s) => norm(matchable).includes(norm(s.name)));
    if (hits.length === 1) return { ok: true as const, section: hits[0] };
    if (hits.length === 0 && inLevel.length === 1)
      return { ok: true as const, section: inLevel[0] };
    if (hits.length > 1)
      return {
        ok: false as const,
        why: `ambiguous: ${hits.map((h) => h.name).join(', ')}`,
      };
    return {
      ok: false as const,
      why: `no name match among ${inLevel.map((s) => s.name).join(', ')}`,
    };
  }

  // ── 1. Form advisers ─────────────────────────────────────────────────────
  console.log('═══ 1. FORM ADVISERS (the reliable signal) ═══\n');
  const ready: string[] = [];
  const blocked: string[] = [];

  for (const { teacher, classLabel } of advisers) {
    const email = ALIASES[teacher];
    const sec = resolveSection(classLabel);
    const who =
      email === undefined
        ? 'NOT IN ALIAS TABLE'
        : email === null
          ? 'deliberately unresolved'
          : userByEmail.has(email)
            ? email
            : `${email} — NO ACCOUNT`;

    const line = `${classLabel.padEnd(22)} ${teacher.padEnd(20)} ${who}`;
    if (email && userByEmail.has(email) && sec.ok) {
      ready.push(`  ✓ ${line}  →  section ${sec.section.id}`);
    } else {
      blocked.push(`  ✗ ${line}${sec.ok ? '' : `  [class: ${sec.why}]`}`);
    }
  }

  console.log(`WRITEABLE (${ready.length}):`);
  ready.forEach((l) => console.log(l));
  console.log(`\nBLOCKED (${blocked.length}):`);
  blocked.forEach((l) => console.log(l));

  // ⚠ The counts do not have to agree, and when they disagree it matters. The
  // workbook names one adviser per class it deploys; the database holds every
  // section that exists. A section the timetable never mentions has no adviser
  // NAMED ANYWHERE — which is a real gap in the deployment, not a parsing
  // failure, and is invisible if you only read the list above.
  const coveredSectionIds = new Set<string>();
  for (const { classLabel } of advisers) {
    const r = resolveSection(classLabel);
    if (r.ok) coveredSectionIds.add(r.section.id);
  }
  const uncovered = sections.filter((s) => !coveredSectionIds.has(s.id));
  console.log(
    `\nSECTIONS THE WORKBOOK NAMES NO ADVISER FOR (${uncovered.length} of ${sections.length}):`
  );
  if (uncovered.length === 0) console.log('  (none)');
  uncovered.forEach((s) =>
    console.log(`  ${levelCodeOf(s).padEnd(4)} ${s.name}`)
  );

  // ── 1b. What the database holds RIGHT NOW ────────────────────────────────
  // The list above is what the workbook PROPOSES. This is what is actually
  // stored. They are different questions, and conflating them is how you end
  // up reporting a class as advised when nothing has been written yet.
  const { data: existing } = await service
    .from('teacher_assignments')
    .select('section_id, teacher_user_id')
    .eq('role', 'form_adviser')
    .in(
      'section_id',
      sections.map((s) => s.id)
    );
  const currentBySection = new Map(
    ((existing ?? []) as { section_id: string; teacher_user_id: string }[]).map(
      (r) => [r.section_id, r.teacher_user_id]
    )
  );
  const emailById = new Map(users.map((u) => [u.id, u.email ?? '(no email)']));

  console.log('\n═══ 1b. FORM ADVISERS STORED TODAY ═══\n');
  const proposedBySection = new Map<string, string>();
  for (const { teacher, classLabel } of advisers) {
    const r = resolveSection(classLabel);
    if (r.ok) proposedBySection.set(r.section.id, teacher);
  }
  for (const s of [...sections].sort((a, b) =>
    `${levelCodeOf(a)}${a.name}`.localeCompare(`${levelCodeOf(b)}${b.name}`)
  )) {
    const cur = currentBySection.get(s.id);
    const curLabel = cur ? emailById.get(cur) : 'NONE';
    const prop = proposedBySection.get(s.id) ?? '—';
    console.log(
      `  ${levelCodeOf(s).padEnd(4)} ${s.name.padEnd(16)} stored: ${String(curLabel).padEnd(34)} workbook: ${prop}`
    );
  }
  console.log(
    `\n  ${currentBySection.size} of ${sections.length} sections have a stored form adviser.`
  );

  // ── 2. Subject cells ─────────────────────────────────────────────────────
  // Counted and sampled, NOT parsed into assignments. The point of this
  // section is to show how much of the grid is well-formed enough to be worth
  // importing at all — that is the decision it exists to inform.
  console.log('\n═══ 2. SUBJECT CELLS (evidence, not assignments) ═══\n');

  // ⚠ MEASURE THE DATA, NOT THE PARSER. The first cut of this required a
  // spaced hyphen between class and subject and reported 23 of 128 cells
  // usable — but most cells simply have no separator ("P2 Honesty English"),
  // so that number described the regex rather than the workbook. What matters
  // is whether a cell names a class and a subject that actually EXIST, and how
  // many of each. So: look for every real section name and every real subject
  // name occurring anywhere in the cell.
  //
  // A cell naming exactly one of each is an assignment. A cell naming two
  // classes ("P4 Trust STAR (Tu, W) P5 Commitment - STAR (Th F)") is two
  // assignments and cannot be split without deciding which subject belongs to
  // which class. That distinction is the whole question, so it is counted
  // rather than glossed.
  // How many sections each level has. A level with exactly ONE section can be
  // named by its level alone — the sheet writes "Sec 3 Science" and "Sec 4
  // Contemporary Art" with no virtue name, because there is only one of each.
  // The adviser resolver already allowed this; the subject pass did not, which
  // is what made 17 cells look like they named no class at all.
  const perLevel = new Map<string, number>();
  for (const s of sections)
    perLevel.set(levelCodeOf(s), (perLevel.get(levelCodeOf(s)) ?? 0) + 1);

  // The school's own words for two subjects. STAR ("Sports, Talent, Arts and
  // Rhythm") is what the timetable calls MAPEH throughout, and the sheet
  // misspells two others. Written out rather than fuzzy-matched, same reason as
  // the teacher aliases.
  const SUBJECT_ALIASES: Record<string, string[]> = {
    MAPEH: ['star'],
    Mathematics: ['mathermatics'],
    'Pastoral Ministry and Personal Development': ['pastrolministry'],
    'Mother Tongue': ['mothertingue'],
  };
  // ⚠ "Homeroom and Values Education" is NOT in this table on purpose. It
  // appears in eleven cells and is not a subject in `subjects` — it is the form
  // adviser's own pastoral period, already represented by the form_adviser row.
  // Aliasing it to something would invent a subject teacher for a subject the
  // school does not grade.
  //
  // "MTW" is also left alone. It reads as Mother Tongue in Ms. Jasmine's and
  // Ms. Li's cells and as Mon/Tue/Wed everywhere else — including one cell that
  // uses both. Neither of those two teachers has an account (no email on the
  // roster), so resolving it would produce assignments that cannot be written
  // anyway.
  const subjectKeys = subjects.map((s) => ({
    name: s.name,
    keys: [norm(s.name), ...(SUBJECT_ALIASES[s.name] ?? []).map(norm)],
  }));

  const sectionLabels = sections.map((s) => ({
    label: `${levelCodeOf(s)} ${s.name}`,
    // Both spellings the workbook uses: "P3 Courageous", and the secondary
    // shorthand "Sec 1D1" for "S1 Discipline 1".
    keys: [
      norm(`${levelCodeOf(s)}${s.name}`),
      norm(
        `Sec${levelCodeOf(s).replace(/^S/, '')}${s.name
          .replace(/^Discipline\s*/i, 'D')
          .replace(/^Integrity\s*/i, 'I')}`
      ),
      // Level-only, and ONLY when the level holds one section — otherwise
      // "Sec 1" would match both Discipline classes and silently pick one.
      ...(perLevel.get(levelCodeOf(s)) === 1
        ? [norm(levelCodeOf(s)), norm(`Sec${levelCodeOf(s).replace(/^S/, '')}`)]
        : []),
    ],
  }));

  // Positional extraction. A cell can name several classes, and the subject
  // that belongs to each is the text FOLLOWING it — "P4 Trust STAR ... P5
  // Commitment - STAR ..." is two pairs, not a four-way ambiguity. So find
  // where each class name starts, cut the cell at those points, and read the
  // subjects out of each piece. Text before the first class attaches to it,
  // because the sheet sometimes leads with the subject ("Science P1 ...").
  function pairsIn(text: string): { section: string; subject: string }[] {
    const stripped = stripSchedule(text);
    const n = norm(stripped);

    // Map each normalised index back to nothing useful, so work in normalised
    // space throughout: find the earliest normalised offset of every class.
    const found: { label: string; at: number }[] = [];
    for (const s of sectionLabels) {
      let best = -1;
      for (const k of s.keys) {
        const i = n.indexOf(k);
        if (i !== -1 && (best === -1 || i < best)) best = i;
      }
      if (best !== -1) found.push({ label: s.label, at: best });
    }
    if (found.length === 0) return [];
    found.sort((a, b) => a.at - b.at);

    const out: { section: string; subject: string }[] = [];
    for (let i = 0; i < found.length; i++) {
      const from = i === 0 ? 0 : found[i].at;
      const to = i + 1 < found.length ? found[i + 1].at : n.length;
      const segment = n.slice(from, to);
      for (const subj of subjectKeys) {
        if (subj.keys.some((k) => segment.includes(k)))
          out.push({ section: found[i].label, subject: subj.name });
      }
    }
    return out;
  }

  let resolvedCells = 0;
  let noClass = 0;
  let classNoSubject = 0;
  const samples: string[] = [];

  for (const { teacher, text } of subjectCells) {
    const pairs = pairsIn(text);
    if (pairs.length > 0) {
      resolvedCells++;
      continue;
    }
    const n = norm(stripSchedule(text));
    const hasClass = sectionLabels.some((s) =>
      s.keys.some((k) => n.includes(k))
    );
    if (!hasClass) {
      noClass++;
      if (samples.length < 14)
        samples.push(`  [no known class] ${teacher}: ${text}`);
    } else {
      classNoSubject++;
      if (samples.length < 14)
        samples.push(`  [no known subject] ${teacher}: ${text}`);
    }
  }
  const oneEach = resolvedCells;
  const multiClass = 0;
  const noSubject = classNoSubject;

  void multiClass;
  console.log(`Total cells                    : ${subjectCells.length}`);
  console.log(`Yield at least one assignment  : ${oneEach}`);
  console.log(`Class found, no known subject  : ${noSubject}`);
  console.log(`No known class named           : ${noClass}\n`);
  console.log('Samples of what does not resolve to a single assignment:');
  samples.forEach((l) => console.log(l));

  // ⚠ CELLS ARE NOT ASSIGNMENTS. A timetable repeats the same teacher, class
  // and subject once per period, so 128 cells describe far fewer distinct
  // teaching assignments. The count that decides whether an import is worth
  // building is the number of DISTINCT (teacher, class, subject) triples — and
  // whether any two of them disagree.
  const triples = new Map<
    string,
    { teacher: string; section: string; subject: string }
  >();
  // A class+subject claimed by two different teachers is a real conflict, not
  // a parsing artefact — the unique index allows one subject teacher per class
  // — so collect them rather than letting the last writer win.
  const claims = new Map<string, Set<string>>();
  for (const { teacher, text } of subjectCells) {
    const email = ALIASES[teacher];
    if (!email || !userByEmail.has(email)) continue;
    for (const p of pairsIn(text)) {
      triples.set(`${email}|${p.section}|${p.subject}`, {
        teacher: email,
        section: p.section,
        subject: p.subject,
      });
      const slot = `${p.section}|${p.subject}`;
      if (!claims.has(slot)) claims.set(slot, new Set());
      claims.get(slot)!.add(email);
    }
  }

  console.log(
    `\nDISTINCT (teacher, class, subject) from the clean cells: ${triples.size}`
  );
  const bySection = new Map<string, number>();
  for (const t of triples.values())
    bySection.set(t.section, (bySection.get(t.section) ?? 0) + 1);
  console.log('  subjects covered per class:');
  for (const s of [...bySection.entries()].sort())
    console.log(`    ${s[0].padEnd(18)} ${s[1]}`);
  const missing = sections
    .map((s) => `${levelCodeOf(s)} ${s.name}`)
    .filter((l) => !bySection.has(l));
  if (missing.length)
    console.log(
      `  classes with NO subject teacher resolved: ${missing.join(', ')}`
    );

  const contested = [...claims.entries()].filter(([, who]) => who.size > 1);
  if (contested.length) {
    console.log(
      `\n  ⚠ CLAIMED BY MORE THAN ONE TEACHER (${contested.length}) — one subject teacher per class is a unique index, so these need a decision before any import:`
    );
    for (const [slot, who] of contested) {
      const [sec, subj] = slot.split('|');
      console.log(
        `    ${sec.padEnd(18)} ${subj.padEnd(22)} ${[...who].join(', ')}`
      );
    }
  }

  // ── 3. Names the workbook uses that we cannot place ──────────────────────
  console.log('\n═══ 3. UNPLACED NAMES ═══\n');
  for (const { name } of teacherCols) {
    const email = ALIASES[name];
    if (email === undefined) console.log(`  ${name} — not in alias table`);
    else if (email === null) console.log(`  ${name} — no account / unknown`);
    else if (!userByEmail.has(email))
      console.log(`  ${name} — mapped to ${email}, which has no account`);
  }

  console.log('\nNothing was written. This script only reads.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
