// Phase "teachers" (plan phase 2): AY2026 teacher assignments and relief cover.
//
// Production's shape (prod-profile.md, teacher_assignments): AY2026 only —
// AY2025 has NONE, and neither does AY2027 — 21 form advisers over 22 classes
// (one class without), 120 subject-teacher rows over the 21 classes that have
// subjects, 4 co-teacher rows (3 people, 4 classes), no co-advisers, and 3
// cover bookings, all ENDED and none carrying a reason. 27 distinct people
// hold a class (26 teaching accounts + the Science subject head; relief@
// holds none). Added here, both by relief@local.test and both dated from the
// REAL run date (see runRelativeCoverWindows): one LIVE cover on a Secondary
// 1 Science class — the SOW demo — and one SCHEDULED cover about a week out
// on P6 Grit Mathematics, for the "You're covering" panel. Both are three
// school days with no holiday between (`pickCoverWindows`); the scheduled one
// is skipped, with a printed note, once the year has no such window left.
//
// Write paths (plan ground rule 2). Neither writer is a lib function — both
// are route handlers that gate on a cookie session — so each is mirrored:
//   * Assignments — POST /api/teacher-assignments (bulk): the body is parsed
//     by the route's own `AssignmentBulkCreateSchema`, every teacher is checked
//     against `getTeacherList({ excludeDisabled: false })` as the route does,
//     the rows go in as ONE insert with the route's exact column set, and each
//     created row gets the route's `assignment.create` audit row (same context
//     keys: ids, role, teacher_name, section_name "P4 Diligence",
//     subject_name named the way the section's year names it), then the
//     route's drill-cache busts.
//   * Cover — PATCH /api/teacher-assignments/[id] (one class): the substitute
//     is checked against `getTeacherList()`, the four relief columns are
//     written, and the route's `assignment.relief.start` row is logged with
//     the route's own `buildReliefAuditContext` + `buildPreviousReliefContext`.
//     The LIVE and SCHEDULED bookings are also parsed by the route's
//     `AssignmentReliefSchema`.
//     The three ENDED bookings are not: production's carry no reason, which
//     migration 164 now requires — they predate it, and are reproduced as
//     production holds them.
//
// IDEMPOTENT ON ITS OWN (ground rule 6): the plan is deterministic, rows that
// already exist (same teacher, class, subject, role) are skipped — but one
// found without its `assignment.create` row (a run that died between the
// insert and the audit) gets that row written — and a cover
// is only written — and audited — when the row does not already carry it. A
// second `--only teachers` the same day writes nothing (on a later day the
// live and scheduled covers move with the run date, and are re-booked). A
// planned slot already held by a
// DIFFERENT teacher stops the phase: that is reshaped data, which is
// `npm run local:rebuild`'s job, not this phase's.

import {
  buildPreviousReliefContext,
  buildReliefAuditContext,
} from '@/lib/audit/assignment-context';
import { logAction, logActions } from '@/lib/audit/log-action';
import { getTeacherList } from '@/lib/auth/staff-list';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import {
  AssignmentBulkCreateSchema,
  AssignmentReliefSchema,
  type AssignmentRole,
} from '@/lib/schemas/teacher-assignment';
import { subjectDisplayNameResolver } from '@/lib/sis/subjects/display-names-for-ay';

import { runDateSg } from '../lib/constants';
import { must, service, sqlRows } from '../lib/local';
import { rng } from '../lib/random';
import { STAFF, emailOf, staffId, type StaffKey } from './staff';

export const TEACHERS_AY = 'AY2026';

type Actor = { id: string; email: string; role: string };
const actorOf = (key: StaffKey, role?: string): Actor => {
  const s = STAFF.find((x) => x.key === key);
  if (!s) throw new Error(`no staff ${key}`);
  return { id: staffId(s), email: emailOf(s), role: role ?? s.roles[0] };
};
const idOf = (key: StaffKey) => actorOf(key).id;

/** Who staffs the year (`staff.edit_assignments`: academic_coordinator+). */
const STAFFER = actorOf('coord');
/** Who books cover (`staff.manage_relief`: school_admin+), by school half. */
const COVER_PRIMARY = actorOf('oicPrimary');
const COVER_SECONDARY = actorOf('oicSecondary');

