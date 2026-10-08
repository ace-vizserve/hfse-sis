// Phase "markbook" (plan phase 3): grading sheets, raw scores, weights, locks,
// slot labels, post-lock corrections and the applied grade change requests,
// for AY2025 and AY2026. The report-card publication is its own phase
// ("publication", ./publication.ts): the app's publish gate needs the adviser
// comments the evaluation phase writes.
//
// Production's shape (prod-profile.md §3-4) and how each part is written —
// real write path first (plan ground rule 2):
//
//   * Sheets — the `create_grading_sheets_for_ay` RPC, once per AY, which
//     makes one sheet per class subject per term (10-point default slots from
//     the subject config) and seeds a blank entry per child on the class list.
//
//   * AY2025, and AY2026 Terms 1–2, came into production by IMPORT, not the
//     app: the AY2025 masterfile import (scripts/backfill/ay2025-grades.ts —
//     slotless sheets, quarterly stored as a number, locked by
//     'ay2025.backfill' at 2025-11-14 12:00 SGT) and the AY2026 workbook
//     imports (scripts/backfill/ay2026-t*-grading-apply.sql — slots, maxes,
//     teacher names and raw scores, locked by 'backfill-import'). Those are
//     production's real write paths for that data, so they are mirrored as
//     the imports wrote: direct sheet writes, raw-score upserts, no audit rows.
//     AY2025 Terms 1–3 carry raw scores on examinable subjects; non-examinable
//     subjects and Term 4 hold the imported number only (~33% of AY2025's
//     sheets have no score slots, production 232/620); ~8% of AY2025 entries
//     are N/A (language exemptions on Filipino / Mother Tongue).
//
//   * AY2026 Terms 3–4 were set up IN THE APP: max scores through the totals
//     route (one `totals.update` row per changed slot — production 250),
//     weights through the subject term-weights route (37 Term 4 sheets stating
//     their subject's weights, production 37) and one class's own weights
//     through the totals route (S-level Filipino, Term 3, no exam: 37/63/0),
//     slot labels through the labels route as the subject teacher. Term 3 is
//     scored in full; Term 4 is in progress (~2% of its slots filled).
//
//   * Term 4's marks were typed in: the entries route's direct path as the
//     subject teacher — slots labelled first (the route's first-score gate),
//     one `entry.update` audit row per mark. Term 3's marks are written as an
//     import: production's own rows show they did not come through the app
//     (see APP_ENTERED_TERMS).
//
//   * Scores — RAW scores only, upserted; the `grade_entries_derive_trg`
//     trigger computes every percentage and grade (Hard Rule #2). Blank (null)
//     and zero are distinct (Hard Rule #3). The model is ../markbook/model.ts.
//     Late enrollees are blank for the part of the term before they joined,
//     withdrawn children for the part after they left.
//
//   * Locks — AY2025 all and AY2026 Terms 1–2 all, by their imports; AY2026
//     Term 3 a few, by the lock route as a coordinator (four locked, one of
//     them unlocked again by the unlock route → three, production 3).
//
//   * Post-lock edits (~150 `grade_audit_log` rows) — the entries route's
//     Path B (registrar data-entry corrections) and the totals route's Path B
//     on a locked sheet, plus the two APPLIED grade change requests through
//     the real flow: filed by the subject teacher (POST /api/change-requests,
//     mirrored, opening the approval ladder with the app's
//     `openApprovalRequest`), approved through the app's own `decideApproval`
//     (which reads the clock — see lib/constants.ts), applied through Path A
//     (`apply_change_request_atomic`).
//
// IDEMPOTENT ON ITS OWN (ground rule 6): the RPC runs only for an AY with no
// sheets; shaping touches only unlocked sheets whose shape differs; scores
// are decided per entry — only an entry still blank is written (and, for
// typed-in terms, only one without an `entry.update` row; one holding marks
// without its rows gets them); locks only once per sheet (a sheet with a
// `sheet.lock` row is never re-locked); each correction by its own key (the
// entry, or the sheet for the locked max); change requests by fixed id, each
// step only from the state before it, a filed one missing its audit row
// finished. A second `--only markbook` writes nothing.

import { decideApproval } from '@/lib/approvals/decide';
import type { Role } from '@/lib/auth/roles';
import { letterToRepresentative } from '@/lib/sis/backfill/grades/representative-numeric';
import { buildAuditRows } from '@/lib/audit/log-grade-change';
import { slotMetaSatisfied } from '@/lib/grading/first-score-gate';
import type { CorrectionReason } from '@/lib/schemas/change-request';
import type { SlotLabels, SlotMeta } from '@/lib/schemas/grading-sheet';

import { must, service, sql, sqlRows } from '../lib/local';
import { rng, uuidFrom, type Rng } from '../lib/random';
import {
  BLANK_RATE,
  importedQuarterly,
  latent,
  nonExamLetter,
  rawScore,
  sheetShape,
  type SheetShape,
} from '../markbook/model';
import {
  applyChangeRequestRoute,
  correctEntryRoute,
  enterScoresRoute,
  fileChangeRequestRoute,
  finishChangeRequestFiling,
  labelsRoute,
  logEntryUpdateAudit,
  lockRoute,
  termWeightsRoute,
  totalsRoute,
  unlockRoute,
  type Actor,
} from '../markbook/routes';
import { STAFF, emailOf, staffId, type StaffKey } from './staff';

export const MARKBOOK_AYS = ['AY2025', 'AY2026'] as const;
type MbAy = (typeof MARKBOOK_AYS)[number];

const actorOf = (key: StaffKey, role?: string): Actor => {
  const s = STAFF.find((x) => x.key === key);
  if (!s) throw new Error(`no staff ${key}`);
  return { id: staffId(s), email: emailOf(s), role: role ?? s.roles[0] };
};
/** The registrar-type user who shapes, locks and corrects sheets. */
const COORD = actorOf('coord');
/** The grade-change approver (step 1 of markbook.grade_change). */
const APPROVER = actorOf('asstPrincipal');

/** When each import locked its sheets (production: min 2025-11-14 04:00 UTC). */
const IMPORT_LOCK: Record<string, { at: string; by: string }> = {
  AY2025: { at: '2025-11-14T04:00:00Z', by: 'ay2025.backfill' },
  'AY2026:1': { at: '2026-03-20T02:00:00Z', by: 'backfill-import' },
  'AY2026:2': { at: '2026-06-05T02:00:00Z', by: 'backfill-import' },
};

// ── Reading the local state ───────────────────────────────────────────────

type Term = { ay: MbAy; n: number; id: string; start: string; end: string };

export type Sheet = {
  id: string;
  ay: MbAy;
  term: number;
  termId: string;
  sectionId: string;
  level: string;
  section: string;
  secondary: boolean;
  subjectId: string;
  code: string;
  examinable: boolean;
  configId: string;
  maxSlots: { ww: number; pt: number };
  ww_totals: number[];
  pt_totals: number[];
  qa_total: number | null;
  ownWeights: boolean;
  locked: boolean;
  teacherName: string | null;
  labelled: boolean;
  /** "AY2026 T3 P4 Diligence ENG" — stable across rebuilds. */
  key: string;
};

