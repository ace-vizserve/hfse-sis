// lib/sis/backfill/grading/build-t3-grading-import.ts
// Composes the AY2026 Term 3 grading import: parsed workbooks
// (grading-workbook-t3.ts) + a read-only snapshot of production → a dry-run
// report, and per-track preview + apply SQL. No I/O.
//
// How this differs from the T1/T2 composers (build-*-grading-import.ts), and
// why — every difference is a lesson from an earlier import:
//
//  1. NO subject_configs WRITE. T2's composer upserted year-level weights
//     from each term's workbook header, which is how FIL/GP were moved to
//     40/40/20 and had to be corrected (gen-ay2026-t2-fil-gp-weight-
//     correction.ts). KD #218: a subject's weights are the same every term; a
//     term may only switch a component off. The SIS weights are used; a
//     header that disagrees is REPORTED, never written.
//  2. THE SHEETS ALREADY EXIST. T3 grading sheets were generated in the SIS
//     (unlocked, placeholder totals). T2 inserted sheets with `on conflict do
//     nothing` — here that would silently keep the placeholder totals. The
//     apply UPDATES each sheet's totals by id, guarded on the values seen in
//     the dry run.
//  3. STUDENTS ARE MATCHED BY NAME WITHIN THE SECTION, not by index number.
//     The SIS was re-aligned to the school's class list (2026-09-17) and ~21
//     index numbers moved relative to the workbooks
//     (ay2026-t3-roster-alignment-report.txt); T2's (section, index) key would
//     file one child's grade against another. The index is only a tiebreak.
//  4. A SHEET'S SECTION IS CHOSEN BY ITS STUDENTS' NAMES, among the section
//     the tab name says and the section row 2 says, and must be a real
//     section. T2's tab-name-wins + truncation rule dropped CA "Integrity 2"
//     silently (the resolved name matched no section and the join wrote 0
//     rows).
//  5. NOTHING IS OVERWRITTEN SILENTLY. An existing grade row that already
//     holds a mark is listed, and the apply refuses to run if a row gained a
//     mark after the dry run. (T2's Science/Discipline 1 phantom tab won an
//     `on conflict do nothing` race and wrote the wrong child's marks.)
//  6. THE DATABASE MUST AGREE WITH THE DRY RUN. The derive trigger computes
//     every stored grade (KD #225, migrations 177/178/179); the apply ends by
//     asserting each written row's quarterly grade equals the one this file
//     computed with lib/compute/quarterly.ts, and rolls back otherwise.
//  7. Out-of-range marks are never sent: the derive trigger raises on a
//     score above its max, which would abort the whole transaction.
import { computeQuarterly } from '@/lib/compute/quarterly';
import { redistributeWeights } from '@/lib/grading/resolve-sheet-weights';
import { sqlString } from '../enrollment/sql-escape';
import type {
  ParsedT3Sheet,
  ParsedT3Student,
  T3Identity,
} from './grading-workbook-t3';

// ---------------------------------------------------------------- inputs

export interface SisSection {
  id: string;
  levelCode: string;
  name: string;
}

export interface SisRosterRow {
  sectionStudentId: string;
  sectionId: string;
  indexNumber: number;
  enrollmentStatus: 'active' | 'late_enrollee' | 'withdrawn' | string;
  enrollmentDate: string | null;
  withdrawalDate: string | null;
  studentNumber: string;
  lastName: string;
  firstName: string;
}

export interface SisSheet {
  id: string;
  sectionId: string;
  subjectCode: string;
  isExaminable: boolean;
  wwTotals: number[];
  ptTotals: number[];
  qaTotal: number | null;
  wwWeight: number | null;
  ptWeight: number | null;
  qaWeight: number | null;
  isLocked: boolean;
  teacherName: string | null;
  slotLabelsSet: boolean;
}

export interface SisConfig {
  subjectCode: string;
  wwWeight: number;
  ptWeight: number;
  qaWeight: number;
  wwMaxSlots: number;
  ptMaxSlots: number;
  qaMax: number | null;
}

export interface SisEntry {
  id: string;
  sheetId: string;
  sectionStudentId: string;
  wwScores: (number | null)[];
  ptScores: (number | null)[];
  qaScore: number | null;
  isNa: boolean;
  letterGrade: string | null;
  wwExcused: number[];
  ptExcused: number[];
  quarterlyGrade: number | null;
}

export interface BuildT3Input {
  sheets: ParsedT3Sheet[];
  skippedTabs: { file: string; sheetName: string; reason: string }[];
  sections: SisSection[];
  roster: SisRosterRow[];
  sisSheets: SisSheet[];
  configs: SisConfig[];
  entries: SisEntry[];
  termStart: string;
  termEnd: string;
  generatedAt: string;
}

// ---------------------------------------------------------------- names

function clean(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .join(' ')
    .trim();
}

// "LAST, First Middle-initial." → "LAST|FIRST"
function nameKey(raw: string): string {
  const i = raw.indexOf(',');
  const last = i >= 0 ? raw.slice(0, i) : raw;
  const first = i >= 0 ? raw.slice(i + 1) : '';
  return `${clean(last)}|${clean(first)}`;
}

function namesAgree(a: string, b: string): boolean {
  if (a === b) return true;
  const [al, af] = a.split('|');
  const [bl, bf] = b.split('|');
  if (al !== bl || !af || !bf) return false;
  return af.startsWith(bf) || bf.startsWith(af);
}

function wordSet(raw: string): Set<string> {
  return new Set(clean(raw.replace(',', ' ')).split(' ').filter(Boolean));
}

function overlapScore(a: string, b: string): number {
  const wa = wordSet(a);
  const wb = wordSet(b);
  let hit = 0;
  for (const w of wa) if (wb.has(w)) hit++;
  return hit / Math.max(1, Math.min(wa.size, wb.size));
}

const dbName = (r: SisRosterRow) => `${r.lastName}, ${r.firstName}`;

type MatchMethod = 'name' | 'name+index' | 'close-name';

function matchInSection(
  st: ParsedT3Student,
  roster: SisRosterRow[]
): { row: SisRosterRow; method: MatchMethod } | { row: null; why: string } {
  const key = nameKey(st.fullName);
  const exact = roster.filter((r) => namesAgree(key, nameKey(dbName(r))));
  if (exact.length === 1) return { row: exact[0], method: 'name' };
  if (exact.length > 1) {
    const byIdx = exact.filter((r) => r.indexNumber === st.indexNo);
    if (byIdx.length === 1) return { row: byIdx[0], method: 'name+index' };
    return {
      row: null,
      why: `name fits ${exact.length} students in the class (${exact.map(dbName).join(' / ')})`,
    };
  }
  const scored = roster
    .map((r) => ({ r, s: overlapScore(st.fullName, dbName(r)) }))
    .sort((a, b) => b.s - a.s);
  const best = scored[0];
  const second = scored[1];
  // Same surname required; at least two thirds of the shorter name's words
  // shared; and a clear winner.
  if (
    best &&
    best.s >= 0.66 &&
    (!second || second.s < best.s) &&
    clean(best.r.lastName).split(' ')[0] ===
      nameKey(st.fullName).split('|')[0].split(' ')[0]
  ) {
    return { row: best.r, method: 'close-name' };
  }
  return { row: null, why: 'no student of that name in the class' };
}

// ---------------------------------------------------------------- helpers

const TOL = 0.011;
const near = (a: number | null, b: number | null) =>
  a != null && b != null && Math.abs(a - b) <= TOL;
const fmt = (n: number | null | undefined, dp = 2) =>
  n == null ? '—' : Number.isInteger(n) ? String(n) : n.toFixed(dp);
const arr = (a: (number | null)[]) =>
  `[${a.map((v) => (v == null ? '·' : fmt(v))).join(', ')}]`;
const hasData = (e: {
  wwScores: (number | null)[];
  ptScores: (number | null)[];
  qaScore: number | null;
}) =>
  e.qaScore != null ||
  e.wwScores.some((v) => v != null) ||
  e.ptScores.some((v) => v != null);

// The transmutation, reached THROUGH lib/compute/quarterly.ts (Hard Rule #2 —
// no second copy): one WW slot out of 100 at weight 1 makes initial = x.
function transmuteViaFormula(initial: number): number | null {
  return computeQuarterly({
    ww_scores: [initial],
    ww_totals: [100],
    pt_scores: [],
    pt_totals: [],
    qa_score: null,
    qa_total: null,
    ww_weight: 1,
    pt_weight: 0,
    qa_weight: 0,
  }).quarterly_grade;
}

function subsets(xs: number[]): number[][] {
  const out: number[][] = [];
  for (let m = 1; m < 1 << xs.length; m++)
    out.push(xs.filter((_, i) => m & (1 << i)));
  return out;
}

function sqlNumArr(a: (number | null)[]): string {
  return `ARRAY[${a.map((v) => (v == null ? 'null' : String(v))).join(',')}]::numeric[]`;
}