// ── Reference data ────────────────────────────────────────────────────────

type Section = {
  id: string;
  name: string;
  level: string; // "P4", "S1", "YS"
  secondary: boolean;
  subjects: Array<{ id: string; code: string }>;
};

function loadSections(): Section[] {
  const rows = sqlRows(`
    select s.id, s.name, l.code, coalesce(l.level_type, ''),
           coalesce(string_agg(sub.id || ':' || sub.code, ',' order by sub.code), '')
      from sections s
      join levels l on l.id = s.level_id
      join academic_years a on a.id = s.academic_year_id
      left join section_subjects ss on ss.section_id = s.id
      left join subject_configs sc on sc.id = ss.subject_config_id
      left join subjects sub on sub.id = sc.subject_id
     where a.ay_code = '${TEACHERS_AY}'
     group by s.id, s.name, l.code, l.level_type
     order by l.code, s.name`);
  return rows.map(([id, name, level, levelType, subs]) => ({
    id,
    name,
    level,
    secondary: levelType === 'secondary',
    subjects: subs
      ? subs.split(',').map((x) => {
          const [sid, code] = x.split(':');
          return { id: sid, code };
        })
      : [],
  }));
}

// ── The plan ──────────────────────────────────────────────────────────────

export type PlannedAssignment = {
  teacher: StaffKey;
  sectionId: string;
  sectionLabel: string; // "P4 Diligence"
  subjectId: string | null;
  subjectCode: string | null;
  role: AssignmentRole;
};

/**
 * Who teaches what, by school half: [teacher, number of that half's classes of
 * the subject]. Each (half, subject) list sums to that half's staffed classes
 * of it — the plan throws otherwise — and the classes are dealt out in a
 * seeded shuffle.
 *
 * Sized to production's AY2026 shape (prod-profile, teacher_assignments): 26
 * subject teachers holding 120 rows, rows per teacher min 1 / p50 5 / p90 7 /
 * max 11, distinct subjects per teacher p50 2 / max 4. Here: 1,1,1,2,3,3,3,
 * 4,4,4,4,5,5,5,5,5,5,5,6,6,6,6,6,7,7,11 — the Primary generalist (teacher13)
 * carries the 11 across four subjects, single-subject specialists sit at 6–7,
 * and three Secondary teachers hold one class each.
 */
const ALLOCATION: Record<
  'P' | 'S',
  Record<string, Array<[StaffKey, number]>>
> = {
  P: {
    ENG: [
      ['teacher13', 4],
      ['teacher9', 5],
      ['teacher16', 2],
      ['teacher17', 2],
      ['teacher5', 1],
      ['teacher25', 1],
    ],
    MATH: [
      ['teacher13', 4],
      ['teacher10', 6],
      ['teacher17', 3],
      ['teacher18', 2],
    ],
    SCI: [
      ['teacher11', 7],
      ['teacher13', 2],
      ['teacher3', 2],
      ['teacher19', 2],
      ['teacher18', 1],
      ['teacher4', 1],
    ],
    FIL: [
      ['teacher4', 4],
      ['teacher14', 5],
      ['teacher13', 1],
    ],
    MANDARIN: [['teacher5', 4]],
    STAR: [
      ['teacher7', 5],
      ['teacher12', 4],
      ['teacher19', 3],
      ['teacher16', 2],
    ],
  },
  S: {
    ENG: [
      ['teacher1', 3],
      ['teacher9', 2],
      ['teacher20', 1],
    ],
    LIT: [
      ['teacher1', 3],
      ['teacher20', 1],
    ],
    MATH: [['teacher2', 6]],
    SCI: [
      ['teacher3', 3],
      ['coordScience', 3],
    ],
    FIL: [['teacher15', 4]],
    CA: [['teacher21', 4]],
    ARTD: [
      ['teacher7', 1],
      ['teacher21', 1],
    ],
    PESTD: [
      ['teacher12', 2],
      ['teacher22', 2],
    ],
    PEH: [['teacher22', 2]],
    COMP: [['teacher8', 2]],
    GP: [['teacher8', 1]],
    HIST: [['teacher6', 2]],
    SS: [['teacher6', 2]],
    HUM: [
      ['teacher23', 1],
      ['teacher24', 1],
    ],
  },
};

