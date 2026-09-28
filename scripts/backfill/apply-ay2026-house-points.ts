// scripts/backfill/apply-ay2026-house-points.ts
// Seeds AY2026's house points into the SIS from the school's own workbook.
//
// Source: `House Points Tracking AY2026.xlsx` at the repo root — one tab per
// event, every tab laid out differently, plus an "Overall Points Tracker" tab
// holding the per-event house totals the school actually read out. Target:
// the house_point_* tables of migration 181 (KD #228).
//
// WHAT IS IMPORTED. Every event becomes `placement_mode = 'pick'` — the
// workbook records awards, never scores — in AY2026, with its OWN place
// ladder (label + points exactly as that tab used them; ranked by points,
// the participation-style row unranked). Points are never stored: an entry
// carries a place, and the totals are worked out at read time by
// lib/house-points/compute.ts, against each student's CURRENT SIS house
// (students.house_id) — never the house typed on the sheet row.
//
//   Sports Fest            major     house    (no tab: the tracker row IS the placing)
//   Visual Spatial, SMO,   external  student
//   VANDA, the three ICAS
//   Maths Week,            internal  student
//   Science Quiz Bee
//   HFSE Got Talent        internal  team     (each placed group is a team)
//
// NOT IMPORTED: "Principal List Sem 1" (an academic list, not house points)
// and the blank Attendance Challenge row (that event type arrives later).
//
// ⚠ STUDENTS ARE MATCHED BY NAME, because the workbook carries no student
// number. Names come in every shape ("LAST, First M.", "First Middle Last",
// uppercase, typos, first names only on Got Talent) with a class hint beside
// them. Each row is classified MATCHED (one student, unambiguous),
// AMBIGUOUS (candidates listed) or UNMATCHED — nothing is guessed silently.
// The script holds NO student names: everything it knows about a child it
// reads from the workbook and the database at run time.
//
// ⚠ GOT TALENT'S UPPER PRIMARY 4TH PLACE. The tab gave that duo 1 point each
// while Secondary's 4th place got 2. The event's rubric here is the tab's own
// 1st 5 / 2nd 4 / 3rd 3 / 4th 2 / 5th 1, so the duo imports as 4th place (2)
// and the report flags "sheet gave 1, rubric gives 2" for Mr Ace to decide.
// No special place is invented for it.
//
// Dry run by default — reads only, writes nothing, prints (or with
// `--report <file>` writes) a reconciliation of every event against the
// tracker row.
//
//   npx tsx --env-file=.env.local scripts/backfill/apply-ay2026-house-points.ts
//   npx tsx --env-file=.env.local scripts/backfill/apply-ay2026-house-points.ts --report <file.md>
//   npx tsx --env-file=.env.local scripts/backfill/apply-ay2026-house-points.ts --write --actor <auth user uuid>
//
// Write-mode flags:
//   --write              actually insert
//   --actor <uuid>       REQUIRED with --write: the auth user recorded as
//                        created_by and as the audit-log actor (must hold a
//                        house-points writer role)
//   --replace-ay2026     delete every existing AY2026 house point event first
//                        (cascades to places, teams, members, entries);
//                        without it the script refuses if any exist
//   --skip-unresolved    import only MATCHED rows; without it the script
//                        refuses while any row is AMBIGUOUS or UNMATCHED.
//                        On a team event it drops only the unresolved
//                        MEMBER — the team still imports with the rest
//
// Decision flags (repeatable; both modes). They carry sheet rows and student
// numbers only — never a name in this file:
//   --member "<event name>|<sheet row>|<label>=<student_number>"
//                        force that row (or, on a team, the member whose
//                        parsed label is <label>) to that AY2026 student;
//                        reported as MATCHED (override). <label> must equal
//                        the sheet name / parsed member label as the report
//                        prints it, so a flag aimed at the wrong row fails.
//   --exclude "<event name>|<sheet row>[|<member label>]"
//                        leave that row out entirely — or, with a member
//                        label, only that member of a team — reported as
//                        EXCLUDED
// A flag that matches nothing stops the run: a typo must not pass silently.
//
// A failure part-way through a write deletes every event this run created
// (cascade), so the import lands whole or not at all.

import { writeFileSync } from 'node:fs';

import * as XLSX from 'xlsx';

import { logAction } from '../../lib/audit/log-action';
import { HOUSE_POINTS_WRITERS } from '../../lib/auth/student-record';
import {
  houseTotals,
  resolveEntries,
  teamHouses,
  type EntrantKind,
  type EventType,
  type Place,
  type SheetEntry,
} from '../../lib/house-points/compute';
import { EventInputSchema } from '../../lib/schemas/house-points';
import { fetchAllPages } from '../../lib/supabase/paginate';
import { createServiceClient } from '../../lib/supabase/service';

const WORKBOOK = 'House Points Tracking AY2026.xlsx';
const AY = 'AY2026';
const SOURCE = 'ay2026-workbook-import';

const argv = process.argv.slice(2);
const WRITE = argv.includes('--write');
const REPLACE = argv.includes('--replace-ay2026');
const SKIP_UNRESOLVED = argv.includes('--skip-unresolved');
function argValue(flag: string): string | null {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}
const ACTOR_ID = argValue('--actor');
const REPORT_PATH = argValue('--report');
function argValues(flag: string): string[] {
  const out: string[] = [];
  argv.forEach((a, i) => {
    if (a === flag && i + 1 < argv.length) out.push(argv[i + 1]);
  });
  return out;
}

type Override = {
  raw: string;
  event: string;
  row: number;
  label: string;
  studentNumber: string;
  used: boolean;
};
type Exclusion = {
  raw: string;
  event: string;
  row: number;
  label: string | null;
  used: boolean;
};

const labelKey = (s: string) => s.replace(/\s+/g, ' ').trim().toUpperCase();

function parseOverrides(): Override[] {
  return argValues('--member').map((raw) => {
    const m = raw.match(/^(.+)\|(\d+)\|(.+)=\s*(\S+)\s*$/);
    if (!m)
      throw new Error(
        `--member "${raw}": expected "<event>|<row>|<label>=<student_number>"`
      );
    return {
      raw,
      event: m[1].trim(),
      row: Number(m[2]),
      label: m[3].trim(),
      studentNumber: m[4].toUpperCase(),
      used: false,
    };
  });
}

function parseExclusions(): Exclusion[] {
  return argValues('--exclude').map((raw) => {
    const m = raw.match(/^(.+?)\|(\d+)(?:\|(.+))?$/);
    if (!m)
      throw new Error(
        `--exclude "${raw}": expected "<event>|<row>[|<member label>]"`
      );
    return {
      raw,
      event: m[1].trim(),
      row: Number(m[2]),
      label: m[3]?.trim() ?? null,
      used: false,
    };
  });
}

const OVERRIDES = parseOverrides();
const EXCLUSIONS = parseExclusions();

type Service = ReturnType<typeof createServiceClient>;

// ─────────────────────────────────────────────────────────────────────────
// Houses

const COLOURS = ['BLUE', 'ORANGE', 'YELLOW', 'GREEN'] as const;
type Colour = (typeof COLOURS)[number];

/** "🟡 Yellow" / "Orange" / "Blue House" → YELLOW / ORANGE / BLUE. */
function colourOf(value: unknown): Colour | null {
  const m = String(value ?? '')
    .toUpperCase()
    .match(/\b(BLUE|ORANGE|YELLOW|GREEN)\b/);
  return m ? (m[1] as Colour) : null;
}

const cap = (c: Colour) => c.charAt(0) + c.slice(1).toLowerCase();

// ─────────────────────────────────────────────────────────────────────────
// Text normalisation

function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