// ---------------------------------------------------------------- result types

interface ResolvedSheet {
  parsed: ParsedT3Sheet;
  track: 'primary' | 'secondary';
  section: SisSection;
  sisSheet: SisSheet;
  config: SisConfig;
  identityNote: string | null;
  weights: { ww: number; pt: number; qa: number };
  sheetWeightColumns: { ww: number; pt: number; qa: number } | null; // null = inherit
  inUse: { ww: boolean; pt: boolean; qa: boolean };
  notes: string[];
  rows: RowOutcome[];
  rosterMissing: SisRosterRow[];
}

interface RowOutcome {
  st: ParsedT3Student;
  match: SisRosterRow | null;
  method: MatchMethod | null;
  unmatchedWhy: string | null;
  foundElsewhere: string | null;
  action:
    | 'insert'
    | 'update-blank-row'
    | 'overwrite'
    | 'unchanged'
    | 'skip-blank'
    | 'blocked'
    | 'unmatched';
  blockedWhy: string | null;
  existing: SisEntry | null;
  wwScores: (number | null)[];
  ptScores: (number | null)[];
  qaScore: number | null;
  computed: ReturnType<typeof computeQuarterly> | null;
  mismatch: string | null;
}

export interface BuildT3Result {
  report: string;
  files: { name: string; sql: string }[];
  stats: Record<string, number>;
  /** Every row the apply writes, with the exact inputs the derive trigger will see. */
  writtenRows: {
    label: string;
    ww_scores: (number | null)[];
    ww_totals: number[];
    pt_scores: (number | null)[];
    pt_totals: number[];
    qa_score: number | null;
    qa_total: number | null;
    ww_weight: number;
    pt_weight: number;
    qa_weight: number;
    ww_excused: number[];
    pt_excused: number[];
    expectedQuarterly: number | null;
  }[];
}

// ---------------------------------------------------------------- main