/**
 * Form advisers, by school half — one class each, in a seeded class order.
 * 21 people for 21 classes (production: 21 advisers, 21 distinct). teacher26
 * advises and teaches nothing — production's one adviser-only person.
 */
const ADVISERS: Record<'P' | 'S', StaffKey[]> = {
  P: [
    'teacher13',
    'teacher9',
    'teacher10',
    'teacher11',
    'teacher4',
    'teacher5',
    'teacher7',
    'teacher3',
    'teacher14',
    'teacher16',
    'teacher17',
    'teacher18',
    'teacher19',
    'teacher25',
    'teacher26',
  ],
  S: [
    'teacher1',
    'teacher8',
    'teacher12',
    'teacher6',
    'teacher2',
    'coordScience',
  ],
};

/** The one class production leaves without a form adviser. */
const NO_ADVISER = 'Test Section';

/**
 * Production covers 120 of its ~124 class subjects; three go unstaffed here.
 * Fixed rather than drawn so the co-teacher sheets and the live cover can
 * never land on one of them.
 */
const UNSTAFFED: Array<[level: string, section: string, subject: string]> = [
  ['P1', 'Patience', 'MANDARIN'],
  ['P5', 'Tenacity', 'STAR'],
  ['S2', 'Integrity 1', 'GP'],
];

/**
 * Production: 4 co-teacher rows, 3 people, 4 classes — HFSE's shared subjects
 * (Sec 3 and Sec 4 Humanities, P2 and P4 STAR; teacher-assignment.ts).
 */
const CO_TEACHERS: Array<[string, string, string, StaffKey]> = [
  ['S3', 'Consistency', 'SS', 'teacher9'],
  ['S4', 'Excellence', 'SS', 'teacher9'],
  ['P2', 'Humility', 'STAR', 'teacher6'],
  ['P4', 'Trust', 'STAR', 'teacher10'],
];