const nums = (s: string) => (s === '' ? [] : s.split(',').map(Number));

export function loadSheets(): Sheet[] {
  return sqlRows(`
    select gs.id, a.ay_code, t.term_number, t.id, s.id, l.code, s.name,
           coalesce(l.level_type, ''), sub.id, sub.code, sub.is_examinable, sc.id,
           sc.ww_max_slots, sc.pt_max_slots,
           array_to_string(gs.ww_totals, ','), array_to_string(gs.pt_totals, ','),
           coalesce(gs.qa_total::text, ''), gs.ww_weight is not null, gs.is_locked,
           coalesce(replace(gs.teacher_name, '|', '/'), ''), gs.slot_labels is not null
      from grading_sheets gs
      join terms t on t.id = gs.term_id
      join academic_years a on a.id = t.academic_year_id
      join sections s on s.id = gs.section_id
      join levels l on l.id = s.level_id
      join subjects sub on sub.id = gs.subject_id
      join subject_configs sc on sc.id = gs.subject_config_id
     where a.ay_code in ('AY2025', 'AY2026')
     order by a.ay_code, t.term_number, l.code, s.name, sub.code`).map((r) => ({
    id: r[0],
    ay: r[1] as MbAy,
    term: Number(r[2]),
    termId: r[3],
    sectionId: r[4],
    level: r[5],
    section: r[6],
    secondary: r[7] === 'secondary',
    subjectId: r[8],
    code: r[9],
    examinable: r[10] === 't',
    configId: r[11],
    maxSlots: { ww: Number(r[12]), pt: Number(r[13]) },
    ww_totals: nums(r[14]),
    pt_totals: nums(r[15]),
    qa_total: r[16] === '' ? null : Number(r[16]),
    ownWeights: r[17] === 't',
    locked: r[18] === 't',
    teacherName: r[19] || null,
    labelled: r[20] === 't',
    key: `${r[1]} T${r[2]} ${r[5]} ${r[6]} ${r[9]}`,
  }));
}

function loadTerms(): Term[] {
  return sqlRows(`select a.ay_code, t.term_number, t.id, t.start_date, t.end_date
      from terms t join academic_years a on a.id = t.academic_year_id
     where a.ay_code in ('AY2025', 'AY2026') order by 1, 2`).map((r) => ({
    ay: r[0] as MbAy,
    n: Number(r[1]),
    id: r[2],
    start: r[3],
    end: r[4],
  }));
}

type RosterRow = {
  id: string;
  sectionId: string;
  studentNumber: string;
  status: string;
  enrolled: string | null;
  withdrawn: string | null;
  ay: MbAy;
};

function loadRoster(): RosterRow[] {
  return sqlRows(`select ss.id, ss.section_id, st.student_number, ss.enrollment_status,
           coalesce(ss.enrollment_date::text, ''), coalesce(ss.withdrawal_date::text, ''), a.ay_code
      from section_students ss join students st on st.id = ss.student_id
      join sections s on s.id = ss.section_id
      join academic_years a on a.id = s.academic_year_id
     where a.ay_code in ('AY2025', 'AY2026')`).map((r) => ({
    id: r[0],
    sectionId: r[1],
    studentNumber: r[2],
    status: r[3],
    enrolled: r[4] || null,
    withdrawn: r[5] || null,
    ay: r[6] as MbAy,
  }));
}

type EntryLite = {
  id: string;
  sheetId: string;
  ssId: string;
  blank: boolean;
  /** Its score arrays already match the sheet's slots. */
  sized: boolean;
};

function loadEntries(): EntryLite[] {
  return sqlRows(`select ge.id, ge.grading_sheet_id, ge.section_student_id,
           (not ge.is_na and ge.qa_score is null and ge.quarterly_grade is null
            and ge.letter_grade is null
            and not exists (select 1 from unnest(ge.ww_scores) v where v is not null)
            and not exists (select 1 from unnest(ge.pt_scores) v where v is not null)),
           (cardinality(ge.ww_scores) = cardinality(gs.ww_totals)
            and cardinality(ge.pt_scores) = cardinality(gs.pt_totals))
      from grade_entries ge join grading_sheets gs on gs.id = ge.grading_sheet_id`).map(
    (r) => ({
      id: r[0],
      sheetId: r[1],
      ssId: r[2],
      blank: r[3] === 't',
      sized: r[4] === 't',
    })
  );
}

/** A write that would change nothing: still blank, already the right size. */
const noOp = (w: EntryWrite, e: EntryLite) =>
  e.sized &&
  !w.is_na &&
  w.qa_score == null &&
  w.quarterly_grade == null &&
  w.letter_grade == null &&
  [...w.ww_scores, ...w.pt_scores].every((v) => v == null);

// ── Step 1: sheets through the RPC ────────────────────────────────────────

async function createSheets(): Promise<void> {
  for (const ay of MARKBOOK_AYS) {
    const [[ayId, existing]] =
      sqlRows(`select a.id, (select count(*) from grading_sheets gs
        join terms t on t.id = gs.term_id where t.academic_year_id = a.id)
      from academic_years a where a.ay_code = '${ay}'`);
    if (Number(existing) > 0) {
      // ⚠ Not re-run: its "repair" step would put 10-point default slots back
      // on the import's deliberately slotless sheets.
      console.log(`  ${ay}: ${existing} sheets already there — RPC skipped`);
      continue;
    }
    const res = await must(
      `create_grading_sheets_for_ay ${ay}`,
      service().rpc('create_grading_sheets_for_ay', { p_ay_id: ayId })
    );
    console.log(
      `  ${ay}: create_grading_sheets_for_ay -> ${JSON.stringify(res)}`
    );
  }
}

// ── Step 2: the shape every sheet should have ─────────────────────────────

type Target = SheetShape & { teacherName: string | null };

/** Sheets of AY2025 Term 4 that keep their score slots (all left blank). */
const AY2025_T4_WITH_SLOTS = 25;
/** Term 4 subjects whose weights are restated through the term-weights route. */
const T4_TERM_WEIGHT_SUBJECTS = ['FIL', 'LIT', 'SS', 'HIST', 'STAR'];

function teacherNames(): Map<string, string> {
  const nameByEmail = new Map(STAFF.map((s) => [emailOf(s), s.name]));
  const out = new Map<string, string[]>();
  for (const [sectionId, subjectId, email, role] of sqlRows(`
      select ta.section_id, ta.subject_id, u.email, ta.role from teacher_assignments ta
        join auth.users u on u.id = ta.teacher_user_id
       where ta.role in ('subject_teacher', 'co_teacher') order by ta.role desc, u.email`)) {
    const k = `${sectionId}|${subjectId}`;
    const name = nameByEmail.get(email);
    if (name) out.set(k, [...(out.get(k) ?? []), name]);
  }
  return new Map([...out].map(([k, v]) => [k, v.join('/')]));
}