export function buildT3GradingImport(input: BuildT3Input): BuildT3Result {
  const sectionsByLevel = new Map<string, SisSection[]>();
  for (const s of input.sections) {
    sectionsByLevel.set(s.levelCode, [
      ...(sectionsByLevel.get(s.levelCode) ?? []),
      s,
    ]);
  }
  const rosterBySection = new Map<string, SisRosterRow[]>();
  for (const r of input.roster) {
    rosterBySection.set(r.sectionId, [
      ...(rosterBySection.get(r.sectionId) ?? []),
      r,
    ]);
  }
  const sectionById = new Map(input.sections.map((s) => [s.id, s]));
  const configByCode = new Map(input.configs.map((c) => [c.subjectCode, c]));
  const entryByKey = new Map(
    input.entries.map((e) => [`${e.sheetId}|${e.sectionStudentId}`, e])
  );
  const sisSheetByKey = new Map(
    input.sisSheets.map((s) => [`${s.subjectCode}|${s.sectionId}`, s])
  );

  const findSection = (id: T3Identity | null): SisSection | null => {
    if (!id) return null;
    const list = sectionsByLevel.get(id.levelCode) ?? [];
    const exact = list.find(
      (s) => s.name.toLowerCase() === id.sectionName.toLowerCase()
    );
    if (exact) return exact;
    // "Consistency 3" → "Consistency" when only the bare name exists.
    const bare = id.sectionName.replace(/\s+\d+$/, '');
    if (bare !== id.sectionName) {
      const b = list.find((s) => s.name.toLowerCase() === bare.toLowerCase());
      if (b) return b;
    }
    return null;
  };

  const countNameMatches = (sheet: ParsedT3Sheet, sectionId: string) => {
    const roster = rosterBySection.get(sectionId) ?? [];
    return sheet.students.filter((st) => matchInSection(st, roster).row).length;
  };

  const unplaceableSheets: string[] = [];
  const resolved: ResolvedSheet[] = [];

  for (const parsed of input.sheets) {
    const where = `${parsed.file} › "${parsed.sheetName}"`;
    const cands = new Map<string, { sec: SisSection; from: string[] }>();
    for (const [from, id] of [
      ['tab name', parsed.tabIdentity],
      ['row 2', parsed.row2Identity],
    ] as const) {
      const sec = findSection(id);
      if (!sec) continue;
      const c = cands.get(sec.id) ?? { sec, from: [] };
      c.from.push(from);
      cands.set(sec.id, c);
    }
    if (cands.size === 0) {
      unplaceableSheets.push(
        `${where}: neither the tab name nor row 2 ("${parsed.row2Raw}") names a real AY2026 section — not imported`
      );
      continue;
    }
    const ranked = [...cands.values()]
      .map((c) => ({ ...c, n: countNameMatches(parsed, c.sec.id) }))
      .sort(
        (a, b) =>
          b.n - a.n ||
          Number(b.from.includes('tab name')) -
            Number(a.from.includes('tab name'))
      );
    const chosen = ranked[0];
    let identityNote: string | null = null;
    const tabSec = findSection(parsed.tabIdentity);
    const r2Sec = findSection(parsed.row2Identity);
    const label = (id: T3Identity | null) =>
      id ? `${id.levelCode} ${id.sectionName}` : '(unreadable)';
    const sameName = (id: T3Identity | null) =>
      !!id &&
      id.levelCode === chosen.sec.levelCode &&
      id.sectionName.toLowerCase() === chosen.sec.name.toLowerCase();
    if (
      !tabSec ||
      !r2Sec ||
      tabSec.id !== r2Sec.id ||
      !sameName(parsed.tabIdentity) ||
      !sameName(parsed.row2Identity)
    ) {
      identityNote = `tab name says ${label(parsed.tabIdentity)}${tabSec ? '' : ' (no such section)'}, row 2 says ${label(parsed.row2Identity)}${r2Sec ? '' : ' (no such section)'} — using ${chosen.sec.levelCode} ${chosen.sec.name}, where ${chosen.n} of ${parsed.students.length} names match${ranked[1] ? ` (vs ${ranked[1].n} in ${ranked[1].sec.levelCode} ${ranked[1].sec.name})` : ''}`;
    }
    // Would another section of the AY fit these names better? Name it.
    let betterElsewhere: string | null = null;
    for (const s of input.sections) {
      if (s.id === chosen.sec.id) continue;
      const n = countNameMatches(parsed, s.id);
      if (n > chosen.n) {
        betterElsewhere = `${s.levelCode} ${s.name} matches ${n} names vs ${chosen.n} in the chosen ${chosen.sec.levelCode} ${chosen.sec.name}`;
      }
    }
    if (betterElsewhere) {
      unplaceableSheets.push(
        `${where}: identity doubtful — ${betterElsewhere}; NOT imported until a person confirms which class this tab is`
      );
      continue;
    }

    const sisSheet = sisSheetByKey.get(
      `${parsed.subjectCode}|${chosen.sec.id}`
    );
    if (!sisSheet) {
      unplaceableSheets.push(
        `${where}: the SIS has no T3 ${parsed.subjectCode} grading sheet for ${chosen.sec.levelCode} ${chosen.sec.name} — not imported`
      );
      continue;
    }
    const config = configByCode.get(parsed.subjectCode);
    if (!config) {
      unplaceableSheets.push(
        `${where}: no AY2026 subject config for ${parsed.subjectCode} — not imported`
      );
      continue;
    }

    const notes: string[] = [];
    const inUse = {
      ww: parsed.wwTotals.length > 0,
      pt: parsed.ptTotals.length > 0,
      qa: parsed.qaTotal != null,
    };
    const base = {
      ww_weight: config.wwWeight,
      pt_weight: config.ptWeight,
      qa_weight: config.qaWeight,
    };
    const allOn = inUse.ww && inUse.pt && inUse.qa;
    const w = allOn ? base : redistributeWeights(base, inUse);
    const weights = { ww: w.ww_weight, pt: w.pt_weight, qa: w.qa_weight };
    const sheetWeightColumns = allOn ? null : weights;

    const hw = parsed.headerWeights;
    if (
      !(
        near(hw.ww, config.wwWeight) &&
        near(hw.pt, config.ptWeight) &&
        near(hw.qa, config.qaWeight)
      )
    ) {
      notes.push(
        `workbook header weights ${fmt((hw.ww ?? 0) * 100, 0)}/${fmt((hw.pt ?? 0) * 100, 0)}/${fmt((hw.qa ?? 0) * 100, 0)} differ from the SIS subject weights ${fmt(config.wwWeight * 100, 0)}/${fmt(config.ptWeight * 100, 0)}/${fmt(config.qaWeight * 100, 0)} — the SIS weights are used (KD #218)`
      );
    }
    if (!allOn) {
      notes.push(
        `components off this term: ${(['ww', 'pt', 'qa'] as const)
          .filter((k) => !inUse[k])
          .map((k) => k.toUpperCase())
          .join(
            ', '
          )} — sheet weights set to ${fmt(weights.ww * 100, 0)}/${fmt(weights.pt * 100, 0)}/${fmt(weights.qa * 100, 0)}`
      );
    }
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    if (
      parsed.printedWwTotalMax != null &&
      !near(parsed.printedWwTotalMax, sum(parsed.wwTotals))
    )
      notes.push(
        `WW max row prints Total ${fmt(parsed.printedWwTotalMax)} but its slots add to ${fmt(sum(parsed.wwTotals))}`
      );
    if (
      parsed.printedPtTotalMax != null &&
      !near(parsed.printedPtTotalMax, sum(parsed.ptTotals))
    )
      notes.push(
        `PT max row prints Total ${fmt(parsed.printedPtTotalMax)} but its slots add to ${fmt(sum(parsed.ptTotals))}`
      );
    if (parsed.wwTotals.length > config.wwMaxSlots)
      notes.push(
        `⚠ ${parsed.wwTotals.length} WW slots exceed the subject's ceiling of ${config.wwMaxSlots} (the SIS totals editor would refuse this)`
      );
    if (parsed.ptTotals.length > config.ptMaxSlots)
      notes.push(
        `⚠ ${parsed.ptTotals.length} PT slots exceed the subject's ceiling of ${config.ptMaxSlots} (the SIS totals editor would refuse this)`
      );
    if (sisSheet.isLocked)
      notes.push('⚠ the SIS sheet is LOCKED — nothing on it is written');
    if (sisSheet.slotLabelsSet)
      notes.push(
        'the SIS sheet already has activity labels set; the import leaves them as they are'
      );

    resolved.push({
      parsed,
      track: chosen.sec.levelCode.startsWith('P') ? 'primary' : 'secondary',
      section: chosen.sec,
      sisSheet,
      config,
      identityNote,
      weights,
      sheetWeightColumns,
      inUse,
      notes,
      rows: [],
      rosterMissing: [],
    });
  }

  // Two tabs landing on the same SIS sheet: keep neither silently — keep the
  // one with more name matches and name the other.
  const bySheet = new Map<string, ResolvedSheet[]>();
  for (const r of resolved)
    bySheet.set(r.sisSheet.id, [...(bySheet.get(r.sisSheet.id) ?? []), r]);
  const kept: ResolvedSheet[] = [];
  for (const group of bySheet.values()) {
    if (group.length === 1) {
      kept.push(group[0]);
      continue;
    }
    const ranked = group
      .map((g) => ({ g, n: countNameMatches(g.parsed, g.section.id) }))
      .sort((a, b) => b.n - a.n);
    kept.push(ranked[0].g);
    for (const o of ranked.slice(1))
      unplaceableSheets.push(
        `${o.g.parsed.file} › "${o.g.parsed.sheetName}": resolves to the same SIS sheet as "${ranked[0].g.parsed.sheetName}" (${o.n} vs ${ranked[0].n} name matches) — the other tab is used, this one is not imported`
      );
  }

  // ------------------------------------------------ rows
  const allRosterByName = input.roster.map((r) => ({
    r,
    key: nameKey(dbName(r)),
  }));
  const termStart = input.termStart;

  for (const rs of kept) {
    const roster = rosterBySection.get(rs.section.id) ?? [];
    const used = new Map<string, ParsedT3Student>();
    const { parsed, sisSheet } = rs;
    const locked = sisSheet.isLocked;

    for (const st of parsed.students) {
      const m = matchInSection(st, roster);
      const out: RowOutcome = {
        st,
        match: null,
        method: null,
        unmatchedWhy: null,
        foundElsewhere: null,
        action: 'unmatched',
        blockedWhy: null,
        existing: null,
        wwScores: st.wwScores,
        ptScores: st.ptScores,
        qaScore: st.examScore,
        computed: null,
        mismatch: null,
      };
      rs.rows.push(out);
      if (!m.row) {
        out.unmatchedWhy = m.why;
        const key = nameKey(st.fullName);
        const else_ = allRosterByName.filter((x) => namesAgree(key, x.key));
        if (else_.length) {
          out.foundElsewhere = else_
            .map((x) => {
              const s = sectionById.get(x.r.sectionId);
              return `${s?.levelCode} ${s?.name} #${x.r.indexNumber} (${x.r.studentNumber}${x.r.enrollmentStatus !== 'active' ? `, ${x.r.enrollmentStatus}` : ''})`;
            })
            .join('; ');
        }
        const occupant = roster.find((r) => r.indexNumber === st.indexNo);
        if (occupant)
          out.unmatchedWhy += `; SIS index #${st.indexNo} in this class is ${dbName(occupant)}`;
        continue;
      }
      out.match = m.row;
      out.method = m.method;
      const prior = used.get(m.row.sectionStudentId);
      if (prior) {
        out.action = 'blocked';
        out.blockedWhy = `a second workbook row (#${prior.indexNo} "${prior.fullName}") matched the same student`;
        continue;
      }
      used.set(m.row.sectionStudentId, st);

      const existing =
        entryByKey.get(`${sisSheet.id}|${m.row.sectionStudentId}`) ?? null;
      out.existing = existing;

      const rowHas = hasData({
        wwScores: st.wwScores,
        ptScores: st.ptScores,
        qaScore: st.examScore,
      });
      if (!rowHas) {
        out.action = 'skip-blank';
        continue;
      }

      // out-of-range marks — the derive trigger would abort the apply
      const bad: string[] = [];
      st.wwScores.forEach((v, i) => {
        if (v != null && (v < 0 || v > parsed.wwTotals[i]))
          bad.push(`W${i + 1}=${v} (max ${parsed.wwTotals[i]})`);
      });
      st.ptScores.forEach((v, i) => {
        if (v != null && (v < 0 || v > parsed.ptTotals[i]))
          bad.push(`PT${i + 1}=${v} (max ${parsed.ptTotals[i]})`);
      });
      if (
        st.examScore != null &&
        (parsed.qaTotal == null ||
          st.examScore < 0 ||
          st.examScore > parsed.qaTotal)
      )
        bad.push(`Exam=${st.examScore} (max ${parsed.qaTotal ?? 'none'})`);
      if (bad.length) {
        out.action = 'blocked';
        out.blockedWhy = `mark outside its max: ${bad.join(', ')}`;
        continue;
      }
      if (locked) {
        out.action = 'blocked';
        out.blockedWhy = 'the SIS sheet is locked';
        continue;
      }

      out.computed = computeQuarterly({
        ww_scores: st.wwScores,
        ww_totals: parsed.wwTotals,
        pt_scores: st.ptScores,
        pt_totals: parsed.ptTotals,
        qa_score: st.examScore,
        qa_total: parsed.qaTotal,
        ww_weight: rs.weights.ww,
        pt_weight: rs.weights.pt,
        qa_weight: rs.weights.qa,
        ww_excused: existing?.wwExcused ?? [],
        pt_excused: existing?.ptExcused ?? [],
      });

      if (!existing) out.action = 'insert';
      else if (
        !hasData(existing) &&
        !existing.isNa &&
        existing.letterGrade == null
      )
        out.action = 'update-blank-row';
      else {
        const same =
          JSON.stringify(existing.wwScores.slice(0, parsed.wwTotals.length)) ===
            JSON.stringify(st.wwScores) &&
          JSON.stringify(existing.ptScores.slice(0, parsed.ptTotals.length)) ===
            JSON.stringify(st.ptScores) &&
          existing.qaScore === st.examScore;
        out.action = same ? 'unchanged' : 'overwrite';
      }

      out.mismatch = explainMismatch(rs, st, out.computed, existing);
    }

    const matchedIds = new Set(
      rs.rows.filter((r) => r.match).map((r) => r.match!.sectionStudentId)
    );
    rs.rosterMissing = roster
      .filter((r) => !matchedIds.has(r.sectionStudentId))
      .filter(
        (r) =>
          !(
            r.enrollmentStatus === 'withdrawn' &&
            r.withdrawalDate &&
            r.withdrawalDate < termStart
          )
      )
      .filter((r) => !(r.enrollmentDate && r.enrollmentDate > input.termEnd));
  }

  return compose(input, kept, unplaceableSheets);
}

// ---------------------------------------------------------------- mismatch