/** Name tokens: accents stripped, punctuation dropped, initials dropped. */
function nameTokens(s: string): string[] {
  return norm(s)
    .replace(/[^A-Z\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/** Optimal-string-alignment distance (Levenshtein + adjacent transposition). */
function osa(a: string, b: string): number {
  const d: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    d.push(new Array<number>(b.length + 1).fill(0));
    d[i][0] = i;
  }
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

/** Exact, or one typo apart when both tokens have at least 4 letters. */
function tokEq(a: string, b: string): 'exact' | 'typo' | null {
  if (a === b) return 'exact';
  if (Math.min(a.length, b.length) >= 4 && osa(a, b) <= 1) return 'typo';
  return null;
}

function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

// ─────────────────────────────────────────────────────────────────────────
// Roster

type SectionInfo = {
  id: string;
  name: string;
  levelCode: string; // P1..P6, S1..S4 (or whatever the level's code is)
  label: string; // "P6 Grit"
  words: string[];
  nums: string[];
};

type Candidate = {
  studentId: string;
  studentNumber: string;
  display: string; // "LAST, First Middle"
  houseId: string | null;
  tokens: string[];
  lastTokens: string[];
  firstTokens: string[];
  // The section_students row an entry would point at (active/late_enrollee
  // preferred), plus every AY2026 section the child sat in.
  sectionStudentId: string;
  status: string;
  section: SectionInfo;
  allSectionIds: Set<string>;
  allLevelCodes: Set<string>;
  rowCount: number;
};

const LEVEL_LABEL_TO_CODE: Record<string, string> = {
  'PRIMARY ONE': 'P1',
  'PRIMARY TWO': 'P2',
  'PRIMARY THREE': 'P3',
  'PRIMARY FOUR': 'P4',
  'PRIMARY FIVE': 'P5',
  'PRIMARY SIX': 'P6',
  'SECONDARY ONE': 'S1',
  'SECONDARY TWO': 'S2',
  'SECONDARY THREE': 'S3',
  'SECONDARY FOUR': 'S4',
};

type Roster = {
  ayId: string;
  sections: SectionInfo[];
  candidates: Candidate[];
  houseIdByColour: Map<Colour, string>;
  colourByHouseId: Map<string, Colour>;
};

async function loadRoster(svc: Service): Promise<Roster> {
  const { data: ay, error: ayErr } = await svc
    .from('academic_years')
    .select('id')
    .eq('ay_code', AY)
    .single();
  if (ayErr || !ay) throw new Error(`${AY} not found: ${ayErr?.message}`);
  const ayId = (ay as { id: string }).id;

  const { data: houses, error: hErr } = await svc
    .from('houses')
    .select('id, name');
  if (hErr) throw new Error(`houses read failed: ${hErr.message}`);
  const houseIdByColour = new Map<Colour, string>();
  const colourByHouseId = new Map<string, Colour>();
  for (const h of (houses ?? []) as { id: string; name: string }[]) {
    const c = colourOf(h.name);
    if (!c) throw new Error(`house "${h.name}" has no recognisable colour`);
    houseIdByColour.set(c, h.id);
    colourByHouseId.set(h.id, c);
  }
  for (const c of COLOURS) {
    if (!houseIdByColour.has(c))
      throw new Error(`no ${cap(c)} house in the SIS`);
  }

  const { data: levels, error: lErr } = await svc
    .from('levels')
    .select('id, code, label');
  if (lErr) throw new Error(`levels read failed: ${lErr.message}`);
  const levelCodeById = new Map<string, string>();
  for (const l of (levels ?? []) as {
    id: string;
    code: string | null;
    label: string | null;
  }[]) {
    const code = (l.code ?? '').trim().toUpperCase();
    const fromLabel = LEVEL_LABEL_TO_CODE[norm(l.label ?? '').trim()];
    levelCodeById.set(
      l.id,
      /^[PS][1-6]$/.test(code) ? code : (fromLabel ?? code)
    );
  }

  const { data: secs, error: sErr } = await svc
    .from('sections')
    .select('id, name, level_id')
    .eq('academic_year_id', ayId);
  if (sErr) throw new Error(`sections read failed: ${sErr.message}`);
  const sections: SectionInfo[] = (
    (secs ?? []) as { id: string; name: string; level_id: string }[]
  ).map((s) => {
    const levelCode = levelCodeById.get(s.level_id) ?? '?';
    const toks = norm(s.name)
      .replace(/[^A-Z0-9]+/g, ' ')
      .replace(/([A-Z])(\d)/g, '$1 $2')
      .split(/\s+/)
      .filter(Boolean);
    return {
      id: s.id,
      name: s.name,
      levelCode,
      label: `${levelCode} ${s.name}`,
      words: toks.filter((t) => /^[A-Z]+$/.test(t)),
      nums: toks.filter((t) => /^\d+$/.test(t)),
    };
  });
  const sectionById = new Map(sections.map((s) => [s.id, s]));

  type SsRow = {
    id: string;
    section_id: string;
    student_id: string;
    enrollment_status: string;
  };
  const ssRows = await fetchAllPages<SsRow>((from, to) =>
    svc
      .from('section_students')
      .select('id, section_id, student_id, enrollment_status')
      .in(
        'section_id',
        sections.map((s) => s.id)
      )
      .order('id')
      .range(from, to)
  );

  type StudentDb = {
    id: string;
    student_number: string;
    last_name: string | null;
    first_name: string | null;
    middle_name: string | null;
    house_id: string | null;
  };
  const studentIds = [...new Set(ssRows.map((r) => r.student_id))];
  const students = new Map<string, StudentDb>();
  for (let i = 0; i < studentIds.length; i += 100) {
    const { data, error } = await svc
      .from('students')
      .select(
        'id, student_number, last_name, first_name, middle_name, house_id'
      )
      .in('id', studentIds.slice(i, i + 100));
    if (error) throw new Error(`students read failed: ${error.message}`);
    for (const s of (data ?? []) as StudentDb[]) students.set(s.id, s);
  }

  const rowsByStudent = new Map<string, SsRow[]>();
  for (const r of ssRows) {
    const list = rowsByStudent.get(r.student_id) ?? [];
    list.push(r);
    rowsByStudent.set(r.student_id, list);
  }

  const candidates: Candidate[] = [];
  for (const [studentId, rows] of rowsByStudent) {
    const s = students.get(studentId);
    if (!s) continue;
    const pref = (r: SsRow) =>
      r.enrollment_status === 'active' ||
      r.enrollment_status === 'late_enrollee'
        ? 0
        : 1;
    const chosen = [...rows].sort((a, b) => pref(a) - pref(b))[0];
    const section = sectionById.get(chosen.section_id);
    if (!section) continue;
    const lastTokens = nameTokens(s.last_name ?? '');
    const firstTokens = nameTokens(s.first_name ?? '');
    const middleTokens = nameTokens(s.middle_name ?? '');
    candidates.push({
      studentId,
      studentNumber: s.student_number,
      display: [
        s.last_name,
        [s.first_name, s.middle_name].filter(Boolean).join(' '),
      ]
        .filter(Boolean)
        .join(', '),
      houseId: s.house_id,
      tokens: [...lastTokens, ...firstTokens, ...middleTokens],
      lastTokens,
      firstTokens,
      sectionStudentId: chosen.id,
      status: chosen.enrollment_status,
      section,
      allSectionIds: new Set(rows.map((r) => r.section_id)),
      allLevelCodes: new Set(
        rows.map((r) => sectionById.get(r.section_id)?.levelCode ?? '?')
      ),
      rowCount: rows.length,
    });
  }

  return { ayId, sections, candidates, houseIdByColour, colourByHouseId };
}

// ─────────────────────────────────────────────────────────────────────────
// Class hints → a pool of sections or levels

type Pool = {
  raw: string;
  levelCodes: Set<string> | null; // null = no level constraint
  sectionIds: Set<string> | null; // null = whole level(s)
  note: string | null;
};

const WORD_NUM: Record<string, string> = {
  ONE: '1',
  TWO: '2',
  THREE: '3',
  FOUR: '4',
  FIVE: '5',
  SIX: '6',
};

/** Does a hint word name this section word? "D" → DISCIPLINE, COURAGES → COURAGEOUS. */
function sectionWordMatches(hint: string, sectionWord: string): boolean {
  if (sectionWord.startsWith(hint)) return true;
  return commonPrefix(hint, sectionWord) >= 5;
}

function sectionsFor(
  roster: Roster,
  levelCode: string,
  words: string[],
  nums: string[]
): SectionInfo[] {
  return roster.sections.filter(
    (s) =>
      s.levelCode === levelCode &&
      words.every((w) => s.words.some((sw) => sectionWordMatches(w, sw))) &&
      (nums.length === 0 ||
        (s.nums.length > 0 && nums.join(' ') === s.nums.join(' ')))
  );
}

/** "Pri 6 Grit", "P6-Loyalty", "Sec2-Integrity 2", "Primary Five Tenacity", "1 D 1", "Sec 3", "P1". */
function parseClassHint(roster: Roster, raw: string): Pool {
  const toks = norm(raw)
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/([A-Z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Z])/g, '$1 $2')
    .split(/\s+/)
    .filter(Boolean);
  let i = 0;
  let kind: 'P' | 'S' | null = null;
  if (['P', 'PRI', 'PRIMARY'].includes(toks[0])) {
    kind = 'P';
    i = 1;
  } else if (['S', 'SEC', 'SECONDARY'].includes(toks[0])) {
    kind = 'S';
    i = 1;
  }
  let num: string | null = null;
  if (toks[i] && /^\d$/.test(toks[i])) num = toks[i++];
  else if (toks[i] && WORD_NUM[toks[i]]) num = WORD_NUM[toks[i++]];
  // A bare "1 D 1" (SMO's junior section) is a secondary class.
  if (kind === null && num !== null) kind = 'S';
  if (kind === null || num === null) {
    return {
      raw,
      levelCodes: null,
      sectionIds: null,
      note: `class hint "${raw}" not understood`,
    };
  }
  const levelCode = `${kind}${num}`;
  const rest = toks.slice(i);
  const words = rest.filter((t) => /^[A-Z]+$/.test(t));
  const nums = rest.filter((t) => /^\d+$/.test(t));
  if (words.length === 0 && nums.length === 0) {
    return {
      raw,
      levelCodes: new Set([levelCode]),
      sectionIds: null,
      note: null,
    };
  }
  const hits = sectionsFor(roster, levelCode, words, nums);
  if (hits.length === 0) {
    return {
      raw,
      levelCodes: new Set([levelCode]),
      sectionIds: null,
      note: `no ${levelCode} class matches "${raw}" — searched the whole level`,
    };
  }
  return {
    raw,
    levelCodes: new Set([levelCode]),
    sectionIds: new Set(hits.map((s) => s.id)),
    note: null,
  };
}

function inPool(c: Candidate, pool: Pool): boolean {
  if (pool.sectionIds)
    return [...c.allSectionIds].some((id) => pool.sectionIds!.has(id));
  if (pool.levelCodes)
    return [...c.allLevelCodes].some((l) => pool.levelCodes!.has(l));
  return true;
}

function poolLabel(roster: Roster, pool: Pool): string {
  if (pool.sectionIds) {
    return roster.sections
      .filter((s) => pool.sectionIds!.has(s.id))
      .map((s) => s.label)
      .join(' / ');
  }
  if (pool.levelCodes) return [...pool.levelCodes].join('/') + ' (whole level)';
  return 'whole year';
}

// ─────────────────────────────────────────────────────────────────────────
// Name matching

type Resolution =
  | { status: 'MATCHED'; cand: Candidate; basis: string; notes: string[] }
  | { status: 'AMBIGUOUS'; cands: Candidate[]; notes: string[] }
  | { status: 'UNMATCHED'; near: Candidate[]; notes: string[] };

/**
 * 2 = every sheet token is one of the child's name tokens;
 * 1 = the child's whole surname and first given name are on the sheet (the
 *     sheet carries an extra middle name the SIS lacks, or similar);
 * 0 = no match.
 */
function quality(
  sheet: string[],
  c: Candidate
): { tier: 0 | 1 | 2; typo: boolean } {
  let typo = false;
  const find = (t: string, pool: string[]) => {
    for (const p of pool) {
      const eq = tokEq(t, p);
      if (eq) {
        if (eq === 'typo') typo = true;
        return true;
      }
    }
    return false;
  };
  if (sheet.length > 0 && sheet.every((t) => find(t, c.tokens)))
    return { tier: 2, typo };
  typo = false;
  if (
    c.lastTokens.length > 0 &&
    c.firstTokens.length > 0 &&
    c.lastTokens.every((l) => find(l, sheet)) &&
    find(c.firstTokens[0], sheet)
  ) {
    return { tier: 1, typo };
  }
  return { tier: 0, typo: false };
}

function resolveName(
  roster: Roster,
  sheetName: string,
  pool: Pool,
  opts: { firstNameOnly: boolean }
): Resolution {
  const toks = nameTokens(sheetName);
  const notes: string[] = [];
  if (pool.note) notes.push(pool.note);
  if (toks.length === 0)
    return {
      status: 'UNMATCHED',
      near: [],
      notes: [...notes, 'no name on the row'],
    };

  const scored = roster.candidates
    .map((c) => ({ c, ...quality(toks, c) }))
    .filter((s) => s.tier > 0);
  const hinted = scored.filter((s) => inPool(s.c, pool));
  const describe = (s: { tier: number; typo: boolean }) =>
    `${s.tier === 2 ? 'all name words' : 'surname + first name'}${s.typo ? ' (allowing a one-letter typo)' : ''}`;

  if (hinted.length > 0) {
    const top = Math.max(...hinted.map((s) => s.tier));
    const best = hinted.filter((s) => s.tier === top);
    // A better-tier hit outside the hinted class means the hint and the name
    // disagree — do not pick the weaker in-class match silently.
    const outsideBetter = scored.filter(
      (s) => !inPool(s.c, pool) && s.tier > top
    );
    if (best.length === 1 && outsideBetter.length === 0) {
      return {
        status: 'MATCHED',
        cand: best[0].c,
        basis: `${describe(best[0])} in ${poolLabel(roster, pool)}${opts.firstNameOnly ? ' — first name only' : ''}`,
        notes,
      };
    }
    return {
      status: 'AMBIGUOUS',
      cands: [...best, ...outsideBetter].map((s) => s.c),
      notes: [
        ...notes,
        outsideBetter.length > 0
          ? 'a closer name match sits outside the hinted class'
          : `${best.length} students in ${poolLabel(roster, pool)} fit`,
      ],
    };
  }

  // Nothing in the hinted class.
  if (!opts.firstNameOnly && scored.length > 0) {
    const top = Math.max(...scored.map((s) => s.tier));
    const best = scored.filter((s) => s.tier === top);
    if (best.length === 1 && top === 2) {
      return {
        status: 'MATCHED',
        cand: best[0].c,
        basis: `${describe(best[0])}, year-wide`,
        notes: [
          ...notes,
          `sheet says "${pool.raw}", SIS class is ${best[0].c.section.label}`,
        ],
      };
    }
    return {
      status: 'AMBIGUOUS',
      cands: best.map((s) => s.c),
      notes: [
        ...notes,
        `no fit in ${poolLabel(roster, pool)}; year-wide candidates listed`,
      ],
    };
  }

  // Near misses for the report: anyone in the hinted pool sharing a name word
  // (or, for a first name, starting with the same three letters).
  const shares = (c: Candidate) =>
    toks.some((t) =>
      c.tokens.some(
        (ct) => ct === t || (t.length >= 3 && ct.startsWith(t.slice(0, 3)))
      )
    );
  let near = roster.candidates.filter((c) => inPool(c, pool) && shares(c));
  if (near.length === 0) {
    near = roster.candidates.filter(shares);
    if (near.length)
      notes.push('nobody close in the hinted class; nearest are year-wide');
  }
  if (opts.firstNameOnly && scored.length > 0) {
    notes.push(
      `first name fits outside ${poolLabel(roster, pool)}: ${scored
        .slice(0, 6)
        .map((s) => `${s.c.display} (${s.c.section.label})`)
        .join('; ')}`
    );
  }
  return { status: 'UNMATCHED', near: near.slice(0, 8), notes };
}

// ─────────────────────────────────────────────────────────────────────────
// Events

type PlaceDef = { label: string; rank: number | null; points: number };

type StudentRow = {
  tabRow: number; // 1-based spreadsheet row
  name: string;
  hint: string; // raw class hint
  place: string; // place label
  sheetPoints: number | null;
  sheetHouse: Colour | null;
  res?: Resolution;
};

type Member = {
  name: string;
  hint: string | null;
  res?: Resolution;
  splitFrom?: string;
};

type TeamRow = {
  tabRow: number;
  category: string;
  categoryLevels: string[];
  place: string;
  sheetPoints: number;
  sheetHouses: Colour[]; // per member, kept aligned when a member is excluded
  sheetHousesAll: Colour[]; // as the sheet printed them — the sheet's own total
  text: string;
  members: Member[];
};

type HouseRow = { colour: Colour; place: string; sheetPoints: number };

type EventDef = {
  name: string; // the tracker row's name
  tab: string | null;
  eventType: EventType;
  entrantKind: EntrantKind;
  places: PlaceDef[];
  students: StudentRow[];
  teams: TeamRow[];
  houses: HouseRow[];
  parseNotes: string[];
  tabTotals: Record<Colour, number> | null; // a totals table printed on the tab itself
  excluded: string[]; // rows / members left out by --exclude
  excludedBasis: Record<Colour, number>; // what the sheet gave the excluded rows
};

/**
 * An event's own ladder: the ranked [label, points] pairs ranked by points
 * descending, then the participation-style row (rank null) if it has one.
 */
function ladder(
  ranked: [string, number][],
  catchAll?: [string, number]
): PlaceDef[] {
  const out: PlaceDef[] = [...ranked]
    .sort((a, b) => b[1] - a[1])
    .map(([label, points], i) => ({ label, rank: i + 1, points }));
  if (catchAll)
    out.push({ label: catchAll[0], rank: null, points: catchAll[1] });
  return out;
}

type Cell = string | number;
type Grid = Cell[][];

function readGrid(wb: XLSX.WorkBook, tab: string): Grid {
  const ws = wb.Sheets[tab];
  if (!ws) throw new Error(`tab "${tab}" not found in the workbook`);
  return XLSX.utils.sheet_to_json<Cell[]>(ws, {
    header: 1,
    blankrows: true,
    defval: '',
  });
}

const str = (c: Cell | undefined) =>
  String(c ?? '')
    .replace(/\s+/g, ' ')
    .trim();
const numOrNull = (c: Cell | undefined): number | null =>
  typeof c === 'number' ? c : null;

/** "Name (hint)" → name + hint. */
function splitNameHint(text: string): { name: string; hint: string } {
  const m = text.match(/^(.*?)\s*[(（]([^()（）]*)[)）]\s*$/);
  return m
    ? { name: m[1].trim(), hint: m[2].trim() }
    : { name: text.trim(), hint: '' };
}

/** "HONORABLE MENTION" → "Honorable Mention"; "CERTIFICATE OF PARTICIPATION" → "Certificate of Participation". */
function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) =>
      i > 0 && ['of', 'and'].includes(w)
        ? w
        : w.charAt(0).toUpperCase() + w.slice(1)
    )
    .join(' ');
}