export function buildAssignmentPlan(sections: Section[]): PlannedAssignment[] {
  const r = rng('teachers:plan');
  const out: PlannedAssignment[] = [];
  const label = (s: Section) => `${s.level} ${s.name}`;
  const find = (level: string, name: string) => {
    const s = sections.find((x) => x.level === level && x.name === name);
    if (!s)
      throw new Error(`teachers: no ${TEACHERS_AY} class ${level} ${name}`);
    return s;
  };

  // Advisers: every class but one, each half's list taken in a shuffled
  // class order so who advises what is not alphabetical.
  for (const half of ['P', 'S'] as const) {
    const classes = r.shuffle(
      sections.filter(
        (s) => (half === 'S') === s.secondary && s.name !== NO_ADVISER
      )
    );
    if (classes.length !== ADVISERS[half].length) {
      throw new Error(
        `teachers: ${classes.length} ${half} classes need an adviser, ADVISERS has ${ADVISERS[half].length}`
      );
    }
    classes.forEach((s, i) => {
      out.push({
        teacher: ADVISERS[half][i],
        sectionId: s.id,
        sectionLabel: label(s),
        subjectId: null,
        subjectCode: null,
        role: 'form_adviser',
      });
    });
  }

  // Subject teachers: each (half, subject)'s staffed classes, in a seeded
  // order, dealt to ALLOCATION's teachers in turn — teacher A takes the first
  // n classes, teacher B the next m, and so on. Counts must match exactly.
  const unstaffed = new Set(
    UNSTAFFED.map(([lv, nm, code]) => `${find(lv, nm).id}|${code}`)
  );
  const byHalfSubject = new Map<
    string,
    Array<{ s: Section; sub: Section['subjects'][number] }>
  >();
  for (const s of sections) {
    const half = s.secondary ? 'S' : 'P';
    for (const sub of s.subjects) {
      if (unstaffed.has(`${s.id}|${sub.code}`)) continue;
      const k = `${half}|${sub.code}`;
      byHalfSubject.set(k, [...(byHalfSubject.get(k) ?? []), { s, sub }]);
    }
  }
  for (const [k, classes] of [...byHalfSubject].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    const [half, code] = k.split('|') as ['P' | 'S', string];
    const alloc = ALLOCATION[half][code];
    if (!alloc) throw new Error(`teachers: no ALLOCATION for ${half} ${code}`);
    const want = alloc.reduce((n, [, c]) => n + c, 0);
    if (want !== classes.length) {
      throw new Error(
        `teachers: ALLOCATION ${half} ${code} deals ${want} classes, there are ${classes.length}`
      );
    }
    const dealt = r.shuffle(
      [...classes].sort((a, b) => label(a.s).localeCompare(label(b.s)))
    );
    let i = 0;
    for (const [teacher, n] of alloc) {
      for (let j = 0; j < n; j++, i++) {
        const { s, sub } = dealt[i];
        out.push({
          teacher,
          sectionId: s.id,
          sectionLabel: label(s),
          subjectId: sub.id,
          subjectCode: sub.code,
          role: 'subject_teacher',
        });
      }
    }
  }
  for (const half of ['P', 'S'] as const) {
    for (const code of Object.keys(ALLOCATION[half])) {
      if (!byHalfSubject.has(`${half}|${code}`)) {
        throw new Error(
          `teachers: ALLOCATION names ${half} ${code}, which no class takes`
        );
      }
    }
  }

  for (const [lv, nm, code, who] of CO_TEACHERS) {
    const s = find(lv, nm);
    const sub = s.subjects.find((x) => x.code === code);
    if (!sub) throw new Error(`teachers: ${label(s)} has no ${code}`);
    const owner = out.find(
      (a) =>
        a.role === 'subject_teacher' &&
        a.sectionId === s.id &&
        a.subjectId === sub.id
    );
    if (!owner) throw new Error(`teachers: ${label(s)} ${code} has no owner`);
    if (owner.teacher === who) {
      throw new Error(
        `teachers: ${who} would co-teach their own ${label(s)} ${code}`
      );
    }
    out.push({
      teacher: who,
      sectionId: s.id,
      sectionLabel: label(s),
      subjectId: sub.id,
      subjectCode: code,
      role: 'co_teacher',
    });
  }

  // The Science subject head teaches Science (task rule) — the pool gives it
  // to her, this proves it did.
  if (
    !out.some((a) => a.teacher === 'coordScience' && a.subjectCode === 'SCI')
  ) {
    throw new Error('teachers: the Science subject head got no Science class');
  }
  return out;
}

// ── Cover ─────────────────────────────────────────────────────────────────

export type CoverState = 'ended' | 'live' | 'scheduled';

type PlannedCover = {
  /** Which assignment: class, and subject code (null = the form class). */
  level: string;
  section: string;
  subject: string | null;
  relief: StaffKey;
  startedOn: string;
  endedOn: string;
  reason: string | null;
  state: CoverState;
};

/** AY2026's school days, ascending (school_calendar, day_type school_day). */
export function schoolDays(): string[] {
  return sqlRows(`
    select distinct sc.date::text
      from school_calendar sc
      join terms t on t.id = sc.term_id
      join academic_years a on a.id = t.academic_year_id
     where a.ay_code = '${TEACHERS_AY}' and sc.day_type = 'school_day'
     order by 1`).map((r) => r[0]);
}

export type CoverWindow = { from: string; to: string };

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Mon–Fri dates from `from` to `to`, inclusive. */
function weekdaysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(d);
  }
  return out;
}

/**
 * Every CLEAN cover window on the calendar: three consecutive school days
 * with no non-school weekday (a holiday, a term break) between the first and
 * the last — exactly what `assertSchoolDays` demands of a cover.
 */
export function cleanWindows(days: string[]): CoverWindow[] {
  const isSchool = new Set(days);
  const out: CoverWindow[] = [];
  for (let i = 0; i + 2 < days.length; i++) {
    const w = { from: days[i], to: days[i + 2] };
    if (weekdaysBetween(w.from, w.to).every((d) => isSchool.has(d))) {
      out.push(w);
    }
  }
  return out;
}