function explainMismatch(
  rs: ResolvedSheet,
  st: ParsedT3Student,
  computed: ReturnType<typeof computeQuarterly>,
  existing: SisEntry | null
): string | null {
  const pq = st.printedQuarterly;
  const cq = computed.quarterly_grade;
  if (pq == null && cq == null) return null;
  if (pq == null)
    return `workbook shows no quarterly grade; the SIS would store ${cq}`;
  if (cq == null) return `workbook shows ${pq}; the SIS computes no grade`;
  if (pq === cq) return null;

  const p = rs.parsed;
  const reasons: string[] = [];

  if (st.quarterlyIsFormula === false)
    reasons.push('the workbook quarterly grade is typed in, not a formula');

  // Component by component — which part of the grade disagrees?
  const comps: {
    k: 'WW' | 'PT';
    scores: (number | null)[];
    totals: number[];
    ours: number | null;
    printed: number | null;
    excused: number[];
  }[] = [
    {
      k: 'WW',
      scores: st.wwScores,
      totals: p.wwTotals,
      ours: computed.ww_ps,
      printed: st.printedWwPs,
      excused: existing?.wwExcused ?? [],
    },
    {
      k: 'PT',
      scores: st.ptScores,
      totals: p.ptTotals,
      ours: computed.pt_ps,
      printed: st.printedPtPs,
      excused: existing?.ptExcused ?? [],
    },
  ];
  for (const c of comps) {
    if (c.printed == null || c.ours == null || near(c.printed, c.ours))
      continue;
    // Does leaving some BLANK slots out of the total reproduce the workbook?
    const blanks = c.scores
      .map((v, i) => (v == null ? i + 1 : 0))
      .filter((i) => i > 0);
    let fit: number[] | null = null;
    for (const sub of subsets(blanks)) {
      const r = computeQuarterly({
        ww_scores: c.scores,
        ww_totals: c.totals,
        pt_scores: [],
        pt_totals: [],
        qa_score: null,
        qa_total: null,
        ww_weight: 1,
        pt_weight: 0,
        qa_weight: 0,
        ww_excused: sub,
      });
      if (near(r.ww_ps, c.printed)) {
        fit = sub;
        break;
      }
    }
    // Is the printed percentage even what the row's own printed Total gives
    // over the max row's Total? If not, the saved value is stale — the file
    // was saved without recalculating after the marks changed.
    const rowTotal = c.k === 'WW' ? st.printedWwTotal : st.printedPtTotal;
    const maxTotal = c.k === 'WW' ? p.printedWwTotalMax : p.printedPtTotalMax;
    const ownFormula =
      rowTotal != null && maxTotal ? (rowTotal / maxTotal) * 100 : null;
    if (fit)
      reasons.push(
        `the workbook leaves blank ${fit.map((i) => `${c.k === 'WW' ? 'W' : 'PT'}${i}`).join(', ')} out of this student's ${c.k} total (${fmt(c.printed)}%, the SIS counts the blank as zero: ${fmt(c.ours)}%) — a registrar can untick ${fit.length > 1 ? 'those slots' : 'that slot'} under "Counted assessments"`
      );
    else if (
      ownFormula != null &&
      !near(ownFormula, c.printed) &&
      near(ownFormula, c.ours)
    )
      reasons.push(
        `stale saved value in the workbook: its ${c.k} cell shows ${fmt(c.printed)}%, but the row's own Total ${fmt(rowTotal)} / ${fmt(maxTotal)} is ${fmt(c.ours)}% — the SIS figure is what the workbook gives once recalculated`
      );
    else
      reasons.push(
        `${c.k} percentage differs: workbook ${fmt(c.printed)}%, SIS ${fmt(c.ours)}% (row's own formula or total is different)`
      );
  }
  if (
    st.printedQaPs != null &&
    computed.qa_ps != null &&
    !near(st.printedQaPs, computed.qa_ps)
  )
    reasons.push(
      `Exam percentage differs: workbook ${fmt(st.printedQaPs)}%, SIS ${fmt(computed.qa_ps)}%`
    );

  // Weights: would the workbook's header weights reproduce it?
  const hw = p.headerWeights;
  if (
    hw.ww != null &&
    hw.pt != null &&
    hw.qa != null &&
    !(
      near(hw.ww, rs.weights.ww) &&
      near(hw.pt, rs.weights.pt) &&
      near(hw.qa, rs.weights.qa)
    )
  ) {
    const alt = computeQuarterly({
      ww_scores: st.wwScores,
      ww_totals: p.wwTotals,
      pt_scores: st.ptScores,
      pt_totals: p.ptTotals,
      qa_score: st.examScore,
      qa_total: p.qaTotal,
      ww_weight: hw.ww,
      pt_weight: hw.pt,
      qa_weight: hw.qa,
    });
    if (alt.quarterly_grade === pq)
      reasons.push(
        `weights: the workbook grades at ${fmt(hw.ww * 100, 0)}/${fmt(hw.pt * 100, 0)}/${fmt(hw.qa * 100, 0)}, the SIS at ${fmt(rs.weights.ww * 100, 0)}/${fmt(rs.weights.pt * 100, 0)}/${fmt(rs.weights.qa * 100, 0)}`
      );
  }

  // The workbook's own transmutation of its own initial grade.
  if (st.printedInitial != null) {
    const t = transmuteViaFormula(st.printedInitial);
    if (t !== pq)
      reasons.push(
        `the workbook's quarterly (${pq}) is not the transmutation of its own initial grade ${fmt(st.printedInitial, 4)} (→ ${t})`
      );
    else if (
      computed.initial_grade != null &&
      !near(computed.initial_grade, st.printedInitial) &&
      reasons.length === 0
    )
      reasons.push(
        `initial grade differs: workbook ${fmt(st.printedInitial, 4)}, SIS ${fmt(computed.initial_grade, 4)}`
      );
  }

  if (reasons.length === 0) reasons.push('unexplained');
  return `workbook ${pq} → SIS ${cq}: ${reasons.join('; ')}`;
}

// ---------------------------------------------------------------- output