export function targetShapes(sheets: Sheet[]): Map<string, Target> {
  const names = teacherNames();
  const r = rng('markbook:targets');
  const t4Exam = sheets.filter(
    (s) => s.ay === 'AY2025' && s.term === 4 && s.examinable
  );
  const keepSlots = new Set(
    r.shuffle(t4Exam.map((s) => s.key).sort()).slice(0, AY2025_T4_WITH_SLOTS)
  );
  const out = new Map<string, Target>();
  for (const s of sheets) {
    if (s.ay === 'AY2025') {
      const slotless = !s.examinable || (s.term === 4 && !keepSlots.has(s.key));
      out.set(s.id, {
        ...(slotless
          ? { ww_totals: [], pt_totals: [], qa_total: null }
          : sheetShape(s.key, 'AY2025', s.maxSlots)),
        teacherName: null,
      });
      continue;
    }
    let shape = sheetShape(s.key, 'AY2026', s.maxSlots);
    // Built in the app (Terms 3–4): most sheets keep the subject's default
    // slots — 10 points each, as many as the config allows — and only get
    // their exam total set. Production's 250 `totals.update` rows over ~247
    // such sheets, and its WW-5 / PT-5 sheets, are that default showing.
    if (s.term >= 3 && rng(`markbook:defaults:${s.key}`).chance(0.7)) {
      shape = {
        ww_totals: Array<number>(s.maxSlots.ww).fill(10),
        pt_totals: Array<number>(s.maxSlots.pt).fill(10),
        qa_total: shape.qa_total,
      };
    }
    // Teacher names: the AY2026 workbook imports (Terms 1–2) carried them —
    // free text, sometimes missing; the app-built Terms 3–4 sheets do not.
    let teacherName: string | null = null;
    if (s.term <= 2 && !rng(`markbook:tn:${s.key}`).chance(0.08)) {
      teacherName = names.get(`${s.sectionId}|${s.subjectId}`) ?? null;
    }
    out.set(s.id, { ...shape, teacherName });
  }
  return out;
}