/** Is this window one `cleanWindows` would give (for the verify self-check)? */
export function isCleanWindow(days: string[], w: CoverWindow): boolean {
  const isSchool = new Set(days);
  return (
    isSchool.has(w.from) &&
    isSchool.has(w.to) &&
    // three school days (a calendar may hold a Saturday one), and no
    // non-school weekday between them
    days.filter((d) => w.from <= d && d <= w.to).length === 3 &&
    weekdaysBetween(w.from, w.to).every((d) => isSchool.has(d))
  );
}

/**
 * The live and scheduled cover windows for a run date, from a list of school
 * days. Pure — never throws on a calendar that has at least one clean window:
 *   * live      — the clean window that CONTAINS the run date, latest start
 *                 first (a weekend run lands inside Fri..Tue); failing that
 *                 (the run date is a holiday, or a holiday sits inside every
 *                 window around it), the next clean window after it; past the
 *                 last term, the last clean window of the year (it is then
 *                 already ended, and the note says so);
 *   * scheduled — the first clean window starting at least a week after the
 *                 run date, or none (with a note) when the year has no such
 *                 window left.
 */
export function pickCoverWindows(
  days: string[],
  runDate: string
): { live: CoverWindow; scheduled: CoverWindow | null; notes: string[] } {
  const windows = cleanWindows(days);
  if (windows.length === 0) {
    throw new Error(
      `teachers: ${TEACHERS_AY}'s school calendar has no three clean school days in a row (run local:refresh)`
    );
  }
  const notes: string[] = [];
  const containing = windows.filter(
    (w) => w.from <= runDate && runDate <= w.to
  );
  let live = containing.at(-1);
  if (!live) {
    live = windows.find((w) => w.from > runDate);
    if (live) {
      notes.push(
        `no clean cover window contains ${runDate}; the "live" cover starts at the next one, ${live.from}`
      );
    }
  }
  if (!live) {
    live = windows.at(-1)!;
    notes.push(
      `${runDate} is past ${TEACHERS_AY}'s last term; the "live" cover is anchored to its last clean window, ${live.from}..${live.to}`
    );
  }
  const weekOut = addDays(runDate, 7);
  const scheduled = windows.find((w) => w.from >= weekOut) ?? null;
  if (!scheduled) {
    notes.push(
      `no clean cover window starts on or after ${weekOut} in ${TEACHERS_AY}; the scheduled cover is skipped`
    );
  }
  return { live, scheduled, notes };
}

/**
 * The live and scheduled cover windows, from the REAL run date — the one
 * documented exception to the fixed TODAY anchor (lib/constants.ts). See
 * `pickCoverWindows`; `scheduled` is null when the year has no clean window
 * a week or more out.
 */
export function runRelativeCoverWindows(runDate: string = runDateSg()): {
  live: CoverWindow;
  scheduled: CoverWindow | null;
  notes: string[];
} {
  return pickCoverWindows(schoolDays(), runDate);
}

export function coverPlan(runDate?: string): PlannedCover[] {
  const w = runRelativeCoverWindows(runDate);
  const plan: PlannedCover[] = [
    // Three ENDED, no reason — production's three (all pre-migration-164).
    {
      level: 'P3',
      section: 'Courageous',
      subject: 'ENG',
      relief: 'relief',
      startedOn: '2026-05-04',
      endedOn: '2026-05-06',
      reason: null,
      state: 'ended',
    },
    {
      level: 'S2',
      section: 'Integrity 2',
      subject: 'MATH',
      relief: 'teacher10',
      startedOn: '2026-07-14',
      endedOn: '2026-07-16',
      reason: null,
      state: 'ended',
    },
    {
      level: 'P5',
      section: 'Commitment',
      subject: null,
      relief: 'relief',
      startedOn: '2026-09-15',
      endedOn: '2026-09-17',
      reason: null,
      state: 'ended',
    },
    // The LIVE one, for the SOW demo.
    {
      level: 'S1',
      section: 'Discipline 1',
      subject: 'SCI',
      relief: 'relief',
      startedOn: w.live.from,
      endedOn: w.live.to,
      reason: 'Attending a CPD workshop off-site',
      state: 'live',
    },
  ];
  // A SCHEDULED one, for the "You're covering" panel — when the year still
  // has a clean window a week out.
  if (w.scheduled) {
    plan.push({
      level: 'P6',
      section: 'Grit',
      subject: 'MATH',
      relief: 'relief',
      startedOn: w.scheduled.from,
      endedOn: w.scheduled.to,
      reason: 'Medical leave (planned procedure)',
      state: 'scheduled',
    });
  }
  return plan;
}