function awardKeyword(text: string): string | null {
  const t = text.toLowerCase();
  if (t.includes('high distinction')) return 'High Distinction';
  if (t.includes('distinction')) return 'Distinction';
  if (t.includes('merit')) return 'Merit';
  if (t.includes('credit')) return 'Credit';
  if (t.includes('honou') || t.includes('honora')) return 'Honourable Mention';
  if (t.includes('participation')) return 'Participation';
  if (t.includes('gold')) return 'Gold';
  if (t.includes('silver')) return 'Silver';
  if (/\bbron?e?ze?\b|brone/.test(t)) return 'Bronze';
  return null;
}

// ── Tab parsers ────────────────────────────────────────────────────────────

function parseVanda(grid: Grid, ev: EventDef) {
  grid.forEach((r, i) => {
    if (i === 0 || !str(r[0])) return;
    const award = titleCase(str(r[2]));
    ev.students.push({
      tabRow: i + 1,
      name: str(r[0]),
      hint: str(r[1]),
      place: award,
      sheetPoints: null,
      sheetHouse: null,
    });
  });
}

function parseSmo(grid: Grid, ev: EventDef) {
  let current: string | null = null;
  grid.forEach((r, i) => {
    const a = str(r[0]);
    if (!a) return;
    if (/^[A-Z]\.\s/.test(a)) return; // "A. Junior Section …"
    if (/:\s*$/.test(a)) {
      const k = awardKeyword(a);
      current = k === 'Participation' ? 'Certificate of Participation' : k;
      if (!current)
        ev.parseNotes.push(`row ${i + 1}: heading "${a}" not understood`);
      return;
    }
    if (numOrNull(r[1]) === null) return;
    if (!current) {
      ev.parseNotes.push(
        `row ${i + 1}: entry before any award heading — skipped`
      );
      return;
    }
    const { name, hint } = splitNameHint(a);
    ev.students.push({
      tabRow: i + 1,
      name,
      hint,
      place: current,
      sheetPoints: numOrNull(r[1]),
      sheetHouse: colourOf(r[2]),
    });
  });
}

function parseQuizBee(grid: Grid, ev: EventDef) {
  let heading = '';
  grid.forEach((r, i) => {
    const a = str(r[0]);
    if (!a || i === 0) return;
    const m = a.match(/^(.*?)\s*(\d)(st|nd|rd|th)\s*place\s*$/i);
    if (!m) {
      heading = a;
      return;
    }
    ev.students.push({
      tabRow: i + 1,
      name: m[1].trim(),
      hint: heading,
      place: `${m[2]}${m[3].toLowerCase()} place`,
      sheetPoints: numOrNull(r[1]),
      sheetHouse: colourOf(r[2]),
    });
  });
}

function parseVisualSpatial(grid: Grid, ev: EventDef) {
  grid.forEach((r, i) => {
    if (typeof r[0] !== 'number' || !str(r[1])) return;
    const raw = str(r[3]);
    const award = awardKeyword(raw);
    if (!award) {
      ev.parseNotes.push(
        `row ${i + 1}: award "${raw}" not understood — skipped`
      );
      return;
    }
    if (award.toLowerCase() !== raw.toLowerCase())
      ev.parseNotes.push(`row ${i + 1}: award "${raw}" read as "${award}"`);
    ev.students.push({
      tabRow: i + 1,
      name: str(r[1]),
      hint: str(r[2]),
      place: award,
      sheetPoints: numOrNull(r[5]),
      sheetHouse: colourOf(r[4]),
    });
  });
}

function parseMathsWeek(grid: Grid, ev: EventDef) {
  grid.forEach((r, i) => {
    if (i === 0 || !str(r[2])) return;
    ev.students.push({
      tabRow: i + 1,
      name: str(r[2]),
      hint: str(r[0]),
      place: titleCase(str(r[1])),
      sheetPoints: numOrNull(r[5]),
      sheetHouse: colourOf(r[4]),
    });
  });
}

function parseIcas(grid: Grid, ev: EventDef) {
  let current: string | null = null;
  grid.forEach((r, i) => {
    const a = str(r[0]);
    // The participation table: Class | House | Name | "Participation" | points.
    if (str(r[3]) === 'Participation' && str(r[2])) {
      ev.students.push({
        tabRow: i + 1,
        name: str(r[2]),
        hint: a,
        place: 'Participation',
        sheetPoints: numOrNull(r[4]),
        sheetHouse: colourOf(r[1]),
      });
      return;
    }
    if (!a) return;
    if (/awardees?\s*:?\s*$/i.test(a) || /^the\s/i.test(a)) {
      current = awardKeyword(a);
      if (!current)
        ev.parseNotes.push(`row ${i + 1}: heading "${a}" not understood`);
      return;
    }
    if (/^\d+\s+\w/.test(a)) return; // "2 Distinction" summary lines
    if (!current) return; // the title row
    const { name, hint } = splitNameHint(a);
    ev.students.push({
      tabRow: i + 1,
      name,
      hint,
      place: current,
      sheetPoints: numOrNull(r[2]),
      sheetHouse: colourOf(r[1]),
    });
  });
}