function compose(
  input: BuildT3Input,
  sheets: ResolvedSheet[],
  unplaceableSheets: string[]
): BuildT3Result {
  const L: string[] = [];
  const rows = sheets.flatMap((s) => s.rows.map((r) => ({ s, r })));
  const count = (pred: (x: { s: ResolvedSheet; r: RowOutcome }) => boolean) =>
    rows.filter(pred).length;
  const writes = (r: RowOutcome) =>
    r.action === 'insert' ||
    r.action === 'update-blank-row' ||
    r.action === 'overwrite';

  const stats = {
    workbookTabsRead: input.sheets.length + input.skippedTabs.length,
    tabsSkipped: input.skippedTabs.length,
    sheetsMatched: sheets.length,
    sheetsUnplaceable: unplaceableSheets.length,
    sheetsWithTotalsChange: sheets.filter((s) => totalsChange(s)).length,
    sheetsWithOwnWeights: sheets.filter((s) => s.sheetWeightColumns).length,
    workbookRows: rows.length,
    studentsMatched: count((x) => x.r.match != null),
    studentsUnmatched: count((x) => x.r.action === 'unmatched'),
    rowsInsert: count((x) => x.r.action === 'insert'),
    rowsUpdateBlank: count((x) => x.r.action === 'update-blank-row'),
    rowsOverwrite: count((x) => x.r.action === 'overwrite'),
    rowsUnchanged: count((x) => x.r.action === 'unchanged'),
    rowsSkipBlank: count((x) => x.r.action === 'skip-blank'),
    rowsBlocked: count((x) => x.r.action === 'blocked'),
    rowsWritten: count((x) => writes(x.r)),
    gradeMismatches: count((x) => writes(x.r) && x.r.mismatch != null),
  };

  // --- canonical case (Hard Rule #1), recomputed here, not just at load
  const canon = computeQuarterly({
    ww_scores: [10, 10],
    ww_totals: [10, 10],
    pt_scores: [6, 10, 10],
    pt_totals: [10, 10, 10],
    qa_score: 22,
    qa_total: 30,
    ww_weight: 0.4,
    pt_weight: 0.4,
    qa_weight: 0.2,
  });
  const blankCase = computeQuarterly({
    ww_scores: [14, null],
    ww_totals: [15, 15],
    pt_scores: [null, null, null],
    pt_totals: [20, 20, 20],
    qa_score: null,
    qa_total: 60,
    ww_weight: 0.4,
    pt_weight: 0.4,
    qa_weight: 0.2,
  });

  L.push('AY2026 TERM 3 GRADING IMPORT — DRY RUN');
  L.push('=======================================');
  L.push(
    `Generated ${input.generatedAt} by scripts/backfill/gen-ay2026-t3-grading.ts.`
  );
  L.push('Nothing was written to the database. Production was only read.');
  L.push('');
  L.push(
    'SOURCE: AY2026/T3/Term 3 Grades/ — Cambridge/ (8 Global-class files: S1 Discipline 1,'
  );
  L.push(
    'S2 Integrity 1) and Grades/ (11 files holding the Primary tabs AND the Regular-track'
  );
  L.push(
    'Secondary tabs). This is the same split as T2 ("Lower Secondary Global Grading Sheets/"'
  );
  L.push(
    'and "GRADES/"), so one generator reads both folders and sorts each tab by the class it'
  );
  L.push(
    'lands on: Primary classes → ay2026-t3-primary-grading-*.sql, Secondary → ay2026-t3-'
  );
  L.push(
    'secondary-grading-*.sql. STAR is imported as STAR (the MAPEH→STAR move is live: the SIS'
  );
  L.push(
    'T3 sheets are STAR sheets). Regular-track "P.E." → PESTD, Global "P.E. and Health" → PEH.'
  );
  L.push('');
  L.push('HARD RULE #1 CHECK');
  L.push(
    `  Canonical case (WW 10,10/10,10; PT 6,10,10/10,10,10; QA 22/30; 40/40/20) → ${canon.quarterly_grade} ${canon.quarterly_grade === 93 ? '(93 — holds)' : '*** FAILED ***'}`
  );
  L.push(
    `  Blank-slot case (KD #225: WW 14,blank/15,15, 40/40/20) → ${blankCase.quarterly_grade} ${blankCase.quarterly_grade === 64 ? '(64 — matches the workbooks)' : '*** differs from 64 ***'}`
  );
  L.push(
    '  The apply SQL also checks the database: every row it writes must come back from the'
  );
  L.push(
    '  derive trigger with exactly the quarterly grade computed here, or the whole import rolls back.'
  );
  L.push('');
  L.push('WHAT THE APPLY WOULD DO');
  L.push(
    `  Workbook tabs read: ${stats.workbookTabsRead} (${stats.tabsSkipped} skipped: DO-NOT-USE / hidden)`
  );
  L.push(
    `  Tabs matched to an SIS Term 3 grading sheet: ${stats.sheetsMatched}   not placeable: ${stats.sheetsUnplaceable}`
  );
  L.push(
    `  SIS sheets whose max scores / slot counts change: ${stats.sheetsWithTotalsChange}`
  );
  L.push(
    `  SIS sheets given their own weights (a component off this term): ${stats.sheetsWithOwnWeights}`
  );
  L.push(
    `  Workbook student rows: ${stats.workbookRows}  → matched to an SIS student: ${stats.studentsMatched}, unmatched: ${stats.studentsUnmatched}`
  );
  L.push(
    `  Grade rows INSERTED (student has no T3 row yet):            ${stats.rowsInsert}`
  );
  L.push(
    `  Grade rows UPDATED (existing row, no marks in it yet):      ${stats.rowsUpdateBlank}`
  );
  L.push(
    `  Grade rows OVERWRITTEN (existing row already holds marks):  ${stats.rowsOverwrite}`
  );
  L.push(
    `  Already identical, not touched:                              ${stats.rowsUnchanged}`
  );
  L.push(
    `  Workbook rows with no marks at all, not written:             ${stats.rowsSkipBlank}`
  );
  L.push(
    `  Rows that cannot be written (listed under PROBLEMS):         ${stats.rowsBlocked}`
  );
  L.push(
    `  Written rows whose SIS grade differs from the workbook's:   ${stats.gradeMismatches}`
  );
  L.push(
    '  subject_configs: NOT written (KD #218 — the SIS subject weights stand).'
  );
  L.push(
    '  Sheets stay UNLOCKED (T2 locked its imported sheets; see DECISIONS).'
  );
  L.push('');

  // ---- per subject × section
  L.push('PER SUBJECT × SECTION');
  L.push('---------------------');
  const sorted = [...sheets].sort((a, b) =>
    `${a.parsed.subjectCode} ${a.section.levelCode} ${a.section.name}`.localeCompare(
      `${b.parsed.subjectCode} ${b.section.levelCode} ${b.section.name}`
    )
  );
  for (const s of sorted) {
    const p = s.parsed;
    const c = (a: RowOutcome['action']) =>
      s.rows.filter((r) => r.action === a).length;
    const sis = s.sisSheet;
    L.push(
      `${p.subjectCode} · ${s.section.levelCode} ${s.section.name}   ← ${p.file} › "${p.sheetName}"`
    );
    if (s.identityNote) L.push(`  identity: ${s.identityNote}`);
    L.push(
      `  slots   workbook WW ${arr(p.wwTotals)} = ${sumOf(p.wwTotals)}, PT ${arr(p.ptTotals)} = ${sumOf(p.ptTotals)}, Exam ${fmt(p.qaTotal)}`
    );
    L.push(
      `          SIS now  WW ${arr(sis.wwTotals)} = ${sumOf(sis.wwTotals)}, PT ${arr(sis.ptTotals)} = ${sumOf(sis.ptTotals)}, Exam ${fmt(sis.qaTotal)}${totalsChange(s) ? '   → replaced by the workbook' : '   (already the same)'}`
    );
    L.push(
      `  weights ${fmt(s.weights.ww * 100, 0)}/${fmt(s.weights.pt * 100, 0)}/${fmt(s.weights.qa * 100, 0)}${s.sheetWeightColumns ? ' (set on this sheet)' : ' (subject weights, inherited)'}`
    );
    for (const n of s.notes) L.push(`  note: ${n}`);
    L.push(
      `  students: ${p.students.length} workbook rows · matched ${s.rows.filter((r) => r.match).length} · unmatched ${c('unmatched')} · insert ${c('insert')} · update ${c('update-blank-row')} · overwrite ${c('overwrite')} · unchanged ${c('unchanged')} · blank ${c('skip-blank')} · blocked ${c('blocked')}`
    );
    const closeNames = s.rows.filter((r) => r.method === 'close-name');
    for (const r of closeNames)
      L.push(
        `  matched on a close spelling: #${r.st.indexNo} "${r.st.fullName}" → ${dbName(r.match!)} (${r.match!.studentNumber})`
      );
    const idxDiff = s.rows.filter(
      (r) => r.match && r.match.indexNumber !== r.st.indexNo
    );
    if (idxDiff.length)
      L.push(
        `  index numbers differ from the SIS for ${idxDiff.length}: ${idxDiff.map((r) => `"${r.st.fullName}" #${r.st.indexNo}→#${r.match!.indexNumber}`).join(', ')}`
      );
    for (const r of s.rows.filter((r) => r.action === 'unmatched'))
      L.push(
        `  UNMATCHED #${r.st.indexNo} "${r.st.fullName}" (row ${r.st.rowNumber}${hasData(r) ? ', has marks' : ', no marks'}): ${r.unmatchedWhy}${r.foundElsewhere ? `; this name IS in ${r.foundElsewhere}` : ''}`
      );
    for (const r of s.rows.filter((r) => r.action === 'blocked'))
      L.push(`  BLOCKED #${r.st.indexNo} "${r.st.fullName}": ${r.blockedWhy}`);
    for (const r of s.rows.filter((r) => r.st.nonNumericCells.length))
      L.push(
        `  non-numeric cell(s) read as blank: #${r.st.indexNo} "${r.st.fullName}" ${r.st.nonNumericCells.join(', ')}`
      );
    if (s.rosterMissing.length)
      L.push(
        `  in the SIS class but NOT on this tab (${s.rosterMissing.length}, no T3 ${p.subjectCode} grade): ${s.rosterMissing.map((r) => `${dbName(r)} #${r.indexNumber} (${r.studentNumber}${r.enrollmentStatus !== 'active' ? `, ${r.enrollmentStatus}` : ''})`).join('; ')}`
      );
    L.push('');
  }

  // ---- overwrites
  L.push('ROWS THAT ALREADY HOLD MARKS IN THE SIS AND WOULD BE OVERWRITTEN');
  L.push('-----------------------------------------------------------------');
  const ow = rows.filter((x) => x.r.action === 'overwrite');
  if (!ow.length)
    L.push(
      '  (none — every existing T3 row the import touches is empty today)'
    );
  for (const { s, r } of ow) {
    const e = r.existing!;
    L.push(
      `  ${s.parsed.subjectCode} ${s.section.levelCode} ${s.section.name} — ${dbName(r.match!)} (${r.match!.studentNumber})`
    );
    L.push(
      `     SIS now:  WW ${arr(e.wwScores)} PT ${arr(e.ptScores)} Exam ${fmt(e.qaScore)} (quarterly ${fmt(e.quarterlyGrade)})${e.isNa ? ' N/A' : ''}${e.letterGrade ? ` letter ${e.letterGrade}` : ''}`
    );
    L.push(
      `     workbook: WW ${arr(r.wwScores)} PT ${arr(r.ptScores)} Exam ${fmt(r.qaScore)} (quarterly ${fmt(r.computed?.quarterly_grade)})`
    );
  }
  const sisOnly = input.entries.filter(
    (e) => hasData(e) || e.isNa || e.letterGrade
  );
  const touched = new Set(
    rows.filter((x) => x.r.existing).map((x) => x.r.existing!.id)
  );
  const untouchedWithData = sisOnly.filter((e) => !touched.has(e.id));
  L.push(
    `  For reference: ${sisOnly.length} T3 grade row(s) in the SIS hold marks today; ${untouchedWithData.length} of them are not touched by this import.`
  );
  L.push('');

  // ---- mismatches
  L.push(
    "STUDENTS WHOSE SIS T3 GRADE WOULD DIFFER FROM THE WORKBOOK'S OWN QUARTERLY GRADE"
  );
  L.push(
    '-------------------------------------------------------------------------------'
  );
  const mm = rows.filter((x) => writes(x.r) && x.r.mismatch);
  const reasonTally = new Map<string, number>();
  for (const { r } of mm) {
    const tag = reasonTag(r.mismatch!);
    reasonTally.set(tag, (reasonTally.get(tag) ?? 0) + 1);
  }
  L.push(`  ${mm.length} of ${stats.rowsWritten} written rows. By reason:`);
  for (const [k, v] of [...reasonTally.entries()].sort((a, b) => b[1] - a[1]))
    L.push(`    ${v} × ${k}`);
  if (!mm.length) L.push('  (none)');
  for (const { s, r } of mm)
    L.push(
      `  ${s.parsed.subjectCode} ${s.section.levelCode} ${s.section.name} — ${dbName(r.match!)} (${r.match!.studentNumber}, workbook #${r.st.indexNo}): ${r.mismatch}`
    );
  L.push('');

  // ---- withdrawals / late enrollees
  L.push('T3 WITHDRAWALS AND LATE ENROLLEES');
  L.push('---------------------------------');
  const special = new Map<string, { r: SisRosterRow; lines: string[] }>();
  for (const { s, r } of rows) {
    const m = r.match;
    if (!m) continue;
    const late =
      m.enrollmentStatus === 'late_enrollee' ||
      (m.enrollmentDate != null && m.enrollmentDate > input.termStart);
    if (m.enrollmentStatus !== 'withdrawn' && !late) continue;
    const e = special.get(m.sectionStudentId) ?? { r: m, lines: [] };
    const blanks = [
      ...r.wwScores.map((v, i) => (v == null ? `W${i + 1}` : '')),
      ...r.ptScores.map((v, i) => (v == null ? `PT${i + 1}` : '')),
      ...(r.qaScore == null ? ['Exam'] : []),
    ].filter(Boolean);
    e.lines.push(
      `${s.parsed.subjectCode}: ${r.action}${blanks.length && writes(r) ? `, blank ${blanks.join(' ')} (count as zero until excused)` : ''}${r.computed ? `, SIS ${fmt(r.computed.quarterly_grade)} vs workbook ${fmt(r.st.printedQuarterly)}` : ''}`
    );
    special.set(m.sectionStudentId, e);
  }
  if (!special.size) L.push('  (none among matched students)');
  for (const { r, lines } of special.values()) {
    const sec = input.sections.find((x) => x.id === r.sectionId);
    L.push(
      `  ${dbName(r)} (${r.studentNumber}) ${sec?.levelCode} ${sec?.name} — ${r.enrollmentStatus}${r.enrollmentDate ? `, enrolled ${r.enrollmentDate}` : ''}${r.withdrawalDate ? `, withdrawn ${r.withdrawalDate}` : ''}`
    );
    for (const l of lines) L.push(`     ${l}`);
  }
  L.push(
    "  Handling: a withdrawn student's T3 marks are written if the workbook has them (Hard Rule #6"
  );
  L.push(
    "  keeps them on the roster; the grid shows the row read-only). A late enrollee's blank early"
  );
  L.push(
    '  slots count as zero (KD #225) — nothing is excused automatically; the registrar unticks'
  );
  L.push(
    '  slots under "Counted assessments" (migration 179). Where the workbook itself left a blank'
  );
  L.push(
    "  slot out of a student's total, the mismatch list above names the exact slots."
  );
  L.push('');

  // ---- problems
  L.push("ANYTHING IN THE WORKBOOKS THAT COULDN'T BE PLACED");
  L.push('-----------------------------------------------');
  for (const t of input.skippedTabs)
    L.push(`  skipped tab: ${t.file} › "${t.sheetName}" — ${t.reason}`);
  for (const u of unplaceableSheets) L.push(`  ${u}`);
  const um = rows.filter((x) => x.r.action === 'unmatched');
  L.push(
    `  ${um.length} unmatched student row(s) (${um.filter((x) => hasData(x.r)).length} with marks) — listed per sheet above.`
  );
  const bl = rows.filter((x) => x.r.action === 'blocked');
  L.push(`  ${bl.length} blocked row(s) — listed per sheet above.`);
  const sisNoWb = input.sisSheets.filter(
    (s) => !sheets.some((k) => k.sisSheet.id === s.id)
  );
  L.push(
    `  SIS T3 sheets no workbook tab feeds (${sisNoWb.length}): ${sisNoWb
      .map((s) => {
        const sec = input.sections.find((x) => x.id === s.sectionId);
        return `${s.subjectCode} ${sec?.levelCode} ${sec?.name}`;
      })
      .join('; ')}`
  );
  L.push('');

  // ---- decisions
  L.push('DECISIONS FOR A PERSON BEFORE APPLYING');
  L.push('--------------------------------------');
  let d = 0;
  const stale = mm.filter((x) => x.r.mismatch!.includes('stale saved value'));
  if (stale.length) {
    const up = stale.filter(
      (x) =>
        (x.r.computed?.quarterly_grade ?? 0) > (x.r.st.printedQuarterly ?? 0)
    ).length;
    L.push(
      `  ${++d}. ${stale.length} student(s) get a different grade because the workbook's SAVED percentages are stale —`
    );
    L.push(
      `     the marks and the row totals are right, the percentage cells were never recalculated. The SIS`
    );
    L.push(
      `     stores what the workbook's own formula gives (${up} higher, ${stale.length - up} lower). If the workbook`
    );
    L.push(
      `     grade was already reported to parents, confirm with the teacher which grade stands; the marks`
    );
    L.push(
      `     themselves need no change. (${[...new Set(stale.map((x) => `${x.s.parsed.subjectCode} ${x.s.section.levelCode} ${x.s.section.name}`))].join(', ')})`
    );
  }
  const pror = mm.filter((x) => x.r.mismatch!.includes('leaves blank'));
  if (pror.length) {
    L.push(
      `  ${++d}. ${pror.length} student(s) had a blank slot left OUT of their total in the workbook (the SIS counts it`
    );
    L.push(
      '     as zero, KD #225). After the apply, the registrar can untick exactly the slot(s) named in the'
    );
    L.push(
      '     mismatch list under "Counted assessments"; the SIS grade then equals the workbook\'s. The import'
    );
    L.push(
      '     does not excuse slots itself (manual by design; the derive trigger refuses it outside the registrar).'
    );
  }
  const other = mm.filter(
    (x) =>
      !x.r.mismatch!.includes('stale saved value') &&
      !x.r.mismatch!.includes('leaves blank')
  );
  if (other.length)
    L.push(
      `  ${++d}. ${other.length} other grade difference(s) — see the mismatch list; each needs a look before applying.`
    );
  L.push(
    `  ${++d}. Lock the sheets? T2's import locked every sheet it wrote ("backfill-import"). This apply leaves the`
  );
  L.push(
    '     T3 sheets UNLOCKED so the registrar can make the excusals above without a change request;'
  );
  L.push('     lock them afterwards (Markbook bulk lock) if T3 is final.');
  L.push(
    `  ${++d}. Teacher names on the SIS sheets are not changed (many workbook tabs have a blank "Teacher:" line).`
  );
  L.push(
    `  ${++d}. The SIS max scores are REPLACED by the workbook's on all ${stats.sheetsWithTotalsChange} sheets (the SIS still holds the`
  );
  const hdrDiff = sheets.filter((s) =>
    s.notes.some((n) => n.includes('differ from the SIS subject weights'))
  ).length;
  L.push(
    `     generated placeholders). No subject weight is changed. Workbook headers that disagree with the SIS`
  );
  L.push(
    `     subject weights: ${hdrDiff}. Sheets given their own weights because a component is off: ${stats.sheetsWithOwnWeights}.`
  );
  L.push(
    '  Apply order: the primary and secondary files are independent; run each whole file in one go.'
  );
  L.push('');

  const files: { name: string; sql: string }[] = [];
  for (const track of ['primary', 'secondary'] as const) {
    const ts = sheets.filter((s) => s.track === track);
    files.push({
      name: `ay2026-t3-${track}-grading-preview.sql`,
      sql: buildPreview(track, ts, input.generatedAt),
    });
    files.push({
      name: `ay2026-t3-${track}-grading-apply.sql`,
      sql: buildApply(track, ts, input.generatedAt),
    });
  }

  const writtenRows = rows
    .filter((x) => writes(x.r))
    .map(({ s, r }) => ({
      label: `${s.parsed.subjectCode} ${s.section.levelCode} ${s.section.name} — ${dbName(r.match!)} (${r.match!.studentNumber})`,
      ww_scores: r.wwScores,
      ww_totals: s.parsed.wwTotals,
      pt_scores: r.ptScores,
      pt_totals: s.parsed.ptTotals,
      qa_score: r.qaScore,
      qa_total: s.parsed.qaTotal,
      ww_weight: s.weights.ww,
      pt_weight: s.weights.pt,
      qa_weight: s.weights.qa,
      ww_excused: r.existing?.wwExcused ?? [],
      pt_excused: r.existing?.ptExcused ?? [],
      expectedQuarterly: r.computed?.quarterly_grade ?? null,
    }));

  return { report: L.join('\n') + '\n', files, stats, writtenRows };
}