/** Every weekday in a cover window must be a school day on the calendar. */
function assertSchoolDays(c: PlannedCover): void {
  const bad = sqlRows(`
    select d::date
      from generate_series('${c.startedOn}'::date, '${c.endedOn}'::date, '1 day') d
      left join school_calendar sc
        on sc.date = d::date
       and sc.term_id in (select t.id from terms t
                            join academic_years a on a.id = t.academic_year_id
                           where a.ay_code = '${TEACHERS_AY}')
     where extract(isodow from d) < 6
       and coalesce(sc.day_type, '') <> 'school_day'`);
  if (bad.length > 0) {
    throw new Error(
      `teachers: cover ${c.level} ${c.section} ${c.startedOn}..${c.endedOn} includes non-school days: ${bad.map((b) => b[0]).join(', ')}`
    );
  }
}

// ── Run ───────────────────────────────────────────────────────────────────

type ExistingRow = {
  id: string;
  teacher_user_id: string;
  section_id: string;
  subject_id: string | null;
  role: AssignmentRole;
  relief_teacher_user_id: string | null;
  relief_started_on: string | null;
  relief_ended_on: string | null;
  relief_reason: string | null;
};

const EXISTING_COLUMNS =
  'id, teacher_user_id, section_id, subject_id, role, relief_teacher_user_id, relief_started_on, relief_ended_on, relief_reason';

async function loadExisting(sectionIds: string[]): Promise<ExistingRow[]> {
  return must(
    'teacher_assignments read',
    service()
      .from('teacher_assignments')
      .select(EXISTING_COLUMNS)
      .in('section_id', sectionIds)
  ) as Promise<ExistingRow[]>;
}