const ORDINAL: Record<string, number> = {
  FIRST: 1,
  SECOND: 2,
  THIRD: 3,
  FOURTH: 4,
  FIFTH: 5,
};
const ORD_LABEL = [
  '',
  '1st place',
  '2nd place',
  '3rd place',
  '4th place',
  '5th place',
];

const CATEGORY_LEVELS: Record<string, string[]> = {
  'Lower Primary': ['P1', 'P2', 'P3'],
  'Upper Primary': ['P4', 'P5', 'P6'],
  Secondary: ['S1', 'S2', 'S3', 'S4'],
};

/**
 * Got Talent's free text: "First place: <name> (Gold) P3 Responsibility",
 * "2nd place: A, B (P6 Grit) (Silver x4)", "…: A(S4), B(S3)…",
 * "4th place: A and B S3". Members split on commas and "and"; a level token
 * (P3, S4) — plus a following class word when it names a class — is a hint,
 * the member's own when inside its segment, else the row's last hint.
 */
function parseGotTalent(grid: Grid, ev: EventDef, roster: Roster) {
  let category: string | null = null;
  const tab: Partial<Record<Colour, number>> = {};
  grid.forEach((r, i) => {
    // The right-hand totals table: house in F, points in G, top rows only
    // (further down, column F holds a placing's fourth member house).
    const tabColour = colourOf(r[5]);
    if (i <= 4 && tabColour && typeof r[6] === 'number') tab[tabColour] = r[6];
    const a = str(r[0]);
    if (!a) return;
    const cat = Object.keys(CATEGORY_LEVELS).find(
      (k) => a.replace(/^awards\s+/i, '').toLowerCase() === k.toLowerCase()
    );
    if (cat) {
      category = cat;
      return;
    }
    let t = a.replace(/[(（]\s*(gold|silver|bronze)[^)）]*[)）]/gi, ' ');
    const m = t.match(
      /^\s*(first|second|third|fourth|fifth|\d)(?:st|nd|rd|th)?\s*place\s*:?/i
    );
    if (!m) {
      ev.parseNotes.push(
        `row ${i + 1}: "${a}" is not a placing — read as a description, skipped`
      );
      return;
    }
    if (!category) {
      ev.parseNotes.push(`row ${i + 1}: placing before any category — skipped`);
      return;
    }
    const ord = /^\d$/.test(m[1]) ? Number(m[1]) : ORDINAL[m[1].toUpperCase()];
    t = t
      .slice(m[0].length)
      .replace(/band performance/i, ' ')
      .replace(/^[\s.]+/, '');
    t = t.replace(/[(（]/g, ' ').replace(/[)）]/g, ' ');

    const levels = CATEGORY_LEVELS[category];
    const segments = t
      .split(/,|\band\b/i)
      .map((s) => s.trim())
      .filter(Boolean);
    let rowHint: string | null = null;
    const members: Member[] = [];
    for (const seg of segments) {
      const toks = seg.split(/\s+/).filter(Boolean);
      const nameToks: string[] = [];
      let hint: string | null = null;
      for (let k = 0; k < toks.length; k++) {
        const lv = norm(toks[k]).match(/^([PS])([1-6])$/);
        if (!lv) {
          nameToks.push(toks[k]);
          continue;
        }
        const code = `${lv[1]}${lv[2]}`;
        let h = code;
        const next = toks[k + 1]
          ? norm(toks[k + 1]).replace(/[^A-Z]/g, '')
          : '';
        if (next && sectionsFor(roster, code, [next], []).length > 0) {
          h = `${code} ${toks[k + 1]}`;
          k++;
        }
        // Keep the most specific hint seen in this segment.
        if (!hint || h.length > hint.length) hint = h;
      }
      if (hint) rowHint = hint;
      if (nameToks.length) members.push({ name: nameToks.join(' '), hint });
    }
    for (const mem of members) if (!mem.hint) mem.hint = rowHint;

    const houses: Colour[] = [];
    for (let c = 2; c <= (i <= 4 ? 4 : 6); c++) {
      const col = colourOf(r[c]);
      if (col) houses.push(col);
    }
    ev.teams.push({
      tabRow: i + 1,
      category,
      categoryLevels: levels,
      place: ORD_LABEL[ord],
      sheetPoints: numOrNull(r[1]) ?? 0,
      sheetHouses: houses,
      sheetHousesAll: [...houses],
      text: a,
      members,
    });
  });
  if (Object.keys(tab).length === 4)
    ev.tabTotals = tab as Record<Colour, number>;
}

// ── Tracker ────────────────────────────────────────────────────────────────

type Tracker = Map<string, Record<Colour, number>>;

function parseTracker(grid: Grid): {
  rows: Tracker;
  total: Record<Colour, number> | null;
  notes: string[];
} {
  const header = grid[0] ?? [];
  const colIdx = new Map<Colour, number>();
  header.forEach((h, j) => {
    const c = colourOf(h);
    if (c && j >= 1 && j <= 4) colIdx.set(c, j);
  });
  if (colIdx.size !== 4)
    throw new Error('Overall Points Tracker: house columns not found');
  const rows: Tracker = new Map();
  let total: Record<Colour, number> | null = null;
  const notes: string[] = [];
  for (const r of grid.slice(1)) {
    const name = str(r[0]);
    if (!name) continue;
    const vals = {} as Record<Colour, number>;
    let any = false;
    for (const c of COLOURS) {
      const v = r[colIdx.get(c)!];
      if (typeof v === 'number') any = true;
      vals[c] = typeof v === 'number' ? v : 0;
    }
    if (/^total points$/i.test(name)) total = vals;
    else if (any) rows.set(name, vals);
    else notes.push(`tracker row "${name}" is blank — not imported`);
  }
  return { rows, total, notes };
}

// ─────────────────────────────────────────────────────────────────────────
// Event definitions: tab → tracker row name, type, entrants, own ladder.

type Spec = {
  tracker: string;
  tab: string | null;
  eventType: EventType;
  entrantKind: EntrantKind;
  places: PlaceDef[];
  parse: ((grid: Grid, ev: EventDef, roster: Roster) => void) | null;
};

const ICAS_CATCH_ALL: [string, number] = ['Participation', 5];

const SPECS: Spec[] = [
  {
    tracker: 'Sports Fest 2026 (Major Event)',
    tab: null,
    eventType: 'major',
    entrantKind: 'house',
    places: ladder(
      [
        ['Winner', 20],
        ['1st Runner Up', 15],
        ['2nd Runner Up', 10],
      ],
      ['Participation', 5]
    ),
    parse: null,
  },
  {
    tracker: 'Visual Spatial Mathlympic (External)',
    tab: 'Visual Spatial Mathlympic Winne',
    eventType: 'external',
    entrantKind: 'student',
    places: ladder([['Bronze', 10]], ['Participation', 5]),
    parse: parseVisualSpatial,
  },
  {
    tracker: 'Maths Week (Internal)',
    tab: 'Maths Week',
    eventType: 'internal',
    entrantKind: 'student',
    places: ladder([
      ['Gold', 5],
      ['Silver', 4],
      ['Bronze', 3],
    ]),
    parse: parseMathsWeek,
  },
  {
    tracker: 'Science Quiz Bee Winners',
    tab: 'Science Quiz Bee ',
    eventType: 'internal',
    entrantKind: 'student',
    places: ladder([
      ['1st place', 5],
      ['2nd place', 4],
      ['3rd place', 3],
    ]),
    parse: parseQuizBee,
  },
  {
    tracker: 'Singapore Mathematical Olympiad 2026',
    tab: 'Singapore Mathematical Olympiad',
    eventType: 'external',
    entrantKind: 'student',
    places: ladder(
      [
        ['Honourable Mention', 17],
        ['Bronze', 10],
      ],
      ['Certificate of Participation', 5]
    ),
    parse: parseSmo,
  },
  {
    tracker: 'HFSE Got Talent',
    tab: 'HFSE Got Talent',
    eventType: 'internal',
    entrantKind: 'team',
    places: ladder([
      ['1st place', 5],
      ['2nd place', 4],
      ['3rd place', 3],
      ['4th place', 2],
      ['5th place', 1],
    ]),
    parse: parseGotTalent,
  },
  {
    tracker: '2026 VANDA INTERNATIONAL JUNIOR SCIENCE OLYMPIAD',
    tab: '2026 VANDA',
    eventType: 'external',
    entrantKind: 'student',
    places: ladder(
      [
        ['Gold', 20],
        ['Honorable Mention', 17],
        ['Silver', 15],
        ['Bronze', 10],
      ],
      ['Certificate of Participation', 5]
    ),
    parse: parseVanda,
  },
  {
    tracker: 'ICAS 2026',
    tab: 'English ICAS',
    eventType: 'external',
    entrantKind: 'student',
    places: ladder(
      [
        ['Distinction', 20],
        ['Merit', 15],
      ],
      ICAS_CATCH_ALL
    ),
    parse: parseIcas,
  },
  {
    tracker: 'Math ICAS 2026',
    tab: 'Math ICAS',
    eventType: 'external',
    entrantKind: 'student',
    places: ladder(
      [
        ['Distinction', 20],
        ['Merit', 15],
        ['Credit', 10],
      ],
      ICAS_CATCH_ALL
    ),
    parse: parseIcas,
  },
  {
    tracker: 'Science ICAS 2026',
    tab: 'Science ICAS',
    eventType: 'external',
    entrantKind: 'student',
    places: ladder(
      [
        ['High Distinction', 25],
        ['Distinction', 20],
        ['Merit', 15],
        ['Credit', 10],
      ],
      ICAS_CATCH_ALL
    ),
    parse: parseIcas,
  },
];

const SKIPPED_TABS = ['Overall Points Tracker', 'Principal List Sem 1'];

// ─────────────────────────────────────────────────────────────────────────
// Resolution per event