const sameNums = (a: number[], b: number[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/** The S-level Filipino class whose Term 3 had no exam (37/63/0). */
export function noExamSheet(sheets: Sheet[]): Sheet {
  const s = sheets.find(
    (x) => x.ay === 'AY2026' && x.term === 3 && x.code === 'FIL' && x.secondary
  );
  if (!s)
    throw new Error('markbook: no AY2026 Term 3 secondary Filipino sheet');
  return s;
}

/** Imported sheets (AY2025, AY2026 T1–T2): written as the imports wrote them. */
function shapeImported(sheets: Sheet[], targets: Map<string, Target>): number {
  const todo = sheets.filter((s) => {
    if (s.locked) return false;
    if (!(s.ay === 'AY2025' || s.term <= 2)) return false;
    const t = targets.get(s.id)!;
    return !(
      sameNums(s.ww_totals, t.ww_totals) &&
      sameNums(s.pt_totals, t.pt_totals) &&
      s.qa_total === t.qa_total &&
      s.teacherName === t.teacherName
    );
  });
  if (todo.length === 0) return 0;
  const lit = (v: string | null) =>
    v == null ? 'null' : `'${v.replace(/'/g, "''")}'`;
  const values = todo
    .map((s) => {
      const t = targets.get(s.id)!;
      return `('${s.id}'::uuid, '{${t.ww_totals.join(',')}}'::numeric[], '{${t.pt_totals.join(',')}}'::numeric[], ${t.qa_total ?? 'null'}::numeric, ${lit(t.teacherName)})`;
    })
    .join(',\n');
  sql(`update grading_sheets gs set ww_totals = v.ww, pt_totals = v.pt, qa_total = v.qa,
         teacher_name = v.tn, updated_at = now()
       from (values ${values}) as v(id, ww, pt, qa, tn) where gs.id = v.id`);
  return todo.length;
}

/** App-built sheets (AY2026 T3–T4): the totals route, as a coordinator. */
async function shapeInApp(
  sheets: Sheet[],
  targets: Map<string, Target>
): Promise<number> {
  let rows = 0;
  const sb = service();
  const noExam = noExamSheet(sheets);
  for (const s of sheets) {
    if (s.ay !== 'AY2026' || s.term < 3 || s.locked) continue;
    const t = targets.get(s.id)!;
    const qa = s.id === noExam.id ? null : t.qa_total;
    if (
      sameNums(s.ww_totals, t.ww_totals) &&
      sameNums(s.pt_totals, t.pt_totals) &&
      s.qa_total === qa
    ) {
      continue;
    }
    if (s.id === noExam.id) {
      // One save: the coordinator unticks "Exam" — the totals and this
      // class's own weights ride together (migration 159).
      rows += await totalsRoute(sb, COORD, s.id, {
        ww_totals: t.ww_totals,
        pt_totals: t.pt_totals,
        qa_total: null,
        ww_weight: 37,
        pt_weight: 63,
        qa_weight: 0,
      });
    } else {
      rows += await totalsRoute(sb, COORD, s.id, {
        ww_totals: t.ww_totals,
        pt_totals: t.pt_totals,
        qa_total: t.qa_total,
      });
    }
  }
  return rows;
}

/** Term 4: the subjects' own weights restated through the term-weights route. */
async function termWeights(sheets: Sheet[]): Promise<number> {
  const sb = service();
  let updated = 0;
  for (const code of T4_TERM_WEIGHT_SUBJECTS) {
    const mine = sheets.filter(
      (s) => s.ay === 'AY2026' && s.term === 4 && s.code === code
    );
    if (mine.length === 0)
      throw new Error(`markbook: no AY2026 Term 4 ${code} sheets`);
    if (mine.every((s) => s.ownWeights)) continue;
    updated += await termWeightsRoute(sb, COORD, mine[0].configId, {
      term_id: mine[0].termId,
      components: { ww: true, pt: true, qa: true },
    });
  }
  return updated;
}

// ── Step 3: slot labels (labels route, as the subject teacher) ────────────

const LABEL_WORDS = {
  ww: ['Quiz', 'Spelling test', 'Worksheet', 'Short test', 'Seatwork'],
  pt: [
    'Project',
    'Oral presentation',
    'Lab report',
    'Portfolio',
    'Performance task',
  ],
};

let subjectTeachers: Map<string, string> | null = null;

/** The sheet's subject teacher (teacher_assignments, role subject_teacher). */
function subjectTeacherOf(sheet: Sheet): Actor | null {
  if (!subjectTeachers) {
    subjectTeachers = new Map(
      sqlRows(`select ta.section_id, ta.subject_id, u.email from teacher_assignments ta
        join auth.users u on u.id = ta.teacher_user_id where ta.role = 'subject_teacher'`).map(
        ([sec, sub, email]) => [`${sec}:${sub}`, email]
      )
    );
  }
  const email = subjectTeachers.get(`${sheet.sectionId}:${sheet.subjectId}`);
  const s = email ? STAFF.find((x) => emailOf(x) === email) : null;
  return s ? actorOf(s.key, 'teacher') : null;
}

/**
 * The sheets whose subject teacher names the activities: 4 in Term 3, 13 in
 * Term 4 (production 4 / 13). Chosen without regard to lock state, so a
 * re-run picks the same sheets (Term 3 is partly locked by then). The Term 4
 * ones are also the sheets with marks in (see APP_ENTERED_TERMS): a first
 * score needs its slot labelled (the entries route's label gate), and these
 * are labelled first.
 */
export function labelPicks(sheets: Sheet[]): { t3: Sheet[]; t4: Sheet[] } {
  const r = rng('markbook:labels');
  const pick = (term: number, n: number) =>
    r
      .shuffle(
        sheets
          .filter(
            (s) => s.ay === 'AY2026' && s.term === term && subjectTeacherOf(s)
          )
          .sort((a, b) => a.key.localeCompare(b.key))
      )
      .slice(0, n);
  const t3 = pick(3, 4);
  const t4 = pick(4, 13);
  return { t3, t4 };
}

/** A sheet's generated activity names: words + dates spread over the term. */
function slotLabelsFor(
  s: Sheet,
  terms: Term[]
): { ww: SlotMeta[]; pt: SlotMeta[]; qa?: string } {
  const term = terms.find((t) => t.ay === s.ay && t.n === s.term)!;
  const lr = rng(`markbook:labels:${s.key}`);
  const day = (i: number, of: number) => {
    const a = Date.parse(term.start);
    const b = Date.parse(term.end);
    return new Date(a + ((b - a) * (i + 1)) / (of + 1))
      .toISOString()
      .slice(0, 10);
  };
  const ww = s.ww_totals.map((_, i) => ({
    label: `${lr.pick(LABEL_WORDS.ww)} ${i + 1}`,
    date: day(i, s.ww_totals.length),
  }));
  const pt = s.pt_totals.map((_, i) => ({
    label: `${lr.pick(LABEL_WORDS.pt)} ${i + 1}`,
    date: day(i, s.pt_totals.length),
  }));
  return {
    ww,
    pt,
    ...(s.qa_total != null ? { qa: `Term ${s.term} examination` } : {}),
  };
}

async function labels(sheets: Sheet[], terms: Term[]): Promise<number> {
  const { t3, t4 } = labelPicks(sheets);
  let written = 0;
  for (const s of [...t3, ...t4]) {
    if (s.labelled || s.locked) continue;
    if (
      await labelsRoute(
        service(),
        subjectTeacherOf(s)!,
        s.id,
        slotLabelsFor(s, terms)
      )
    )
      written++;
  }
  return written;
}

// ── Step 4: scores ────────────────────────────────────────────────────────

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/** Where a child is in a term: absent, or present with a lead/trail cut. */
type Presence =
  | { present: false }
  | { present: true; lead: number; keep: number; exam: boolean };

function presence(row: RosterRow, term: Term, terms: Term[]): Presence {
  const ayTerms = terms.filter((t) => t.ay === row.ay);
  const from = row.enrolled ?? ayTerms[0].start;
  let to = row.withdrawn;
  if (!to && row.status === 'withdrawn') {
    // A withdrawal with no date (AY2025's imported rows): a seeded term, half
    // way through it.
    const r = rng(`markbook:withdrawn:${row.ay}:${row.studentNumber}`);
    const wt = ayTerms[r.int(1, ayTerms.length - 1)];
    to = new Date((day(wt.start) + day(wt.end)) / 2).toISOString().slice(0, 10);
  }
  if (day(from) > day(term.end) || (to && day(to) < day(term.start))) {
    return { present: false };
  }
  const span = day(term.end) - day(term.start);
  const lead = Math.max(0, (day(from) - day(term.start)) / span);
  const keep =
    to && day(to) < day(term.end) ? (day(to) - day(term.start)) / span : 1;
  return { present: true, lead, keep, exam: keep >= 1 };
}

type EntryWrite = {
  grading_sheet_id: string;
  section_student_id: string;
  ww_scores: (number | null)[];
  pt_scores: (number | null)[];
  qa_score: number | null;
  is_na: boolean;
  letter_grade: string | null;
  quarterly_grade: number | null;
};

/** ~35% of children are exempt from the national languages (AY2025 N/A). */
const naExempt = (sn: string) => rng(`markbook:na:${sn}`).chance(0.35);
const NA_SUBJECTS = new Set(['FIL', 'MT']);

/**
 * The terms whose marks were TYPED INTO THE APP — written through the entries
 * route's direct path (labels first, `entry.update` audit rows) — rather than
 * imported (direct upsert, no audit).
 *
 * AY2026 Term 4 only. Term 3 stays import-shaped although its import script
 * was never applied, because production's own rows rule out the app for it:
 *   * the entries route logs one `entry.update` per changed slot, and
 *     production holds 491 in ALL (prod-profile.md, audit_log top actions)
 *     against ~11,400 scored Term 3 slots (4466 + 7538 slots, 277 + 317
 *     blank) — the app wrote at most 4% of them;
 *   * the route's first-score gate (lib/grading/first-score-gate.ts, in the
 *     route since 2026-07-24) refuses a first score into a slot with no
 *     description + date, yet production's Term 3 has slot labels on 4 of its
 *     124 sheets — every one of which is scored.
 * Term 4 matches the app: 13 labelled sheets, ~320 scored slots, ~1 audit row
 * each. Add 3 here to route Term 3 through the app too (~11k more
 * `entry.update` rows and a label on every Term 3 sheet).
 */
const APP_ENTERED_TERMS: Record<MbAy, number[]> = { AY2025: [], AY2026: [4] };
const appEntered = (s: Sheet) => APP_ENTERED_TERMS[s.ay].includes(s.term);

function slotsFor(
  totals: number[],
  comp: 'ww' | 'pt',
  level: number,
  p: Extract<Presence, { present: true }>,
  r: Rng,
  ay: MbAy
): (number | null)[] {
  const n = totals.length;
  const skip = Math.round(p.lead * n);
  const stop = p.keep >= 1 ? n : Math.round(p.keep * n);
  return totals.map((max, i) =>
    i < skip || i >= stop ? null : rawScore(comp, level, max, r, BLANK_RATE[ay])
  );
}

export type PlannedScore = { w: EntryWrite; e: EntryLite; sheet: Sheet };

/**
 * What every entry should hold — computed for EVERY entry, whatever it holds
 * now, so the plan is the same on a re-run (each child's marks come from its
 * own seeded stream); `writeScores` decides per entry what still needs
 * writing.
 */
export function planScores(
  sheets: Sheet[],
  terms: Term[],
  roster: RosterRow[],
  entries: EntryLite[]
): PlannedScore[] {
  const bySection = new Map<string, RosterRow[]>();
  for (const row of roster) {
    bySection.set(row.sectionId, [
      ...(bySection.get(row.sectionId) ?? []),
      row,
    ]);
  }
  const entriesBySheet = new Map<string, EntryLite[]>();
  for (const e of entries) {
    entriesBySheet.set(e.sheetId, [
      ...(entriesBySheet.get(e.sheetId) ?? []),
      e,
    ]);
  }
  // Term 4 is in progress: the first written work is in on the sheets whose
  // teacher has named the activities (production: 13 labelled, ~2% of slots
  // filled).
  const t4Started = new Set(labelPicks(sheets).t4.map((s) => s.key));
  // The two letter overrides (UG / E) production allows on a non-examinable
  // subject — not in production's data, here so the edge case exists once.
  const letterSheets = sheets
    .filter((s) => s.ay === 'AY2026' && s.term === 2 && !s.examinable)
    .slice(0, 2);

  const out: PlannedScore[] = [];
  for (const s of sheets) {
    const sheetEntries = entriesBySheet.get(s.id) ?? [];
    const term = terms.find((t) => t.ay === s.ay && t.n === s.term)!;
    const rowById = new Map(
      (bySection.get(s.sectionId) ?? []).map((r) => [r.id, r])
    );
    let lettersLeft = letterSheets.findIndex((x) => x.id === s.id) >= 0 ? 1 : 0;
    for (const e of [...sheetEntries].sort((a, b) =>
      (rowById.get(a.ssId)?.studentNumber ?? '').localeCompare(
        rowById.get(b.ssId)?.studentNumber ?? ''
      )
    )) {
      const row = rowById.get(e.ssId);
      if (!row) continue;
      const w: EntryWrite = {
        grading_sheet_id: s.id,
        section_student_id: e.ssId,
        ww_scores: s.ww_totals.map(() => null),
        pt_scores: s.pt_totals.map(() => null),
        qa_score: null,
        is_na: false,
        letter_grade: null,
        quarterly_grade: null,
      };
      out.push({ w, e, sheet: s });
      const p = presence(row, term, terms);
      if (!p.present) continue;
      const sn = row.studentNumber;
      const level = latent(sn, s.code, s.ay, s.term);
      const r = rng(`markbook:scores:${s.key}:${sn}`);

      if (s.ay === 'AY2025') {
        if (NA_SUBJECTS.has(s.code) && naExempt(sn)) {
          w.is_na = true;
          continue;
        }
        const slotless = s.ww_totals.length === 0 && s.pt_totals.length === 0;
        if (slotless || s.term === 4) {
          // The import's stored number: a band letter's representative for a
          // non-examinable subject, the workbook's grade for the rest.
          w.quarterly_grade = s.examinable
            ? importedQuarterly(level, r)
            : letterToRepresentative(nonExamLetter(level));
          continue;
        }
      }
      if (s.ay === 'AY2026' && s.term === 4) {
        if (t4Started.has(s.key) && w.ww_scores.length > 0 && !r.chance(0.08)) {
          w.ww_scores[0] = rawScore(
            'ww',
            level,
            s.ww_totals[0],
            r,
            BLANK_RATE.AY2026
          );
        }
        continue;
      }
      w.ww_scores = slotsFor(s.ww_totals, 'ww', level, p, r, s.ay);
      w.pt_scores = slotsFor(s.pt_totals, 'pt', level, p, r, s.ay);
      w.qa_score =
        s.qa_total != null && p.exam
          ? rawScore('qa', level, s.qa_total, r)
          : null;
      if (lettersLeft > 0) {
        w.letter_grade = letterSheets[0].id === s.id ? 'UG' : 'E';
        lettersLeft--;
      }
    }
  }
  return out;
}

/** Holds a mark (what a teacher would actually send). */
const hasMark = (w: EntryWrite) =>
  w.qa_score != null || [...w.ww_scores, ...w.pt_scores].some((v) => v != null);

/**
 * Writes the plan, deciding PER ENTRY — so a run that died part-way leaves
 * nothing permanently skipped:
 *   * imported terms — every entry still blank whose planned write changes
 *     something, upserted 500 at a time (the import's shape, no audit);
 *   * app-entered terms — per sheet, through the entries route's direct path
 *     as the subject teacher: entries still blank AND without an
 *     `entry.update` row are entered (one statement per sheet); an entry that
 *     holds marks but has no `entry.update` row (scores saved, audit lost)
 *     gets its rows written from the blank entry to what is stored.
 */
async function writeScores(
  plan: PlannedScore[],
  terms: Term[]
): Promise<string> {
  const sb = service();
  const t0 = Date.now();
  const imported = plan
    .filter((p) => !appEntered(p.sheet) && p.e.blank && !noOp(p.w, p.e))
    .map((p) => p.w);
  for (let i = 0; i < imported.length; i += 500) {
    const { error } = await sb
      .from('grade_entries')
      .upsert(imported.slice(i, i + 500), {
        onConflict: 'grading_sheet_id,section_student_id',
      });
    if (error)
      throw new Error(`markbook: grade_entries upsert ${i}: ${error.message}`);
  }
  const tImport = Date.now() - t0;

  const audited = new Set(
    sqlRows(`select distinct entity_id::text from audit_log
      where action = 'entry.update' and entity_type = 'grade_entry'`).map(
      (r) => r[0]
    )
  );
  const bySheet = new Map<string, PlannedScore[]>();
  for (const p of plan.filter((x) => appEntered(x.sheet))) {
    bySheet.set(p.sheet.id, [...(bySheet.get(p.sheet.id) ?? []), p]);
  }
  let entered = 0;
  let auditRows = 0;
  let backfilled = 0;
  let sheetsEntered = 0;
  for (const [sheetId, ps] of bySheet) {
    const s = ps[0].sheet;
    const actor = subjectTeacherOf(s) ?? COORD;

    // Scores saved by an earlier run whose audit rows never landed.
    const lost = ps.filter(
      (p) => !p.e.blank && hasMark(p.w) && !audited.has(p.e.id)
    );
    if (lost.length > 0) {
      const stored = new Map(
        sqlRows(`select id, array_to_string(ww_scores, ',', 'x'), array_to_string(pt_scores, ',', 'x'),
                 coalesce(qa_score::text, ''), coalesce(letter_grade, ''), is_na
            from grade_entries where id in (${lost.map((p) => `'${p.e.id}'`).join(',')})`).map(
          ([id, ww, pt, qa, lg, na]) => {
            const arr = (x: string) =>
              x === ''
                ? []
                : x.split(',').map((v) => (v === 'x' ? null : Number(v)));
            return [
              id,
              {
                ww_scores: arr(ww),
                pt_scores: arr(pt),
                qa_score: qa === '' ? null : Number(qa),
                letter_grade: lg || null,
                is_na: na === 't',
              },
            ] as const;
          }
        )
      );
      const items = lost.map((p) => ({
        entryId: p.e.id,
        rows: buildAuditRows(
          {
            ww_scores: [],
            pt_scores: [],
            qa_score: null,
            letter_grade: null,
            is_na: false,
          },
          stored.get(p.e.id)!,
          {
            grading_sheet_id: sheetId,
            grade_entry_id: p.e.id,
            changed_by: actor.email,
            approval_reference: '',
          }
        ),
      }));
      backfilled += await logEntryUpdateAudit(sb, actor, sheetId, items);
    }

    const todo = ps.filter(
      (p) => p.e.blank && !audited.has(p.e.id) && hasMark(p.w)
    );
    if (todo.length === 0) continue;

    // The label gate: a slot taking its first score needs a description and
    // a date (QA a description). Any such slot still unnamed is named first,
    // through the labels route as the subject teacher.
    await ensureLabels(s, todo, terms);

    const res = await enterScoresRoute(
      sb,
      actor,
      sheetId,
      todo.map((p) => ({
        entryId: p.e.id,
        ww_scores: p.w.ww_scores,
        pt_scores: p.w.pt_scores,
        ...(p.w.qa_score != null ? { qa_score: p.w.qa_score } : {}),
      }))
    );
    entered += res.entries;
    auditRows += res.auditRows;
    sheetsEntered++;
  }
  const tRoute = Date.now() - t0 - tImport;
  return `${imported.length} imported entries upserted (${(tImport / 1000).toFixed(1)}s); entries route: ${entered} entries on ${sheetsEntered} sheets, ${auditRows} entry.update rows${backfilled > 0 ? `, ${backfilled} missing entry.update rows written` : ''} (${(tRoute / 1000).toFixed(1)}s)`;
}

/** Names, through the labels route, every unnamed slot about to take its first score. */
async function ensureLabels(
  s: Sheet,
  todo: PlannedScore[],
  terms: Term[]
): Promise<void> {
  // The labels through supabase-js, never psql: they are free text (a title a
  // teacher typed), and psql's line-and-`|` output would split one with a
  // `|` or a line break in it.
  const [{ slot_labels: labels }] = await must(
    `markbook: slot labels of ${s.id}`,
    service().from('grading_sheets').select('slot_labels').eq('id', s.id)
  );
  const [[wwScored, ptScored, qaScored]] = sqlRows(`
    select coalesce((select string_agg(i::text, ',') from generate_subscripts(gs.ww_totals, 1) i
        where exists (select 1 from grade_entries ge where ge.grading_sheet_id = gs.id and ge.ww_scores[i] is not null)), ''),
      coalesce((select string_agg(i::text, ',') from generate_subscripts(gs.pt_totals, 1) i
        where exists (select 1 from grade_entries ge where ge.grading_sheet_id = gs.id and ge.pt_scores[i] is not null)), ''),
      exists (select 1 from grade_entries ge where ge.grading_sheet_id = gs.id and ge.qa_score is not null)
    from grading_sheets gs where gs.id = '${s.id}'`);
  const current = (labels ?? {}) as SlotLabels;
  // 1-based Postgres subscripts → 0-based slot indexes.
  const scored = (x: string) =>
    new Set(x === '' ? [] : x.split(',').map((v) => Number(v) - 1));
  const wwDone = scored(wwScored);
  const ptDone = scored(ptScored);
  const gen = slotLabelsFor(s, terms);
  let needed = false;
  const fill = (kind: 'ww' | 'pt', done: Set<number>) =>
    s[`${kind}_totals`].map((_, i) => {
      const have = (current[kind]?.[i] ?? null) as SlotMeta | null;
      const firstScore =
        !done.has(i) && todo.some((p) => p.w[`${kind}_scores`][i] != null);
      if (firstScore && !slotMetaSatisfied(kind, have)) {
        needed = true;
        return gen[kind][i];
      }
      return have;
    });
  const ww = fill('ww', wwDone);
  const pt = fill('pt', ptDone);
  const qaFirst =
    qaScored !== 't' &&
    todo.some((p) => p.w.qa_score != null) &&
    !slotMetaSatisfied('qa', current.qa ?? null);
  if (qaFirst) needed = true;
  if (!needed) return;
  await labelsRoute(service(), subjectTeacherOf(s) ?? COORD, s.id, {
    ww,
    pt,
    ...(qaFirst ? { qa: gen.qa ?? `Term ${s.term} examination` } : {}),
  });
}

// ── Step 5: locks ─────────────────────────────────────────────────────────

/** The imports' locks (AY2025 all, AY2026 T1–T2 all): direct, no audit row. */
function importLocks(): number {
  let n = 0;
  for (const [scope, { at, by }] of Object.entries(IMPORT_LOCK)) {
    const [ay, term] = scope.split(':');
    const out = sql(`with u as (
        update grading_sheets gs set is_locked = true, locked_at = '${at}', locked_by = '${by}', updated_at = now()
          from terms t join academic_years a on a.id = t.academic_year_id
         where t.id = gs.term_id and a.ay_code = '${ay}' ${term ? `and t.term_number = ${term}` : ''}
           and not gs.is_locked
         returning 1) select count(*) from u`);
    n += Number(out);
  }
  return n;
}

/** AY2026 Term 3: four locked by the lock route, the last unlocked again. */
async function term3Locks(sheets: Sheet[]): Promise<string> {
  const sb = service();
  const r = rng('markbook:t3-locks');
  const chosen = r
    .shuffle(
      sheets
        .filter((s) => s.ay === 'AY2026' && s.term === 3)
        .map((s) => s.key)
        .sort()
    )
    .slice(0, 4)
    .map((k) => sheets.find((s) => s.key === k)!);
  const audited = new Set(
    sqlRows(`select entity_id::text || ':' || action from audit_log
      where action in ('sheet.lock', 'sheet.unlock') and entity_type = 'grading_sheet'`).map(
      (x) => x[0]
    )
  );
  let locked = 0;
  let unlocked = 0;
  for (const [i, s] of chosen.entries()) {
    if (!audited.has(`${s.id}:sheet.lock`)) {
      const at = new Date(
        Date.parse('2026-09-07T03:00:00Z') + i * 17 * 60_000
      ).toISOString();
      if (await lockRoute(sb, COORD, s.id, at)) locked++;
    }
  }
  const last = chosen[3];
  if (!audited.has(`${last.id}:sheet.unlock`)) {
    if (await unlockRoute(sb, COORD, last.id)) unlocked++;
  }
  return `${locked} locked, ${unlocked} unlocked`;
}

// ── Step 6: post-lock edits ───────────────────────────────────────────────

const JUSTIFICATIONS: Record<CorrectionReason, string[]> = {
  typo: [
    '<p>Score was mis-keyed when the workbook was transferred; the marked script shows the correct mark.</p>',
    '<p>Teacher flagged a typing slip on this mark after the sheet was locked. Checked against the paper.</p>',
    '<p>Digits were transposed during entry. Corrected against the teacher’s mark book.</p>',
  ],
  wrong_column: [
    '<p>This student’s scores were entered on the neighbouring row. Re-keyed from the class record.</p>',
    '<p>Row was shifted by one during the import; scores re-entered from the original workbook.</p>',
  ],
  formula_fix: [
    '<p>The assessment was marked out of a different total than the sheet showed. Max score corrected.</p>',
  ],
  other: [
    '<p>Data integrity fix requested by the subject head after the moderation meeting.</p>',
  ],
};

/**
 * Correction plan sizes — ~52 single-mark typo fixes, ~12 re-keyed rows (~7
 * marks each), ~10 exam marks, one locked max: with the two applied requests,
 * ~150 `grade_audit_log` rows (the plan's target).
 */
const TYPO_FIXES = 52;
const ROW_REKEYS = 12;
const QA_FIXES = 10;

type ScoredEntry = {
  id: string;
  sheetId: string;
  sheetKey: string;
  sn: string;
  ww: (number | null)[];
  pt: (number | null)[];
  qa: number | null;
};

function lockedScoredEntries(): ScoredEntry[] {
  return sqlRows(`select ge.id, gs.id, a.ay_code || ' T' || t.term_number || ' ' || l.code || ' ' || s.name || ' ' || sub.code,
           st.student_number, array_to_string(ge.ww_scores, ',', 'x'), array_to_string(ge.pt_scores, ',', 'x'),
           coalesce(ge.qa_score::text, '')
      from grade_entries ge join grading_sheets gs on gs.id = ge.grading_sheet_id
      join terms t on t.id = gs.term_id join academic_years a on a.id = t.academic_year_id
      join sections s on s.id = gs.section_id join levels l on l.id = s.level_id
      join subjects sub on sub.id = gs.subject_id
      join section_students ss on ss.id = ge.section_student_id join students st on st.id = ss.student_id
     where gs.is_locked and not ge.is_na and t.term_number <= 3
       and ((a.ay_code = 'AY2025') or (a.ay_code = 'AY2026' and t.term_number <= 2))
       and cardinality(ge.ww_scores) > 0 and ge.quarterly_grade is not null
     order by 3, 4`).map((r) => {
    const arr = (x: string) =>
      x === '' ? [] : x.split(',').map((v) => (v === 'x' ? null : Number(v)));
    return {
      id: r[0],
      sheetId: r[1],
      sheetKey: r[2],
      sn: r[3],
      ww: arr(r[4]),
      pt: arr(r[5]),
      qa: r[6] === '' ? null : Number(r[6]),
    };
  });
}

/**
 * The post-lock corrections. Each one is its own step with its own stable
 * key, checked before it runs, so a run that died part-way picks up where it
 * stopped:
 *   * the entry for correction i of each kind comes from ONE shuffled pool
 *     (fixed order: the pool's membership — locked, scored, not N/A — is not
 *     changed by a correction), and correction i draws from its OWN seeded
 *     stream (`markbook:corrections:<kind>:<i>`), so skipping a done one
 *     cannot shift the next;
 *   * an entry is done when it carries a "Data entry correction" row in
 *     grade_audit_log (each entry is corrected at most once);
 *   * the locked max is done when its sheet carries one for `ww_totals[1]`.
 * The values come from the entry as it stands — a not-yet-done entry has not
 * been touched, so that is the imported mark.
 */
async function corrections(sheets: Sheet[]): Promise<string> {
  const sb = service();
  const sheetById = new Map(sheets.map((s) => [s.id, s]));
  const pool = rng('markbook:corrections').shuffle(lockedScoredEntries());
  // Either trail counts (the route writes grade_audit_log, then audit_log).
  const corrected = new Set(
    sqlRows(`select grade_entry_id::text from grade_audit_log
        where approval_reference like 'Data entry correction%'
      union select entity_id::text from audit_log
        where action = 'grade_correction' and entity_type = 'grade_entry'`).map(
      (x) => x[0]
    )
  );
  const done = (entryId: string) => corrected.has(entryId);
  const used = new Set<string>();
  let rows = 0;
  let skipped = 0;
  const take = () => {
    const e = pool.find((x) => !used.has(x.id));
    if (!e) throw new Error('markbook: ran out of locked entries to correct');
    used.add(e.id);
    return e;
  };
  const mutateWith = (r: Rng) => (v: number, max: number) => {
    const opts = [
      v + 1,
      v - 1,
      v + 2,
      v - 2,
      Math.floor(v / 10) + (v % 10) * 10,
      v + 5,
    ].filter((x) => x >= 0 && x <= max && x !== v);
    return opts.length ? r.pick(opts) : v === max ? max - 1 : max;
  };

  for (let i = 0; i < TYPO_FIXES; i++) {
    const e = take();
    if (done(e.id)) {
      skipped++;
      continue;
    }
    const r = rng(`markbook:corrections:typo:${i}`);
    const mutate = mutateWith(r);
    const s = sheetById.get(e.sheetId)!;
    const comp = e.pt.some((v) => v != null) && r.chance(0.5) ? 'pt' : 'ww';
    const arr = [...(comp === 'ww' ? e.ww : e.pt)];
    const totals = comp === 'ww' ? s.ww_totals : s.pt_totals;
    const idxs = arr.map((v, j) => (v != null ? j : -1)).filter((j) => j >= 0);
    if (idxs.length === 0) continue;
    const j = r.pick(idxs);
    arr[j] = mutate(arr[j]!, totals[j]);
    rows += await correctEntryRoute(sb, COORD, s.id, e.id, {
      [comp === 'ww' ? 'ww_scores' : 'pt_scores']: arr,
      correction_reason: 'typo',
      correction_justification: r.pick(JUSTIFICATIONS.typo),
    });
  }
  for (let i = 0; i < ROW_REKEYS; i++) {
    const e = take();
    if (done(e.id)) {
      skipped++;
      continue;
    }
    const r = rng(`markbook:corrections:rekey:${i}`);
    const mutate = mutateWith(r);
    const s = sheetById.get(e.sheetId)!;
    const rk = (arr: (number | null)[], totals: number[]) =>
      arr.map((v, j) => (v == null ? v : mutate(v, totals[j])));
    rows += await correctEntryRoute(sb, COORD, s.id, e.id, {
      ww_scores: rk(e.ww, s.ww_totals),
      pt_scores: rk(e.pt, s.pt_totals),
      correction_reason: 'wrong_column',
      correction_justification: r.pick(JUSTIFICATIONS.wrong_column),
    });
  }
  for (let i = 0; i < QA_FIXES; i++) {
    const e = take();
    if (done(e.id)) {
      skipped++;
      continue;
    }
    const r = rng(`markbook:corrections:qa:${i}`);
    const s = sheetById.get(e.sheetId)!;
    if (e.qa == null || s.qa_total == null) continue;
    rows += await correctEntryRoute(sb, COORD, s.id, e.id, {
      qa_score: mutateWith(r)(e.qa, s.qa_total),
      correction_reason: 'typo',
      correction_justification: r.pick(JUSTIFICATIONS.typo),
    });
  }

  // One locked sheet's max corrected (totals route, Path B): the second
  // written work was out of 20 on the paper. The sheet is the first by key
  // whose W2 was under 20 — or already carries this correction (it is 20
  // after it, so the "under 20" test alone would move to another sheet).
  const maxFixed = new Set(
    sqlRows(`select grading_sheet_id::text from grade_audit_log
        where field_changed = 'ww_totals[1]' and approval_reference like 'Data entry correction%'
      union select entity_id::text from audit_log
        where action = 'grade_correction' and entity_type = 'grading_sheet'
          and context->>'field' = 'ww_totals[1]'`).map((x) => x[0])
  );
  const t2 = sheets
    .filter(
      (s) =>
        s.ay === 'AY2026' &&
        s.term === 2 &&
        s.ww_totals.length >= 2 &&
        (s.ww_totals[1] < 20 || maxFixed.has(s.id))
    )
    .sort((a, b) => a.key.localeCompare(b.key))[0];
  if (t2 && maxFixed.has(t2.id)) {
    skipped++;
  } else if (t2) {
    const ww = [...t2.ww_totals];
    ww[1] = 20;
    rows += await totalsRoute(sb, COORD, t2.id, {
      ww_totals: ww,
      correction_reason: 'formula_fix',
      correction_justification: JUSTIFICATIONS.formula_fix[0],
    });
  }
  return `${rows} audit rows written, ${skipped} corrections already done`;
}

/** The two applied grade change requests (production: 2, regrading, ww_scores). */
async function changeRequests(sheets: Sheet[]): Promise<string> {
  const sb = service();
  const done: string[] = [];
  const candidates = lockedScoredEntries().filter((e) =>
    e.sheetKey.startsWith('AY2026 T2')
  );
  const r = rng('markbook:crs');
  const picks = r.shuffle(candidates).filter((e) => {
    const s = sheets.find((x) => x.id === e.sheetId)!;
    return (
      subjectTeacherOf(s) &&
      e.ww.some((v, j) => v != null && v + 2 <= s.ww_totals[j])
    );
  });
  const seenSheets = new Set<string>();
  const chosen = picks
    .filter((e) => !seenSheets.has(e.sheetId) && seenSheets.add(e.sheetId))
    .slice(0, 2);
  for (const [n, e] of chosen.entries()) {
    const id = uuidFrom(`markbook:change-request:${n + 1}`);
    const s = sheets.find((x) => x.id === e.sheetId)!;
    const teacher = subjectTeacherOf(s)!;
    let status = sql(
      `select status from grade_change_requests where id = '${id}'`
    );
    const approvalId = () =>
      sqlRows(`select id from approval_requests
        where subject_type = 'grade_change_request' and subject_id = '${id}'`)[0]?.[0];
    if (status === 'pending' && !approvalId()) {
      // Filed, but the run died before its approval request opened: what the
      // route does when that fails — take the request back out — then file
      // it again below.
      const { error } = await sb
        .from('grade_change_requests')
        .delete()
        .eq('id', id);
      if (error)
        throw new Error(`markbook: CR rollback ${id}: ${error.message}`);
      status = '';
    }
    if (
      status &&
      !sql(
        `select 1 from audit_log where action = 'grade_change_requested' and entity_id = '${id}'`
      )
    ) {
      // Filed and opened, but its `grade_change_requested` row never landed.
      const [req] = (await must(
        `grade_change_requests ${id}`,
        sb.from('grade_change_requests').select('*').eq('id', id)
      )) as Array<
        Parameters<typeof finishChangeRequestFiling>[2] & {
          requested_by_email: string;
        }
      >;
      // The filer as the request records them (the audit row is theirs).
      const filer = STAFF.find((x) => emailOf(x) === req.requested_by_email);
      await finishChangeRequestFiling(
        sb,
        filer ? actorOf(filer.key, 'teacher') : teacher,
        req,
        approvalId()!
      );
    }
    if (!status) {
      const slot = e.ww.findIndex(
        (v, j) => v != null && v + 2 <= s.ww_totals[j]
      );
      await fileChangeRequestRoute(sb, teacher, id, {
        grading_sheet_id: s.id,
        grade_entry_id: e.id,
        field_changed: 'ww_scores',
        slot_index: slot,
        current_value: String(e.ww[slot]),
        proposed_value: String(e.ww[slot]! + 2),
        reason_category: 'regrading',
        justification:
          n === 0
            ? '<p>On re-marking the quiz with the department, two answers marked wrong were accepted alternatives.</p>'
            : '<p>Moderation found the rubric was applied too strictly on this script; two marks restored.</p>',
      });
      status = 'pending';
    }
    if (status === 'pending') {
      const res = await decideApproval({
        service: sb,
        actor: {
          id: APPROVER.id,
          email: APPROVER.email,
          role: APPROVER.role as Role,
        },
        requestId: approvalId()!,
        action: 'approve',
        note: null,
        via: 'in_app',
      });
      if (!res.ok)
        throw new Error(
          `markbook: decideApproval: ${JSON.stringify(res.body)}`
        );
      status = 'approved';
    }
    if (status === 'approved') {
      await applyChangeRequestRoute(sb, COORD, id);
      status = 'applied';
    }
    done.push(`${s.key} ${e.sn}: ${status}`);
  }
  return done.join('; ');
}

// ── Run ───────────────────────────────────────────────────────────────────

export async function runMarkbook(): Promise<void> {
  const teachers = Number(sql(`select count(*) from teacher_assignments`));
  if (teachers === 0)
    throw new Error(
      'markbook: no teacher assignments (run the teachers phase)'
    );

  await createSheets();
  const terms = loadTerms();
  let sheets = loadSheets();
  const targets = targetShapes(sheets);

  const imported = shapeImported(sheets, targets);
  const inApp = await shapeInApp(sheets, targets);
  console.log(
    `  shapes: ${imported} imported sheets written; ${inApp} totals-route audit rows`
  );

  sheets = loadSheets();
  const labelled = await labels(sheets, terms);
  const weighted = await termWeights(sheets);
  console.log(
    `  labels on ${labelled} sheets; term weights restated on ${weighted} Term 4 sheets`
  );

  sheets = loadSheets();
  const plan = planScores(sheets, terms, loadRoster(), loadEntries());
  console.log(
    `  scores (raw only; the trigger derived the grades): ${await writeScores(plan, terms)}`
  );

  const importLocked = importLocks();
  sheets = loadSheets();
  console.log(
    `  locks: ${importLocked} by the imports; Term 3: ${await term3Locks(sheets)}`
  );

  sheets = loadSheets();
  console.log(`  post-lock corrections: ${await corrections(sheets)}`);
  console.log(`  change requests: ${await changeRequests(sheets)}`);
}