export async function runTeachers(): Promise<void> {
  const sb = service();
  const sections = loadSections();
  if (sections.length === 0) {
    throw new Error(`teachers: no ${TEACHERS_AY} sections (run local:refresh)`);
  }
  const ayId = sqlRows(
    `select id from academic_years where ay_code = '${TEACHERS_AY}'`
  )[0][0];
  const plan = buildAssignmentPlan(sections);

  // ── Assignments: POST /api/teacher-assignments, mirrored ────────────────
  const existing = await loadExisting(sections.map((s) => s.id));
  const key = (t: string, sec: string, sub: string | null, role: string) =>
    `${t}|${sec}|${sub ?? ''}|${role}`;
  const have = new Set(
    existing.map((e) =>
      key(e.teacher_user_id, e.section_id, e.subject_id, e.role)
    )
  );
  const missing = plan.filter(
    (p) => !have.has(key(idOf(p.teacher), p.sectionId, p.subjectId, p.role))
  );
  const plannedKeys = new Set(
    plan.map((p) => key(idOf(p.teacher), p.sectionId, p.subjectId, p.role))
  );

  // A planned PRIMARY slot already held by someone else is reshaped data.
  for (const p of missing) {
    const clash = existing.find(
      (e) =>
        e.section_id === p.sectionId &&
        ((p.role === 'form_adviser' && e.role === 'form_adviser') ||
          (p.role === 'subject_teacher' &&
            e.role === 'subject_teacher' &&
            e.subject_id === p.subjectId))
    );
    if (clash) {
      throw new Error(
        `teachers: ${p.sectionLabel} ${p.subjectCode ?? 'form class'} is already held by another teacher — run npm run local:rebuild`
      );
    }
  }

  let created = 0;
  // The route's account list: its gate, and its teacher names on the audit.
  const assignable = await getTeacherList({ excludeDisabled: false });
  if (missing.length > 0) {
    // The route's body, parsed by the route's schema.
    const parsed = AssignmentBulkCreateSchema.safeParse({
      assignments: missing.map((p) => ({
        teacher_user_id: idOf(p.teacher),
        section_id: p.sectionId,
        subject_id: p.subjectId,
        role: p.role,
      })),
    });
    if (!parsed.success) {
      throw new Error(
        `teachers: AssignmentBulkCreateSchema refused the plan: ${parsed.error.issues[0]?.message}`
      );
    }
    const rows = parsed.data.assignments;

    // The route's account gate.
    const assignableIds = new Set(assignable.map((t) => t.id));
    const stranger = rows.find((r) => !assignableIds.has(r.teacher_user_id));
    if (stranger) {
      throw new Error(
        `teachers: ${stranger.teacher_user_id} is not on getTeacherList() — run the staff phase`
      );
    }

    // ONE insert, every key on every row (the route's PostgREST note).
    const inserted = (await must(
      'teacher_assignments insert',
      sb
        .from('teacher_assignments')
        .insert(
          rows.map((r) => ({
            teacher_user_id: r.teacher_user_id,
            section_id: r.section_id,
            subject_id:
              r.role === 'form_adviser' || r.role === 'co_adviser'
                ? null
                : (r.subject_id ?? null),
            role: r.role,
          }))
        )
        .select(
          'id, teacher_user_id, section_id, subject_id, role, relief_teacher_user_id'
        )
    )) as Array<{
      id: string;
      teacher_user_id: string;
      section_id: string;
      subject_id: string | null;
      role: AssignmentRole;
    }>;
    if (inserted.length !== rows.length) {
      throw new Error(
        `teachers: insert returned ${inserted.length} of ${rows.length} rows`
      );
    }
    created = inserted.length;
    invalidateDrillTags('markbook', TEACHERS_AY);
    invalidateDrillTags('evaluation', TEACHERS_AY);
    invalidateDrillTags('attendance', TEACHERS_AY);
  }

  // ── assignment.create audit rows ─────────────────────────────────────────
  // The insert and its audit rows are two writes. Rather than trust that the
  // second followed the first, every planned row now in the table is checked
  // for its `assignment.create` row, and the missing ones written — the rows
  // just inserted, and any a failed earlier run left without one.
  const present = (await loadExisting(sections.map((s) => s.id))).filter((e) =>
    plannedKeys.has(key(e.teacher_user_id, e.section_id, e.subject_id, e.role))
  );
  const audited = new Set(
    sqlRows(
      `select entity_id::text from audit_log where action = 'assignment.create' and entity_type = 'teacher_assignment'`
    ).map((r) => r[0])
  );
  const unaudited = present.filter((e) => !audited.has(e.id));
  const backfilled = unaudited.length - created;
  if (unaudited.length > 0) {
    const inserted = unaudited;
    // The route's names: teacher from the account list, class "P4 Diligence",
    // subject named the way the class's own year names it (migration 137).
    const teacherNames = new Map(assignable.map((t) => [t.id, t.name]));
    const sectionLabel = new Map(
      sections.map((s) => [s.id, `${s.level} ${s.name}`])
    );
    const subjectRows = (await must(
      'subjects read',
      sb
        .from('subjects')
        .select('id, name')
        .in('id', [
          ...new Set(
            inserted.map((a) => a.subject_id).filter((x): x is string => !!x)
          ),
        ])
    )) as Array<{ id: string; name: string | null }>;
    const resolveName = await subjectDisplayNameResolver(
      sb,
      [ayId],
      subjectRows.map((s) => s.id)
    );
    const subjectNames = new Map<string, string>();
    for (const s of subjectRows) {
      if (s.name) {
        subjectNames.set(s.id, resolveName(ayId, { id: s.id, name: s.name }));
      }
    }

    // Insert order is not guaranteed to be the plan's; sort for a stable
    // audit order across rebuilds.
    const ordered = [...inserted].sort((a, b) =>
      key(a.teacher_user_id, a.section_id, a.subject_id, a.role).localeCompare(
        key(b.teacher_user_id, b.section_id, b.subject_id, b.role)
      )
    );
    await logActions(
      sb,
      { id: STAFFER.id, email: STAFFER.email, role: STAFFER.role },
      ordered.map((a) => {
        const teacherName = teacherNames.get(a.teacher_user_id);
        const sectionName = sectionLabel.get(a.section_id);
        const subjectName = a.subject_id
          ? subjectNames.get(a.subject_id)
          : undefined;
        return {
          action: 'assignment.create' as const,
          entityType: 'teacher_assignment' as const,
          entityId: a.id,
          context: {
            teacher_user_id: a.teacher_user_id,
            section_id: a.section_id,
            subject_id: a.subject_id,
            role: a.role,
            ...(teacherName ? { teacher_name: teacherName } : {}),
            ...(sectionName ? { section_name: sectionName } : {}),
            ...(subjectName ? { subject_name: subjectName } : {}),
          },
        };
      })
    );
  }

  // ── Cover: PATCH /api/teacher-assignments/[id], mirrored ────────────────
  const after = await loadExisting(sections.map((s) => s.id));
  const liveStaff = await getTeacherList();
  const covers = coverPlan();
  for (const note of runRelativeCoverWindows().notes) {
    console.log(`  note: ${note}`);
  }
  let booked = 0;
  for (const c of covers) {
    assertSchoolDays(c);
    const s = sections.find((x) => x.level === c.level && x.name === c.section);
    if (!s) throw new Error(`teachers: no class ${c.level} ${c.section}`);
    const subjectId = c.subject
      ? (s.subjects.find((x) => x.code === c.subject)?.id ?? null)
      : null;
    const row = after.find(
      (e) =>
        e.section_id === s.id &&
        (c.subject
          ? e.role === 'subject_teacher' && e.subject_id === subjectId
          : e.role === 'form_adviser')
    );
    if (!row) {
      throw new Error(
        `teachers: ${c.level} ${c.section} ${c.subject ?? 'form class'} has no teacher to cover`
      );
    }
    const reliefId = idOf(c.relief);
    if (
      row.relief_teacher_user_id === reliefId &&
      row.relief_started_on === c.startedOn &&
      row.relief_ended_on === c.endedOn &&
      (row.relief_reason ?? null) === c.reason
    ) {
      continue; // already booked — idempotent
    }
    if (reliefId === row.teacher_user_id) {
      throw new Error(`teachers: ${c.relief} would cover their own class`);
    }
    if (!liveStaff.some((t) => t.id === reliefId)) {
      throw new Error(`teachers: ${c.relief} is not on getTeacherList()`);
    }
    if (c.state !== 'ended') {
      const parsed = AssignmentReliefSchema.safeParse({
        relief_teacher_user_id: reliefId,
        relief_started_on: c.startedOn,
        relief_ended_on: c.endedOn,
        relief_reason: c.reason,
      });
      if (!parsed.success) {
        throw new Error(
          `teachers: AssignmentReliefSchema refused the ${c.state} cover: ${parsed.error.issues[0]?.message}`
        );
      }
    }

    const { error } = await sb
      .from('teacher_assignments')
      .update({
        relief_teacher_user_id: reliefId,
        relief_started_on: c.startedOn,
        relief_ended_on: c.endedOn,
        relief_reason: c.reason,
      })
      .eq('id', row.id);
    if (error) throw new Error(`teachers: cover ${row.id}: ${error.message}`);

    const actor = s.secondary ? COVER_SECONDARY : COVER_PRIMARY;
    await logAction({
      service: sb,
      actor: { id: actor.id, email: actor.email, role: actor.role },
      action: 'assignment.relief.start',
      entityType: 'teacher_assignment',
      entityId: row.id,
      context: await buildReliefAuditContext(sb, row, reliefId, {
        relief_started_on: c.startedOn,
        relief_ended_on: c.endedOn,
        relief_reason: c.reason,
        ...(await buildPreviousReliefContext(row)),
      }),
    });
    booked++;
  }
  if (booked > 0) {
    invalidateDrillTags('markbook', TEACHERS_AY);
    invalidateDrillTags('evaluation', TEACHERS_AY);
    invalidateDrillTags('attendance', TEACHERS_AY);
  }

  console.log(
    `  ${TEACHERS_AY}: ${plan.length} planned assignments, ${created} created (${plan.length - missing.length} already there)${backfilled > 0 ? `, ${backfilled} missing assignment.create audit rows written` : ''}; ${covers.length} covers, ${booked} booked`
  );
}