function resolveEvent(roster: Roster, ev: EventDef) {
  for (const row of ev.students) {
    const pool = parseClassHint(roster, row.hint);
    row.res = resolveName(roster, row.name, pool, { firstNameOnly: false });
  }
  for (const team of ev.teams) {
    const resolved: Member[] = [];
    for (const mem of team.members) {
      const pool: Pool = mem.hint
        ? parseClassHint(roster, mem.hint)
        : {
            raw: team.category,
            levelCodes: new Set(team.categoryLevels),
            sectionIds: null,
            note: null,
          };
      const whole = resolveName(roster, mem.name, pool, {
        firstNameOnly: true,
      });
      const toks = mem.name.split(/\s+/).filter(Boolean);
      if (whole.status !== 'UNMATCHED' || toks.length < 2) {
        resolved.push({ ...mem, res: whole });
        continue;
      }
      // No single child carries all these words: the sheet may have run
      // several first names together ("A B C , D"). Split greedily, longest
      // run first, keeping only unique fits — and say so in the report.
      let k = 0;
      while (k < toks.length) {
        let took = false;
        for (let j = toks.length; j > k; j--) {
          const part = toks.slice(k, j).join(' ');
          const r = resolveName(roster, part, pool, { firstNameOnly: true });
          if (r.status === 'MATCHED') {
            resolved.push({
              name: part,
              hint: mem.hint,
              res: r,
              splitFrom: mem.name,
            });
            k = j;
            took = true;
            break;
          }
        }
        if (!took) {
          const part = toks[k];
          resolved.push({
            name: part,
            hint: mem.hint,
            res: resolveName(roster, part, pool, { firstNameOnly: true }),
            splitFrom: mem.name,
          });
          k++;
        }
      }
    }
    team.members = resolved;
  }
}

/**
 * Mr Ace's per-row decisions (--member / --exclude), applied after name
 * matching so the report still shows what the matcher would have done.
 */