function reasonTag(m: string): string {
  const tags: string[] = [];
  if (m.includes('typed in')) tags.push('typed-in workbook grade');
  if (m.includes('leaves blank'))
    tags.push(
      'workbook leaves blank slot(s) out of the total (SIS counts them as zero)'
    );
  if (m.includes('stale saved value'))
    tags.push('stale (un-recalculated) percentage saved in the workbook');
  if (/(WW|PT) percentage differs/.test(m))
    tags.push("a row's own WW/PT formula differs");
  if (m.includes('Exam percentage differs'))
    tags.push('exam percentage differs');
  if (m.includes('weights:')) tags.push('workbook header weights differ');
  if (m.includes('not the transmutation'))
    tags.push(
      "workbook's quarterly is not the transmutation of its own initial grade"
    );
  if (m.includes('initial grade differs'))
    tags.push('initial grade differs (rounding)');
  if (m.includes('shows no quarterly'))
    tags.push('workbook has no quarterly grade for a row with marks');
  if (m.includes('unexplained')) tags.push('unexplained');
  return tags.join(' + ') || 'other';
}

function sumOf(a: number[]) {
  return fmt(a.reduce((x, y) => x + y, 0));
}

function totalsChange(s: ResolvedSheet): boolean {
  const p = s.parsed;
  const t = s.sisSheet;
  return (
    JSON.stringify(p.wwTotals) !== JSON.stringify(t.wwTotals.map(Number)) ||
    JSON.stringify(p.ptTotals) !== JSON.stringify(t.ptTotals.map(Number)) ||
    (p.qaTotal ?? null) !== (t.qaTotal == null ? null : Number(t.qaTotal)) ||
    !weightsSame(s)
  );
}

function weightsSame(s: ResolvedSheet): boolean {
  const t = s.sisSheet;
  const w = s.sheetWeightColumns;
  if (!w) return t.wwWeight == null && t.ptWeight == null && t.qaWeight == null;
  return (
    near(t.wwWeight, w.ww) && near(t.ptWeight, w.pt) && near(t.qaWeight, w.qa)
  );
}

// ---------------------------------------------------------------- SQL

function buildPreview(
  track: string,
  sheets: ResolvedSheet[],
  generatedAt: string
): string {
  const L: string[] = [];
  L.push(`-- AY2026 T3 ${track} grading import — PREVIEW (read-only)`);
  L.push(
    `-- Generated ${generatedAt} by scripts/backfill/gen-ay2026-t3-grading.ts — do not hand-edit; regenerate.`
  );
  L.push(
    '-- The full dry-run findings are in scripts/backfill/ay2026-t3-grading-report.txt.'
  );
  L.push(
    '-- The SELECTs below only read. Run them to see what the apply would change right now.'
  );
  L.push('--');
  const writes = sheets.flatMap((s) =>
    s.rows.filter(
      (r) =>
        r.action === 'insert' ||
        r.action === 'update-blank-row' ||
        r.action === 'overwrite'
    )
  );
  L.push(
    `-- sheets: ${sheets.length}; grade rows written: ${writes.length} (insert ${writes.filter((r) => r.action === 'insert').length}, update ${writes.filter((r) => r.action === 'update-blank-row').length}, overwrite ${writes.filter((r) => r.action === 'overwrite').length})`
  );
  L.push('');
  if (!sheets.length) {
    L.push('select 1 as nothing_to_preview;');
    return L.join('\n') + '\n';
  }
  const P = `_ay26t3${track === 'primary' ? 'p' : 's'}_pv`;
  L.push(
    '-- (The two temp tables below live only for this session; no real table is written.)'
  );
  L.push('');
  L.push('-- 1. The target sheets as they are now vs the workbook totals.');
  L.push(`drop table if exists ${P}_sheets;`);
  L.push(
    `create temp table ${P}_sheets (sheet_id, label, new_ww, new_pt, new_qa) as`
  );
  L.push('values');
  L.push(
    sheets
      .map(
        (s) =>
          `  (${sqlString(s.sisSheet.id)}::uuid, ${sqlString(`${s.parsed.subjectCode} ${s.section.levelCode} ${s.section.name}`)}, ${sqlNumArr(s.parsed.wwTotals)}, ${sqlNumArr(s.parsed.ptTotals)}, ${s.parsed.qaTotal ?? 'null'}::numeric)`
      )
      .join(',\n') + ';'
  );
  L.push('');
  L.push(
    'select t.label, gs.is_locked, gs.ww_totals as now_ww, t.new_ww, gs.pt_totals as now_pt, t.new_pt, gs.qa_total as now_qa, t.new_qa,'
  );
  L.push('       gs.ww_weight, gs.pt_weight, gs.qa_weight,');
  L.push(
    '       (select count(*) from grade_entries ge where ge.grading_sheet_id = gs.id) as rows_now,'
  );
  L.push(
    '       (select count(*) from grade_entries ge where ge.grading_sheet_id = gs.id'
  );
  L.push(
    '          and (ge.qa_score is not null or exists (select 1 from unnest(ge.ww_scores) v where v is not null)'
  );
  L.push(
    '               or exists (select 1 from unnest(ge.pt_scores) v where v is not null))) as rows_with_marks_now'
  );
  L.push(`from ${P}_sheets t join grading_sheets gs on gs.id = t.sheet_id`);
  L.push('order by t.label;');
  L.push('');
  L.push(
    '-- 2. Target rows that hold marks right now (the apply refuses to run if any appear'
  );
  L.push('--    that the dry run did not list as an overwrite).');
  L.push(`drop table if exists ${P}_rows;`);
  L.push(`create temp table ${P}_rows (sheet_id, section_student_id) as`);
  L.push('values');
  L.push(
    (writes.length
      ? writes
          .map((r) => {
            const s = sheets.find((x) => x.rows.includes(r))!;
            return `  (${sqlString(s.sisSheet.id)}::uuid, ${sqlString(r.match!.sectionStudentId)}::uuid)`;
          })
          .join(',\n')
      : '  (null::uuid, null::uuid)') + ';'
  );
  L.push('');
  L.push(
    'select ge.grading_sheet_id, ge.section_student_id, ge.ww_scores, ge.pt_scores, ge.qa_score, ge.quarterly_grade, ge.is_na'
  );
  L.push(
    `from ${P}_rows t join grade_entries ge on ge.grading_sheet_id = t.sheet_id and ge.section_student_id = t.section_student_id`
  );
  L.push(
    'where ge.qa_score is not null or exists (select 1 from unnest(ge.ww_scores) v where v is not null)'
  );
  L.push(
    '   or exists (select 1 from unnest(ge.pt_scores) v where v is not null) or ge.is_na or ge.letter_grade is not null;'
  );
  return L.join('\n') + '\n';
}