function applyDecisionFlags(roster: Roster, ev: EventDef) {
  const byNumber = (sn: string, raw: string) => {
    const c = roster.candidates.find(
      (x) => x.studentNumber.toUpperCase() === sn
    );
    if (!c)
      throw new Error(`--member "${raw}": no AY2026 student has number ${sn}`);
    return c;
  };
  const before = (res: Resolution | undefined) =>
    res
      ? `matcher said ${res.status}${res.status === 'MATCHED' ? ` (${res.cand.display})` : ''}`
      : 'not matched';

  for (const x of EXCLUSIONS.filter((e) => e.event === ev.name)) {
    const row = ev.students.find((r) => r.tabRow === x.row);
    if (row && (x.label === null || labelKey(x.label) === labelKey(row.name))) {
      ev.students = ev.students.filter((r) => r !== row);
      if (row.sheetHouse && row.sheetPoints)
        ev.excludedBasis[row.sheetHouse] += row.sheetPoints;
      ev.excluded.push(
        `row ${row.tabRow} "${row.name}" (${row.place}) — ${before(row.res)}`
      );
      x.used = true;
      continue;
    }
    const team = ev.teams.find((t) => t.tabRow === x.row);
    if (!team) continue;
    if (x.label === null) {
      ev.teams = ev.teams.filter((t) => t !== team);
      for (const h of new Set(team.sheetHousesAll))
        ev.excludedBasis[h] += team.sheetPoints;
      ev.excluded.push(
        `row ${team.tabRow} (${team.category} — ${team.place}) — the whole placing`
      );
      x.used = true;
      continue;
    }
    const k = team.members.findIndex(
      (m) => labelKey(m.name) === labelKey(x.label!)
    );
    if (k < 0) continue;
    const mem = team.members[k];
    // Keep the per-member sheet-house columns aligned with the members.
    if (team.sheetHouses.length === team.members.length) {
      team.sheetHouses = team.sheetHouses.filter((_, i) => i !== k);
    }
    team.members = team.members.filter((_, i) => i !== k);
    ev.excluded.push(
      `row ${team.tabRow} (${team.category} — ${team.place}) member "${mem.name}" — ${before(mem.res)}`
    );
    x.used = true;
  }

  for (const o of OVERRIDES.filter((e) => e.event === ev.name)) {
    const cand = byNumber(o.studentNumber, o.raw);
    const res = (prev: Resolution | undefined): Resolution => ({
      status: 'MATCHED',
      cand,
      basis: 'override (--member)',
      notes: [before(prev)],
    });
    const row = ev.students.find(
      (r) => r.tabRow === o.row && labelKey(r.name) === labelKey(o.label)
    );
    if (row) {
      row.res = res(row.res);
      o.used = true;
      continue;
    }
    const team = ev.teams.find((t) => t.tabRow === o.row);
    const mem = team?.members.find(
      (m) => labelKey(m.name) === labelKey(o.label)
    );
    if (mem) {
      mem.res = res(mem.res);
      o.used = true;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// What would be inserted, and its totals

type Planned = {
  ev: EventDef;
  placeIdx: Map<string, number>; // label → index into ev.places
  studentEntries: { row: StudentRow; cand: Candidate; placeIdx: number }[];
  teamEntries: {
    team: TeamRow;
    name: string;
    members: Candidate[];
    placeIdx: number;
  }[];
  houseEntries: { colour: Colour; placeIdx: number }[];
  problems: string[]; // blocks a write outright
  notes: string[];
  unresolved: number;
};

function plan(ev: EventDef, roster: Roster): Planned {
  const placeIdx = new Map(ev.places.map((p, i) => [p.label, i]));
  const p: Planned = {
    ev,
    placeIdx,
    studentEntries: [],
    teamEntries: [],
    houseEntries: [],
    problems: [],
    notes: [],
    unresolved: 0,
  };
  const need = (label: string, where: string) => {
    const i = placeIdx.get(label);
    if (i === undefined)
      p.problems.push(
        `${where}: place "${label}" is not on this event's ladder`
      );
    return i;
  };
  for (const row of ev.students) {
    const i = need(row.place, `row ${row.tabRow}`);
    if (row.res?.status !== 'MATCHED') {
      p.unresolved++;
      continue;
    }
    if (i !== undefined)
      p.studentEntries.push({ row, cand: row.res.cand, placeIdx: i });
  }
  const seen = new Map<string, number>();
  for (const e of p.studentEntries) {
    const prev = seen.get(e.cand.sectionStudentId);
    if (prev !== undefined)
      p.problems.push(
        `rows ${prev} and ${e.row.tabRow} are the same student — an event holds a student once`
      );
    seen.set(e.cand.sectionStudentId, e.row.tabRow);
  }
  const onTeam = new Map<string, number>();
  for (const team of ev.teams) {
    const i = need(team.place, `row ${team.tabRow}`);
    const members: Candidate[] = [];
    for (const m of team.members) {
      if (m.res?.status === 'MATCHED') members.push(m.res.cand);
      else p.unresolved++;
    }
    for (const c of members) {
      const prev = onTeam.get(c.sectionStudentId);
      if (prev !== undefined)
        p.problems.push(
          `rows ${prev} and ${team.tabRow} put the same student on two teams`
        );
      onTeam.set(c.sectionStudentId, team.tabRow);
    }
    if (members.length === 0) {
      // Its members are already counted as unresolved; with
      // --skip-unresolved the placing is simply left out.
      p.notes.push(
        `row ${team.tabRow} (${team.category} — ${team.place}): no member matched — the team is not created`
      );
      continue;
    }
    if (i !== undefined)
      p.teamEntries.push({
        team,
        name: `${team.category} — ${team.place}`,
        members,
        placeIdx: i,
      });
  }
  for (const h of ev.houses) {
    const i = need(h.place, `house ${cap(h.colour)}`);
    if (i !== undefined) p.houseEntries.push({ colour: h.colour, placeIdx: i });
  }
  void roster;
  return p;
}

/**
 * House totals of what WOULD be inserted, through compute.ts exactly as the
 * app works them out. `sheetHouses` swaps each student's SIS house for the
 * house typed on the sheet (where the sheet has one) — a what-if column only,
 * to show how much of the gap is the SIS house data rather than the import.
 */
function computeTotals(
  pl: Planned,
  roster: Roster,
  sheetHouses = false
): Record<Colour, number> {
  const placeObjs: Place[] = pl.ev.places.map((pd, i) => ({
    id: `p${i}`,
    label: pd.label,
    rank: pd.rank,
    points: pd.points,
    sortOrder: i,
  }));
  const entries: SheetEntry[] = [];
  const hid = (c: Colour) => roster.houseIdByColour.get(c)!;
  pl.studentEntries.forEach((e, n) => {
    const houseId =
      sheetHouses && e.row.sheetHouse ? hid(e.row.sheetHouse) : e.cand.houseId;
    entries.push({
      id: `s${n}`,
      group: 'event',
      score: null,
      placeId: `p${e.placeIdx}`,
      houseIds: houseId ? [houseId] : [],
    });
  });
  pl.teamEntries.forEach((e, n) => {
    const members =
      sheetHouses && e.team.sheetHouses.length === e.team.members.length
        ? e.team.members
            .map((m, k) =>
              m.res?.status === 'MATCHED'
                ? { houseId: hid(e.team.sheetHouses[k]) }
                : null
            )
            .filter((m): m is { houseId: string } => m !== null)
        : e.members.map((m) => ({ houseId: m.houseId }));
    entries.push({
      id: `t${n}`,
      group: 'event',
      score: null,
      placeId: `p${e.placeIdx}`,
      houseIds: teamHouses(members).map((h) => h.houseId),
    });
  });
  pl.houseEntries.forEach((e, n) =>
    entries.push({
      id: `h${n}`,
      group: 'event',
      score: null,
      placeId: `p${e.placeIdx}`,
      houseIds: [roster.houseIdByColour.get(e.colour)!],
    })
  );
  const ids = COLOURS.map((c) => roster.houseIdByColour.get(c)!);
  const totals = houseTotals(resolveEntries(entries, placeObjs, 'pick'), ids);
  const out = {} as Record<Colour, number>;
  for (const c of COLOURS) out[c] = totals[roster.houseIdByColour.get(c)!] ?? 0;
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Report

const zero = (): Record<Colour, number> => ({
  BLUE: 0,
  ORANGE: 0,
  YELLOW: 0,
  GREEN: 0,
});
const houseOf = (roster: Roster, c: Candidate): Colour | null =>
  c.houseId ? (roster.colourByHouseId.get(c.houseId) ?? null) : null;
const fmtDelta = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const esc = (s: string) => s.replace(/\|/g, '\\|');

function candLine(roster: Roster, c: Candidate): string {
  const h = houseOf(roster, c);
  return `${c.display} · ${c.studentNumber} · ${c.section.label}${c.status !== 'active' ? ` (${c.status})` : ''} · ${h ? cap(h) : 'no house'}`;
}

function resCell(roster: Roster, res: Resolution | undefined): string {
  if (!res) return '—';
  if (res.status === 'MATCHED')
    return `MATCHED${res.basis.startsWith('override') ? ' (override)' : ''} → ${candLine(roster, res.cand)}`;
  if (res.status === 'AMBIGUOUS')
    return `**AMBIGUOUS** — ${res.cands.map((c) => candLine(roster, c)).join(' ‖ ')}`;
  return `**UNMATCHED**${res.near.length ? ` — nearest: ${res.near.map((c) => candLine(roster, c)).join(' ‖ ')}` : ''}`;
}

function resNotes(res: Resolution | undefined): string[] {
  if (!res) return [];
  const n = [...res.notes];
  if (res.status === 'MATCHED') n.unshift(res.basis);
  return n;
}

/** What Mr Ace has to settle, grouped so one student's issue is listed once. */
type Decisions = {
  identify: string[];
  noHouse: Map<string, { who: string; where: string[] }>;
  houseConflicts: Map<
    string,
    { who: string; sis: Colour; sheet: Map<Colour, string[]> }
  >;
  points: string[];
  confirm: string[];
  info: string[];
};

function newDecisions(): Decisions {
  return {
    identify: [],
    noHouse: new Map(),
    houseConflicts: new Map(),
    points: [],
    confirm: [],
    info: [],
  };
}

function noteNoHouse(d: Decisions, c: Candidate, where: string) {
  const e = d.noHouse.get(c.studentId) ?? {
    who: `${c.display} (${c.studentNumber}, ${c.section.label})`,
    where: [],
  };
  e.where.push(where);
  d.noHouse.set(c.studentId, e);
}

function noteConflict(
  d: Decisions,
  roster: Roster,
  c: Candidate,
  sheet: Colour,
  where: string
) {
  const sis = houseOf(roster, c);
  if (!sis) return;
  const e = d.houseConflicts.get(c.studentId) ?? {
    who: `${c.display} (${c.studentNumber}, ${c.section.label})`,
    sis,
    sheet: new Map<Colour, string[]>(),
  };
  e.sheet.set(sheet, [...(e.sheet.get(sheet) ?? []), where]);
  d.houseConflicts.set(c.studentId, e);
}

/** Matches that are right but worth a second look. */
function noteMatchQuality(
  d: Decisions,
  evName: string,
  where: string,
  sheetName: string,
  res: Resolution | undefined
) {
  if (res?.status !== 'MATCHED') return;
  if (res.basis.includes('year-wide')) {
    d.confirm.push(
      `${evName} ${where}: "${sheetName}" → ${res.cand.display} — ${res.notes.join('; ')}`
    );
  }
  if (res.cand.status === 'withdrawn') {
    d.info.push(
      `${evName} ${where}: ${res.cand.display} is withdrawn — imported anyway (points stay with students who later withdrew, KD #228)`
    );
  }
}

function reportEvent(
  pl: Planned,
  roster: Roster,
  tracker: Record<Colour, number> | undefined,
  computed: Record<Colour, number>,
  out: string[],
  decisions: Decisions
) {
  const ev = pl.ev;
  out.push(`## ${ev.name}`);
  out.push('');
  out.push(
    `Tab: ${ev.tab ? `\`${ev.tab}\`` : '(none — the tracker row is the placing)'} · type **${ev.eventType}** · entrants **${ev.entrantKind}** · pick mode`
  );
  out.push('');
  out.push(
    `Places: ${ev.places.map((p) => `${p.label} ${p.points}${p.rank === null ? ' (unranked)' : ` (rank ${p.rank})`}`).join(' · ')}`
  );
  out.push('');

  // Per-row explanation of how the import differs from the sheet.
  const explain: string[] = [];
  const sheetBasis = zero();
  let sheetHasHouses = false;

  if (ev.students.length) {
    const c = { MATCHED: 0, AMBIGUOUS: 0, UNMATCHED: 0 };
    for (const r of ev.students) if (r.res) c[r.res.status]++;
    out.push(
      `Rows parsed **${ev.students.length}** · matched **${c.MATCHED}** · ambiguous **${c.AMBIGUOUS}** · unmatched **${c.UNMATCHED}**`
    );
    out.push('');
    out.push(
      '| Row | Sheet name | Class hint | Award | Sheet pts | Sheet house | Result | Notes |'
    );
    out.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const r of ev.students) {
      const place = ev.places.find((p) => p.label === r.place);
      const notes = resNotes(r.res);
      if (r.sheetPoints !== null && place && r.sheetPoints !== place.points)
        notes.push(`sheet gave ${r.sheetPoints}, rubric gives ${place.points}`);
      out.push(
        `| ${r.tabRow} | ${esc(r.name)} | ${esc(r.hint)} | ${esc(r.place)} | ${r.sheetPoints ?? '—'} | ${r.sheetHouse ? cap(r.sheetHouse) : '—'} | ${esc(resCell(roster, r.res))} | ${esc(notes.join('; '))} |`
      );

      if (r.sheetHouse && r.sheetPoints !== null) {
        sheetHasHouses = true;
        sheetBasis[r.sheetHouse] += r.sheetPoints;
      }
      const rubric = place?.points ?? 0;
      const sis =
        r.res?.status === 'MATCHED' ? houseOf(roster, r.res.cand) : null;
      const who = `row ${r.tabRow} (${r.name})`;
      if (r.res?.status !== 'MATCHED') {
        const lost =
          r.sheetHouse && r.sheetPoints
            ? ` — ${cap(r.sheetHouse)} loses ${r.sheetPoints}`
            : '';
        explain.push(
          `${who}: ${r.res?.status ?? 'unresolved'}, not imported${lost}`
        );
        decisions.identify.push(
          `${ev.name} ${who}, hint "${r.hint}": ${esc(resCell(roster, r.res))}${r.res?.notes.length ? ` (${r.res.notes.join('; ')})` : ''}`
        );
        continue;
      }
      noteMatchQuality(decisions, ev.name, `row ${r.tabRow}`, r.name, r.res);
      if (!sis) {
        explain.push(
          `${who}: SIS house is empty — ${rubric} points go to no house${r.sheetHouse ? ` (sheet: ${cap(r.sheetHouse)})` : ''}`
        );
        noteNoHouse(
          decisions,
          r.res.cand,
          `${ev.name} row ${r.tabRow}${r.sheetHouse ? ` (sheet: ${cap(r.sheetHouse)})` : ''}`
        );
      } else if (
        !r.sheetHouse &&
        r.sheetPoints === null &&
        ev.students.some((x) => x.sheetHouse)
      ) {
        explain.push(
          `${who}: sheet row has no house and no points — import gives ${cap(sis)} ${rubric}`
        );
        decisions.points.push(
          `${ev.name} ${who}: listed under ${r.place} with no house and no points (the tracker counted nothing) — import as ${r.place} (${cap(sis)} +${rubric}) or leave out?`
        );
      } else if (r.sheetHouse && sis !== r.sheetHouse) {
        explain.push(
          `${who}: sheet house ${cap(r.sheetHouse)}, SIS house ${cap(sis)} — ${rubric} points move`
        );
        noteConflict(
          decisions,
          roster,
          r.res.cand,
          r.sheetHouse,
          `${ev.name} row ${r.tabRow}`
        );
      }
      if (r.sheetPoints !== null && r.sheetPoints !== rubric) {
        explain.push(
          `${who}: sheet gave ${r.sheetPoints}, rubric gives ${rubric}`
        );
        decisions.points.push(
          `${ev.name} ${who}: sheet gave ${r.sheetPoints}, rubric gives ${rubric}`
        );
      }
    }
    out.push('');
  }

  if (ev.teams.length) {
    let m = 0,
      a = 0,
      u = 0;
    for (const t of ev.teams)
      for (const mem of t.members) {
        if (mem.res?.status === 'MATCHED') m++;
        else if (mem.res?.status === 'AMBIGUOUS') a++;
        else u++;
      }
    out.push(
      `Placings parsed **${ev.teams.length}** (teams) · members matched **${m}** · ambiguous **${a}** · unmatched **${u}**`
    );
    out.push('');
    out.push(
      '| Row | Team | Sheet pts | Sheet houses | Member (sheet) | Hint | Result | Notes |'
    );
    out.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const t of ev.teams) {
      const place = ev.places.find((p) => p.label === t.place);
      const rubric = place?.points ?? 0;
      t.members.forEach((mem, k) => {
        const notes = resNotes(mem.res);
        if (mem.splitFrom)
          notes.push(`split out of "${mem.splitFrom}" — confirm`);
        out.push(
          `| ${k === 0 ? t.tabRow : ''} | ${k === 0 ? esc(`${t.category} — ${t.place}`) : ''} | ${k === 0 ? t.sheetPoints : ''} | ${k === 0 ? t.sheetHouses.map(cap).join(', ') : ''} | ${esc(mem.name)} | ${esc(mem.hint ?? t.category)} | ${esc(resCell(roster, mem.res))} | ${esc(notes.join('; '))} |`
        );
        const where = `row ${t.tabRow} (${t.category} — ${t.place})`;
        if (mem.res?.status !== 'MATCHED') {
          decisions.identify.push(
            `${ev.name} ${where} member "${mem.name}" (${mem.hint ?? t.category}): ${esc(resCell(roster, mem.res))}${mem.res?.notes.length ? ` (${mem.res.notes.join('; ')})` : ''}`
          );
          return;
        }
        if (mem.splitFrom)
          decisions.confirm.push(
            `${ev.name} ${where}: "${mem.splitFrom}" read as separate first names — "${mem.name}" → ${mem.res.cand.display}`
          );
        noteMatchQuality(decisions, ev.name, where, mem.name, mem.res);
        if (!houseOf(roster, mem.res.cand))
          noteNoHouse(decisions, mem.res.cand, `${ev.name} ${where}`);
      });
      if (t.members.length === 0)
        out.push(
          `| ${t.tabRow} | ${esc(`${t.category} — ${t.place}`)} | ${t.sheetPoints} | | (no names read) | | | |`
        );

      sheetHasHouses = true;
      const sheetSet = [...new Set(t.sheetHousesAll)];
      for (const h of sheetSet) sheetBasis[h] += t.sheetPoints;
      const matched = t.members
        .filter((x) => x.res?.status === 'MATCHED')
        .map((x) => (x.res as { cand: Candidate }).cand);
      const sisSet = [
        ...new Set(
          matched
            .map((c) => houseOf(roster, c))
            .filter((h): h is Colour => h !== null)
        ),
      ];
      const lbl = `row ${t.tabRow} (${t.category} — ${t.place})`;
      if (t.sheetPoints !== rubric) {
        explain.push(
          `${lbl}: sheet gave ${t.sheetPoints}, rubric gives ${rubric} — ${sisSet.map(cap).join(', ') || 'no house'} ${fmtDelta(rubric - t.sheetPoints)} each`
        );
        decisions.points.push(
          `${ev.name} ${lbl}: sheet gave ${t.sheetPoints}, rubric gives ${rubric} — imported as ${t.place} (${rubric}); keep, or change the event's rubric / this team's place?`
        );
      }
      const lost = sheetSet.filter((h) => !sisSet.includes(h));
      const gained = sisSet.filter((h) => !sheetSet.includes(h));
      if (lost.length || gained.length) {
        explain.push(
          `${lbl}: houses on the sheet ${sheetSet.map(cap).join(', ') || '—'}, from SIS houses of matched members ${sisSet.map(cap).join(', ') || '—'}` +
            `${lost.length ? ` — ${lost.map(cap).join(', ')} lose${lost.length === 1 ? 's' : ''} ${t.sheetPoints}` : ''}` +
            `${gained.length ? ` — ${gained.map(cap).join(', ')} gain${gained.length === 1 ? 's' : ''} ${rubric}` : ''}`
        );
      }
      // Per-member house disagreement, where the member count lines up.
      if (t.sheetHouses.length === t.members.length) {
        t.members.forEach((mem, k) => {
          if (mem.res?.status !== 'MATCHED') return;
          const sis = houseOf(roster, mem.res.cand);
          if (sis && sis !== t.sheetHouses[k]) {
            noteConflict(
              decisions,
              roster,
              mem.res.cand,
              t.sheetHouses[k],
              `${ev.name} row ${t.tabRow}`
            );
          }
        });
      }
    }
    out.push('');
  }

  if (ev.houses.length) {
    out.push('| House | Place | Sheet (tracker) pts |');
    out.push('| --- | --- | --- |');
    for (const h of ev.houses) {
      out.push(`| ${cap(h.colour)} | ${h.place} | ${h.sheetPoints} |`);
      sheetHasHouses = true;
      sheetBasis[h.colour] += h.sheetPoints;
    }
    out.push('');
  }

  if (ev.excluded.length) {
    out.push(
      `**EXCLUDED** by \`--exclude\` (${ev.excluded.length}) — not imported:`
    );
    for (const n of ev.excluded) out.push(`- ${n}`);
    out.push('');
    for (const c of COLOURS) {
      if (!ev.excludedBasis[c]) continue;
      sheetHasHouses = true;
      sheetBasis[c] += ev.excludedBasis[c];
      explain.push(
        `excluded rows: ${cap(c)} loses the ${ev.excludedBasis[c]} the sheet gave them`
      );
    }
    explain.push(...ev.excluded.map((n) => `EXCLUDED ${n}`));
  }

  if (ev.parseNotes.length) {
    out.push('Parse notes:');
    for (const n of ev.parseNotes) out.push(`- ${n}`);
    out.push('');
  }

  out.push(
    '| House | Tracker | Tab (its own rows) | Would import | Import − tracker |'
  );
  out.push('| --- | --- | --- | --- | --- |');
  for (const c of COLOURS) {
    const tr = tracker?.[c];
    const tabV = ev.tabTotals
      ? ev.tabTotals[c]
      : sheetHasHouses
        ? sheetBasis[c]
        : null;
    out.push(
      `| ${cap(c)} | ${tr ?? '—'} | ${tabV ?? '— (no house column)'} | ${computed[c]} | ${tr === undefined ? '—' : fmtDelta(computed[c] - tr)} |`
    );
  }
  out.push('');

  if (tracker) {
    if (sheetHasHouses) {
      const tabMismatch = COLOURS.filter((c) => sheetBasis[c] !== tracker[c]);
      if (tabMismatch.length) {
        explain.push(
          `the tab's own rows do not reproduce the tracker row for ${tabMismatch.map(cap).join(', ')} — check the parse`
        );
      }
    } else if (COLOURS.some((c) => computed[c] !== tracker[c])) {
      explain.push(
        'the tab has no house column, so the tracker row was worked out from a house lookup outside the workbook; the import uses each matched student’s current SIS house — the difference above is that lookup vs the SIS'
      );
    }
  }
  const diff = tracker
    ? COLOURS.some((c) => computed[c] !== tracker[c])
    : false;
  out.push(
    diff || explain.length
      ? '**Differences explained:**'
      : 'Matches the tracker row exactly.'
  );
  for (const e of explain) out.push(`- ${e}`);
  for (const n of pl.notes) out.push(`- ${n}`);
  if (pl.problems.length) {
    out.push('');
    out.push('**Blocks a write:**');
    for (const pr of pl.problems) out.push(`- ${pr}`);
  }
  out.push('');
}

// ─────────────────────────────────────────────────────────────────────────
// Write

type Actor = { id: string; email: string | null; role: string | null };

async function resolveActor(svc: Service): Promise<Actor> {
  if (!ACTOR_ID || !/^[0-9a-f-]{36}$/i.test(ACTOR_ID)) {
    throw new Error(
      '--write needs --actor <auth user uuid> (the person recorded as creating these events)'
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
  const writerRole = roles.find((r) =>
    (HOUSE_POINTS_WRITERS as readonly string[]).includes(r)
  );
  if (!writerRole) {
    throw new Error(
      `--actor ${data.user.email}: holds ${roles.join(', ') || 'no role'}, not a house-points writer (${HOUSE_POINTS_WRITERS.join(', ')})`
    );
  }
  const active =
    typeof meta.active_role === 'string' && roles.includes(meta.active_role)
      ? meta.active_role
      : writerRole;
  return {
    id: data.user.id,
    email: data.user.email ?? null,
    role: (HOUSE_POINTS_WRITERS as readonly string[]).includes(active)
      ? active
      : writerRole,
  };
}

async function writeAll(
  svc: Service,
  roster: Roster,
  planned: Planned[],
  actor: Actor
) {
  const created: string[] = [];
  const rollback = async (why: string) => {
    console.error(
      `\n✖ ${why}\n  rolling back ${created.length} event(s) this run created…`
    );
    for (const id of created) {
      const { error } = await svc
        .from('house_point_events')
        .delete()
        .eq('id', id);
      if (error)
        console.error(`  ✖ could not delete event ${id}: ${error.message}`);
    }
    process.exit(1);
  };
  const must = async (
    step: string,
    p: PromiseLike<{ data: unknown; error: { message: string } | null }>
  ): Promise<unknown> => {
    const { data, error } = await p;
    if (error || data === null) {
      await rollback(`${step}: ${error?.message ?? 'no rows returned'}`);
      throw new Error('unreachable');
    }
    return data;
  };

  for (const pl of planned) {
    const ev = pl.ev;
    const eventRow = await must(
      `${ev.name}: insert event`,
      svc
        .from('house_point_events')
        .insert({
          academic_year_id: roster.ayId,
          name: ev.name,
          held_on: null,
          event_type: ev.eventType,
          entrant_kind: ev.entrantKind,
          placement_mode: 'pick',
          max_score: null,
          rank_within: 'event',
          created_by: actor.id,
        })
        .select('id')
        .single()
    );
    const eventId = (eventRow as { id: string }).id;
    created.push(eventId);

    const placeRows = await must(
      `${ev.name}: insert places`,
      svc
        .from('house_point_places')
        .insert(
          ev.places.map((p, i) => ({
            event_id: eventId,
            label: p.label,
            rank: p.rank,
            points: p.points,
            sort_order: i,
          }))
        )
        .select('id, sort_order')
    );
    const placeId = new Map(
      (placeRows as { id: string; sort_order: number }[]).map((r) => [
        r.sort_order,
        r.id,
      ])
    );

    const entries: Record<string, unknown>[] = [];
    for (const e of pl.studentEntries) {
      entries.push({
        event_id: eventId,
        section_student_id: e.cand.sectionStudentId,
        place_id: placeId.get(e.placeIdx),
        created_by: actor.id,
      });
    }
    for (const e of pl.houseEntries) {
      entries.push({
        event_id: eventId,
        house_id: roster.houseIdByColour.get(e.colour),
        place_id: placeId.get(e.placeIdx),
        created_by: actor.id,
      });
    }
    for (const t of pl.teamEntries) {
      const teamRow = await must(
        `${ev.name}: insert team "${t.name}"`,
        svc
          .from('house_point_teams')
          .insert({ event_id: eventId, name: t.name })
          .select('id')
          .single()
      );
      const teamId = (teamRow as { id: string }).id;
      await must(
        `${ev.name}: insert members of "${t.name}"`,
        svc
          .from('house_point_team_members')
          .insert(
            t.members.map((m) => ({
              team_id: teamId,
              section_student_id: m.sectionStudentId,
            }))
          )
          .select('team_id')
      );
      entries.push({
        event_id: eventId,
        team_id: teamId,
        place_id: placeId.get(t.placeIdx),
        created_by: actor.id,
      });
    }
    if (entries.length) {
      await must(
        `${ev.name}: insert entries`,
        svc.from('house_point_entries').insert(entries).select('id')
      );
    }

    await logAction({
      service: svc,
      actor,
      action: 'house_points.event.create',
      entityType: 'house_point_event',
      entityId: eventId,
      context: {
        source: SOURCE,
        eventName: ev.name,
        name: ev.name,
        eventType: ev.eventType,
        entrantKind: ev.entrantKind,
        placementMode: 'pick',
        heldOn: null,
        places: ev.places.map((p) => ({
          label: p.label,
          rank: p.rank,
          points: p.points,
        })),
        entries: entries.length,
        teams: pl.teamEntries.length,
      },
    });
    console.log(
      `  ✅ ${ev.name}: ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Main

async function main() {
  const svc = createServiceClient();
  const wb = XLSX.readFile(WORKBOOK);
  const roster = await loadRoster(svc);

  const trackerParsed = parseTracker(readGrid(wb, 'Overall Points Tracker'));
  const unknownTabs = wb.SheetNames.filter(
    (n) => !SKIPPED_TABS.includes(n) && !SPECS.some((s) => s.tab === n)
  );

  const events: EventDef[] = [];
  for (const spec of SPECS) {
    const ev: EventDef = {
      name: spec.tracker,
      tab: spec.tab,
      eventType: spec.eventType,
      entrantKind: spec.entrantKind,
      places: spec.places,
      students: [],
      teams: [],
      houses: [],
      parseNotes: [],
      tabTotals: null,
      excluded: [],
      excludedBasis: { BLUE: 0, ORANGE: 0, YELLOW: 0, GREEN: 0 },
    };
    if (!trackerParsed.rows.has(spec.tracker))
      throw new Error(`tracker row "${spec.tracker}" not found`);
    if (spec.tab && spec.parse) {
      spec.parse(readGrid(wb, spec.tab), ev, roster);
    } else {
      // Sports Fest: the tracker row's points ARE the house placings.
      const row = trackerParsed.rows.get(spec.tracker)!;
      for (const c of COLOURS) {
        const place = spec.places.find((p) => p.points === row[c]);
        if (!place)
          throw new Error(
            `${spec.tracker}: ${cap(c)} ${row[c]} matches no place`
          );
        ev.houses.push({ colour: c, place: place.label, sheetPoints: row[c] });
      }
    }
    resolveEvent(roster, ev);
    applyDecisionFlags(roster, ev);
    events.push(ev);
  }
  const unusedFlags = [
    ...OVERRIDES.filter((o) => !o.used).map((o) => `--member "${o.raw}"`),
    ...EXCLUSIONS.filter((x) => !x.used).map((x) => `--exclude "${x.raw}"`),
  ];
  if (unusedFlags.length) {
    throw new Error(
      `these flags matched no row (check the event name, row and label):\n  ${unusedFlags.join('\n  ')}`
    );
  }

  // Validate every event against the write route's own contract.
  const schemaProblems: string[] = [];
  for (const ev of events) {
    const parsed = EventInputSchema.safeParse({
      ayCode: AY,
      name: ev.name,
      heldOn: null,
      eventType: ev.eventType,
      entrantKind: ev.entrantKind,
      placementMode: 'pick',
      maxScore: null,
      rankWithin: 'event',
      places: ev.places,
    });
    if (!parsed.success)
      schemaProblems.push(
        `${ev.name}: ${parsed.error.issues.map((i) => i.message).join('; ')}`
      );
  }

  const planned = events.map((ev) => plan(ev, roster));
  const out: string[] = [];
  const decisions = newDecisions();
  const grand = zero();
  const grandSheet = zero();

  const prelude: string[] = [];
  prelude.push(`# AY2026 house points import — ${WRITE ? 'WRITE' : 'dry run'}`);
  prelude.push('');
  prelude.push(
    `Generated ${new Date().toISOString()} from \`${WORKBOOK}\` against ${AY} (${roster.candidates.length} students across ${roster.sections.length} classes).`
  );
  prelude.push('');
  prelude.push(
    'Points follow each student’s CURRENT SIS house (KD #228); the house typed on the sheet is only compared, never used.'
  );
  prelude.push('');
  prelude.push(
    `Skipped tabs: ${SKIPPED_TABS.map((t) => `\`${t}\``).join(', ')}.${unknownTabs.length ? ` ⚠ Tabs not handled: ${unknownTabs.join(', ')}` : ''}`
  );
  for (const n of trackerParsed.notes) prelude.push(`- ${n}`);
  prelude.push('');

  const summary: string[] = [];
  for (const pl of planned) {
    const computed = computeTotals(pl, roster);
    const withSheet = computeTotals(pl, roster, true);
    for (const c of COLOURS) {
      grand[c] += computed[c];
      grandSheet[c] += withSheet[c];
    }
    const tr = trackerParsed.rows.get(pl.ev.name);
    reportEvent(pl, roster, tr, computed, out, decisions);
    const st = pl.ev.students.map((r) => r.res?.status);
    const mem = pl.ev.teams.flatMap((t) => t.members.map((m) => m.res?.status));
    const all = [...st, ...mem];
    const count = (s: string) => all.filter((x) => x === s).length;
    summary.push(
      `| ${pl.ev.name} | ${all.length || pl.ev.houses.length}${mem.length ? ' members' : pl.ev.houses.length ? ' houses' : ''} | ${pl.ev.houses.length ? pl.ev.houses.length : count('MATCHED')} | ${count('AMBIGUOUS')} | ${count('UNMATCHED')} | ${pl.ev.excluded.length} | ${COLOURS.map((c) => computed[c]).join(' / ')} | ${tr ? COLOURS.map((c) => tr[c]).join(' / ') : '—'} |`
    );
  }

  const head: string[] = [];
  head.push('## Summary');
  head.push('');
  head.push(
    '| Event | Rows | Matched | Ambiguous | Unmatched | Excluded | Would import B/O/Y/G | Tracker B/O/Y/G |'
  );
  head.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  const flagsUsed = [
    ...OVERRIDES.map((o) => `--member "${o.raw}"`),
    ...EXCLUSIONS.map((x) => `--exclude "${x.raw}"`),
  ];
  if (flagsUsed.length) {
    prelude.push(
      `Decision flags applied: ${flagsUsed.map((f) => `\`${f}\``).join(', ')}`
    );
    prelude.push('');
  }
  head.push(...summary);
  head.push('');
  const tt = trackerParsed.total;
  head.push(
    '| House | Tracker total | Would import (SIS houses) | Difference | What-if: sheet houses where the sheet has one | Difference |'
  );
  head.push('| --- | --- | --- | --- | --- | --- |');
  for (const c of COLOURS) {
    head.push(
      `| ${cap(c)} | ${tt?.[c] ?? '—'} | ${grand[c]} | ${tt ? fmtDelta(grand[c] - tt[c]) : '—'} | ${grandSheet[c]} | ${tt ? fmtDelta(grandSheet[c] - tt[c]) : '—'} |`
    );
  }
  head.push('');
  head.push(
    `Totals: would import ${COLOURS.reduce((n, c) => n + grand[c], 0)} points to a house; the tracker totals ${tt ? COLOURS.reduce((n, c) => n + tt[c], 0) : '—'}. The what-if column is not an option the script offers — it only shows how much of the gap is the SIS house data rather than the import.`
  );
  head.push('');

  // House agreement across every matched row that carries a sheet house.
  let agree = 0;
  let disagree = 0;
  for (const pl of planned) {
    for (const e of pl.studentEntries) {
      const sis = houseOf(roster, e.cand);
      if (!e.row.sheetHouse || !sis) continue;
      if (sis === e.row.sheetHouse) agree++;
      else disagree++;
    }
    for (const t of pl.ev.teams) {
      if (t.sheetHouses.length !== t.members.length) continue;
      t.members.forEach((m, k) => {
        if (m.res?.status !== 'MATCHED') return;
        const sis = houseOf(roster, m.res.cand);
        if (!sis) return;
        if (sis === t.sheetHouses[k]) agree++;
        else disagree++;
      });
    }
  }
  head.push(
    `**House agreement:** of ${agree + disagree} matched rows where both the sheet and the SIS name a house, ${agree} agree and **${disagree} disagree** (${decisions.houseConflicts.size} distinct students).`
  );
  head.push('');
  const blockers = planned.flatMap((p) =>
    p.problems.map((x) => `${p.ev.name}: ${x}`)
  );
  const unresolved = planned.reduce((n, p) => n + p.unresolved, 0);
  if (schemaProblems.length || blockers.length) {
    head.push('**Blocks a write:**');
    for (const s of [...schemaProblems, ...blockers]) head.push(`- ${s}`);
    head.push('');
  }
  head.push('## Decisions for Mr Ace');
  head.push('');
  const section = (title: string, lines: string[]) => {
    if (!lines.length) return;
    head.push(`### ${title} (${lines.length})`);
    head.push('');
    for (const l of [...new Set(lines)]) head.push(`- ${l}`);
    head.push('');
  };
  section(
    'Students not identified — not imported until resolved',
    decisions.identify
  );
  section(
    'SIS house disagrees with the sheet — the import uses the SIS house',
    [...decisions.houseConflicts.values()]
      .sort((a, b) => a.who.localeCompare(b.who))
      .map(
        (e) =>
          `${e.who}: SIS ${cap(e.sis)}; sheet ${[...e.sheet].map(([c, w]) => `${cap(c)} (${w.join(', ')})`).join('; ')}`
      )
  );
  section(
    'No SIS house — their points go to no house',
    [...decisions.noHouse.values()].map(
      (e) => `${e.who}: ${e.where.join('; ')}`
    )
  );
  section(
    'Points the rubric gives differently from the sheet',
    decisions.points
  );
  section('Matches to confirm', decisions.confirm);
  section('For information', decisions.info);
  const decisionCount =
    decisions.identify.length +
    decisions.houseConflicts.size +
    decisions.noHouse.size +
    decisions.points.length +
    decisions.confirm.length;
  if (decisionCount === 0) head.push('None.');

  const report = [...prelude, ...head, ...out].join('\n');
  if (REPORT_PATH) {
    writeFileSync(REPORT_PATH, report, 'utf8');
    console.log(`Report written to ${REPORT_PATH}`);
  } else {
    console.log(report);
  }
  console.log(
    `\nWould import B/O/Y/G: ${COLOURS.map((c) => grand[c]).join(' / ')}${tt ? `  (tracker ${COLOURS.map((c) => tt[c]).join(' / ')})` : ''}`
  );
  console.log(
    `Unresolved rows/members: ${unresolved}; write blockers: ${schemaProblems.length + blockers.length}; decisions: ${decisionCount}`
  );

  if (!WRITE) {
    console.log(
      '\nDRY RUN — nothing written. Re-run with --write --actor <uuid> to insert.'
    );
    return;
  }

  // ── Write-mode gates ──
  if (schemaProblems.length || blockers.length)
    throw new Error('refusing to write: see "Blocks a write" in the report');
  if (unresolved > 0 && !SKIP_UNRESOLVED) {
    throw new Error(
      `refusing to write: ${unresolved} row(s)/member(s) are AMBIGUOUS or UNMATCHED — resolve them, or pass --skip-unresolved to import only the matched ones`
    );
  }
  const actor = await resolveActor(svc);

  const { data: existing, error: exErr } = await svc
    .from('house_point_events')
    .select('id, name')
    .eq('academic_year_id', roster.ayId);
  if (exErr) throw new Error(`existing events read failed: ${exErr.message}`);
  const existingRows = (existing ?? []) as { id: string; name: string }[];
  if (existingRows.length > 0) {
    if (!REPLACE) {
      throw new Error(
        `refusing to write: ${AY} already has ${existingRows.length} house point event(s) (${existingRows.map((e) => e.name).join('; ')}). Pass --replace-ay2026 to delete them first.`
      );
    }
    console.log(
      `\nDeleting ${existingRows.length} existing ${AY} event(s) (cascades to places, teams, entries)…`
    );
    const { error } = await svc
      .from('house_point_events')
      .delete()
      .eq('academic_year_id', roster.ayId);
    if (error) throw new Error(`delete failed: ${error.message}`);
  }

  console.log(
    `\nWriting ${planned.length} events as ${actor.email} (${actor.role})…`
  );
  await writeAll(svc, roster, planned, actor);
  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