function buildApply(
  track: string,
  sheets: ResolvedSheet[],
  generatedAt: string
): string {
  const P = `_ay26t3${track === 'primary' ? 'p' : 's'}`;
  const L: string[] = [];
  L.push(`-- AY2026 T3 ${track} grading import — APPLY (one transaction)`);
  L.push('--');
  L.push(
    `-- RUN ay2026-t3-${track}-grading-preview.sql FIRST and read ay2026-t3-grading-report.txt.`
  );
  L.push(
    `-- Generated ${generatedAt} by scripts/backfill/gen-ay2026-t3-grading.ts — do not hand-edit; regenerate.`
  );
  L.push('--');
  L.push('-- What it does:');
  L.push(
    '--   1. Refuses to run if any target sheet is locked or its totals/weights changed since the'
  );
  L.push(
    '--      dry run, or if a target grade row gained marks the dry run did not list.'
  );
  L.push(
    "--   2. Sets each target sheet's WW/PT max scores, exam total and (only when a component is"
  );
  L.push(
    '--      off this term) its own weights. subject_configs is NOT written (KD #218).'
  );
  L.push(
    '--   3. Writes the raw marks (insert, or update of the existing row). The derive trigger'
  );
  L.push(
    '--      computes ww_ps / pt_ps / qa_ps / initial / quarterly (KD #225, migrations 177-179).'
  );
  L.push(
    "--   4. Checks every written row's quarterly grade equals the dry run's; rolls back if not."
  );
  L.push(
    '--   Sheets are left UNLOCKED. No subject_configs, section or roster writes.'
  );
  L.push('--');
  L.push('-- Run the WHOLE file in one go (one connection/session).');
  L.push('');

  const writes = sheets.flatMap((s) =>
    s.rows
      .filter(
        (r) =>
          r.action === 'insert' ||
          r.action === 'update-blank-row' ||
          r.action === 'overwrite'
      )
      .map((r) => ({ s, r }))
  );
  if (!sheets.length) {
    L.push('-- nothing to apply for this track');
    L.push('select 1 as nothing_to_apply;');
    return L.join('\n') + '\n';
  }

  L.push('begin;');
  L.push('');
  L.push(`drop table if exists ${P}_sheets;`);
  L.push(
    `create temp table ${P}_sheets (sheet_id, label, was_ww, was_pt, was_qa, was_wwt, was_ptt, was_qat, ww_totals, pt_totals, qa_total, ww_weight, pt_weight, qa_weight) as`
  );
  L.push('values');
  L.push(
    sheets
      .map((s) => {
        const t = s.sisSheet;
        const w = s.sheetWeightColumns;
        return `  (${sqlString(t.id)}::uuid, ${sqlString(`${s.parsed.subjectCode} ${s.section.levelCode} ${s.section.name}`)}, ${sqlNumArr(t.wwTotals)}, ${sqlNumArr(t.ptTotals)}, ${t.qaTotal ?? 'null'}::numeric, ${t.wwWeight ?? 'null'}::numeric, ${t.ptWeight ?? 'null'}::numeric, ${t.qaWeight ?? 'null'}::numeric, ${sqlNumArr(s.parsed.wwTotals)}, ${sqlNumArr(s.parsed.ptTotals)}, ${s.parsed.qaTotal ?? 'null'}::numeric, ${w ? w.ww : 'null'}::numeric, ${w ? w.pt : 'null'}::numeric, ${w ? w.qa : 'null'}::numeric)`;
      })
      .join(',\n') + ';'
  );
  L.push('');
  L.push(`drop table if exists ${P}_entries;`);
  L.push(
    `create temp table ${P}_entries (sheet_id, section_student_id, label, action, ww_scores, pt_scores, qa_score, expected_quarterly) as`
  );
  L.push('values');
  L.push(
    (writes.length
      ? writes
          .map(
            ({ s, r }) =>
              `  (${sqlString(s.sisSheet.id)}::uuid, ${sqlString(r.match!.sectionStudentId)}::uuid, ${sqlString(`${s.parsed.subjectCode} ${s.section.levelCode} ${s.section.name} ${r.match!.studentNumber}`)}, ${sqlString(r.action)}, ${sqlNumArr(r.wwScores)}, ${sqlNumArr(r.ptScores)}, ${r.qaScore ?? 'null'}::numeric, ${r.computed?.quarterly_grade ?? 'null'}::smallint)`
          )
          .join(',\n')
      : "  (null::uuid, null::uuid, '__none__', '__none__', ARRAY[]::numeric[], ARRAY[]::numeric[], null::numeric, null::smallint)") +
      ';'
  );
  L.push(`delete from ${P}_entries where label = '__none__';`);
  L.push('');
  L.push('-- 1. guards');
  L.push('do $$');
  L.push('declare v_bad text;');
  L.push('begin');
  L.push(
    `  select string_agg(s.label, ', ') into v_bad from ${P}_sheets s left join grading_sheets gs on gs.id = s.sheet_id`
  );
  L.push('   where gs.id is null or gs.is_locked');
  L.push(
    '      or gs.ww_totals is distinct from s.was_ww or gs.pt_totals is distinct from s.was_pt'
  );
  L.push('      or gs.qa_total is distinct from s.was_qa');
  L.push(
    '      or gs.ww_weight is distinct from s.was_wwt or gs.pt_weight is distinct from s.was_ptt'
  );
  L.push('      or gs.qa_weight is distinct from s.was_qat;');
  L.push('  if v_bad is not null then');
  L.push(
    "    raise exception 'T3 import refused: these sheets are missing, locked, or changed since the dry run: %. Regenerate.', v_bad;"
  );
  L.push('  end if;');
  L.push(`  select string_agg(e.label, ', ') into v_bad from ${P}_entries e`);
  L.push(
    '    join grade_entries ge on ge.grading_sheet_id = e.sheet_id and ge.section_student_id = e.section_student_id'
  );
  L.push(
    "   where e.action <> 'overwrite' and (ge.qa_score is not null or ge.is_na or ge.letter_grade is not null"
  );
  L.push(
    '      or exists (select 1 from unnest(ge.ww_scores) v where v is not null)'
  );
  L.push(
    '      or exists (select 1 from unnest(ge.pt_scores) v where v is not null));'
  );
  L.push('  if v_bad is not null then');
  L.push(
    "    raise exception 'T3 import refused: these rows gained marks after the dry run: %. Regenerate.', v_bad;"
  );
  L.push('  end if;');
  L.push('end $$;');
  L.push('');
  L.push(
    '-- 2. sheet totals (and weights only where a component is off this term)'
  );
  L.push('update grading_sheets gs');
  L.push(
    '   set ww_totals = s.ww_totals, pt_totals = s.pt_totals, qa_total = s.qa_total,'
  );
  L.push(
    '       ww_weight = s.ww_weight, pt_weight = s.pt_weight, qa_weight = s.qa_weight,'
  );
  L.push('       updated_at = now()');
  L.push(`  from ${P}_sheets s`);
  L.push(' where gs.id = s.sheet_id;');
  L.push('');
  const ow = writes.filter((x) => x.r.action === 'overwrite');
  if (ow.length) {
    L.push(
      '-- 2b. audit trail for the rows that already held marks (Hard Rule #6 — the trigger'
    );
    L.push('--     writes no audit row for a SQL-editor session)');
    L.push(
      'insert into grade_audit_log (grade_entry_id, grading_sheet_id, changed_by, field_changed, old_value, new_value, approval_reference)'
    );
    L.push(
      "select ge.id, ge.grading_sheet_id, 'backfill: AY2026 T3 grading import', 'scores',"
    );
    L.push(
      "       'ww=' || ge.ww_scores::text || ' pt=' || ge.pt_scores::text || ' qa=' || coalesce(ge.qa_score::text, 'null'),"
    );
    L.push(
      "       'ww=' || e.ww_scores::text || ' pt=' || e.pt_scores::text || ' qa=' || coalesce(e.qa_score::text, 'null'),"
    );
    L.push("       'AY2026 T3 workbook import'");
    L.push(
      `  from ${P}_entries e join grade_entries ge on ge.grading_sheet_id = e.sheet_id and ge.section_student_id = e.section_student_id`
    );
    L.push(" where e.action = 'overwrite';");
    L.push('');
  }
  L.push('-- 3. raw marks; the derive trigger computes every grade');
  L.push(
    'insert into grade_entries (grading_sheet_id, section_student_id, ww_scores, pt_scores, qa_score)'
  );
  L.push(
    `select e.sheet_id, e.section_student_id, e.ww_scores, e.pt_scores, e.qa_score from ${P}_entries e`
  );
  L.push('on conflict (grading_sheet_id, section_student_id) do update');
  L.push(
    '   set ww_scores = excluded.ww_scores, pt_scores = excluded.pt_scores, qa_score = excluded.qa_score;'
  );
  L.push('');
  L.push('-- 4. the database must agree with the dry run');
  L.push('do $$');
  L.push('declare v_bad text; v_n int;');
  L.push('begin');
  L.push(
    `  select count(*) into v_n from ${P}_entries e join grade_entries ge`
  );
  L.push(
    '    on ge.grading_sheet_id = e.sheet_id and ge.section_student_id = e.section_student_id;'
  );
  L.push(`  if v_n <> (select count(*) from ${P}_entries) then`);
  L.push(
    "    raise exception 'T3 import: expected % grade rows, found %', (select count(*) from " +
      `${P}_entries), v_n;`
  );
  L.push('  end if;');
  L.push(
    "  select string_agg(e.label || ' expected ' || coalesce(e.expected_quarterly::text, 'null') || ' got ' || coalesce(ge.quarterly_grade::text, 'null'), '; ')"
  );
  L.push(`    into v_bad from ${P}_entries e join grade_entries ge`);
  L.push(
    '      on ge.grading_sheet_id = e.sheet_id and ge.section_student_id = e.section_student_id'
  );
  L.push('   where ge.quarterly_grade is distinct from e.expected_quarterly;');
  L.push('  if v_bad is not null then');
  L.push(
    "    raise exception 'T3 import: the derive trigger disagrees with the dry run: %', v_bad;"
  );
  L.push('  end if;');
  L.push('end $$;');
  L.push('');
  L.push('commit;');
  L.push('');
  L.push('-- === post-commit verification ===');
  L.push(
    `select count(*) as t3_${track}_rows_with_marks from grade_entries ge where ge.grading_sheet_id in (${sheets.map((s) => sqlString(s.sisSheet.id)).join(', ')})`
  );
  L.push(
    '   and (ge.qa_score is not null or exists (select 1 from unnest(ge.ww_scores) v where v is not null)'
  );
  L.push(
    '        or exists (select 1 from unnest(ge.pt_scores) v where v is not null));'
  );
  return L.join('\n') + '\n';
}
