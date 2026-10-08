// Phase "attendance" (plan phase 4): one register mark per child per school
// day, AY2025 (all four terms) and AY2026 up to the real run date (Term 4 in
// progress; capped at Term 4's end — the one run-date-dependent part, see
// lib/constants.ts), for exactly the days each child is on the class list
// (see ../attendance/roster.ts).
//
// Write path: the app's own `writeDailyBatch` (lib/attendance/mutations.ts) —
// one insert per call, then `recompute_attendance_rollup` per (term, child);
// the `attendance_daily_sync_rollup` trigger also recomputes on every row and
// the `attendance_daily_guard_closed_day` trigger refuses any mark on a day
// that is not a teaching day, so `attendance_records` is the database's own.
// Two shapes, as production has them:
//
//   * IMPORTED REGISTERS — AY2025 and AY2026 Terms 1–3 (all but T3's last
//     day). Production's are backfills: `recorded_by` NULL, no audit row
//     (prod-profile: recorded_by set on 0 rows before AY2026 T3, 102 in T3).
//     One `writeDailyBatch` per class per term, recorded_by NULL — what the
//     backfill wrote, through the app's writer instead of raw SQL.
//
//   * THE DAILY ROUTE — AY2026 T3's last day and every Term 4 day so far.
//     PATCH /api/attendance/daily is mirrored (it gates on a cookie session):
//     the class's form adviser submits the class for a day, entries checked
//     by the route's own `DailyBulkSchema`, written by `writeDailyBatch` with
//     `recorded_by` = the adviser, then the route's own audit rows through
//     `logActions` — one per entry, `attendance.daily.update` when the
//     register is taken on the day and `attendance.daily.correct` when it is
//     taken (or changed) on a later day, with the route's context keys
//     (prior_status, ex_reason, ex_note_present / ex_note_changed — presence
//     only, never the words). "The day it was taken" is simulated: the route
//     compares with `sgToday()`, the seeder with its own entry day, so the
//     action is the same on every rebuild. Mostly on the day, about a fifth
//     one to three school days late (production: update 5,229 / correct
//     1,390). Every day before the run date is taken by the run date (a late
//     entry that would land after it is taken on it), so the app — which
//     counts a day before `sgToday()` with no mark as owed — shows no class
//     behind; the run date's own register is taken only when it was taken on
//     the day. Everything up to TODAY is pinned; the rest is masked from the
//     fingerprints (`runDependentRegisterKeys`). On top: Absent
//     marks corrected to an MC once the certificate came in (prior A → EX
//     mc), and marks cleared (status null, migration 134) — most re-marked
//     later, a few left cleared.
//
// Reasons and notes appear only from AY2026 Term 3 (production's 219
// reasoned rows), never on NC or a clear (the table's CHECKs). Leave quotas
// (KD #94/#142, vacation counted in trips): every child keeps
// `vacation_leave_allowance_per_term` NULL (school default 1 per term) and
// `urgent_compassionate_allowance` 5 — one child takes two trips in Term 3
// and one in Term 4 (over the vacation quota), one takes 6 compassionate days
// (over the yearly 5) and one 2.
//
// Idempotent: an imported class × term that already has imported rows is
// skipped (one insert per class × term, so it is all there or not at all).
// The route path is checked call by call — each call is one insert of marks
// and one insert of audit rows, and the n-th planned write of an (enrolment,
// day) is done when that key already has more than n route marks (resp. route
// audit rows) — so a re-run after a crash writes exactly what is missing, the
// audit rows of a call whose marks landed included.

import { logActions } from '@/lib/audit/log-action';
import {
  writeDailyBatch,
  type DailyWriteInput,
} from '@/lib/attendance/mutations';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { DailyBulkSchema, statusTakesNote } from '@/lib/schemas/attendance';

import { TODAY, runDateSg } from '../lib/constants';
import { service, sqlRows } from '../lib/local';
import { rng } from '../lib/random';
import {
  annotate,
  drawYear,
  type Mark,
  type Special,
} from '../attendance/model';
import {
  ATTENDANCE_AYS,
  byChild,
  loadRoster,
  type AttAy,
  type Enrolment,
  type Roster,
  type SchoolDayRow,
} from '../attendance/roster';
import { STAFF, emailOf, staffId } from './staff';

type Actor = { id: string; email: string; role: string };

/** The whole register, decided before anything is written. */
export type RegisterPlan = {
  roster: Roster;
  /** `${enrolmentId}|${date}` → the day's final mark. */
  marks: Map<string, Mark>;
  /** AY2026 Term 3's last school day — entered through the route. */
  t3Last: string;
};

const keyOf = (enrolmentId: string, date: string) => `${enrolmentId}|${date}`;

/** Deterministic picks of the children whose year is out of the ordinary. */
function specials(roster: Roster): Map<string, Special> {
  const out = new Map<string, Special>();
  for (const ay of ATTENDANCE_AYS) {
    const fullYear = [
      ...new Set(
        roster.enrolments
          .filter(
            (e) =>
              e.ay === ay &&
              e.status === 'active' &&
              !e.enrollmentDate &&
              e.level !== 'YS'
          )
          .map((e) => e.studentNumber)
      ),
    ].sort();
    const r = rng(`attendance:specials:${ay}`);
    const pool = r.shuffle(fullYear);
    // A couple of chronic absentees per year (production max 18% / 27%).
    out.set(`${ay}|${pool[0]}`, { kind: 'chronic' });
    out.set(`${ay}|${pool[1]}`, { kind: 'chronic' });
    if (ay === 'AY2026') {
      out.set(`${ay}|${pool[2]}`, { kind: 'twoTrips', term: 3 });
      out.set(`${ay}|${pool[3]}`, { kind: 'twoTrips', term: 4 });
      out.set(`${ay}|${pool[4]}`, {
        kind: 'compassionate',
        terms: [3, 4],
        days: 6,
      });
      out.set(`${ay}|${pool[5]}`, {
        kind: 'compassionate',
        terms: [4],
        days: 2,
      });
    }
  }
  return out;
}

/** AY2026 Term 3's last school day — the first register taken in the app. */
function t3LastDay(roster: Roster): string {
  const t3 = roster.terms.find((t) => t.ay === 'AY2026' && t.number === 3)!;
  return roster
    .schoolDays('AY2026', 'P1')
    .filter((d) => d.termId === t3.id)
    .at(-1)!.date;
}

/** AY2026's classes, in the order the route path takes them. */
function route2026Sections(
  roster: Roster
): Array<{ id: string; name: string; level: string }> {
  return [
    ...new Map(
      roster.enrolments
        .filter((e) => e.ay === 'AY2026')
        .map((e) => [
          e.sectionId,
          { id: e.sectionId, name: e.sectionName, level: e.level },
        ])
    ).values(),
  ].sort((a, b) =>
    `${a.level} ${a.name}`.localeCompare(`${b.level} ${b.name}`)
  );
}

/**
 * Every day one class's register goes through the route — T3's last day and
 * all of Term 4 — with the day it is naturally taken: on the day (~78%), or
 * one to three school days late. Drawn for the WHOLE term, due or not, so no
 * day's draw depends on how far the run date has got. '9999-12-31' = taken
 * after the term closed.
 */
function entryDays(
  roster: Roster,
  t3Last: string,
  s: { name: string; level: string }
): Array<{ day: SchoolDayRow; natural: string }> {
  const t4 = roster.terms.find((t) => t.ay === 'AY2026' && t.number === 4)!;
  const r = rng(`attendance:route:${s.level}:${s.name}`);
  const days = roster
    .schoolDays('AY2026', s.level)
    .filter((d) => d.date === t3Last || d.termId === t4.id);
  return days.map((day, i) => {
    let natural = day.date;
    if (day.date !== t3Last && !r.chance(0.78)) {
      const idx = i + r.int(1, 3);
      natural = idx < days.length ? days[idx].date : '9999-12-31';
    }
    return { day, natural };
  });
}

/** The register: every child's year drawn, reasons placed, NC days set. */
export async function planRegister(): Promise<RegisterPlan> {
  const roster = await loadRoster();
  const t3 = roster.terms.find((t) => t.ay === 'AY2026' && t.number === 3)!;
  const t3Last = t3LastDay(roster);
  const special = specials(roster);

  // Reasons/notes: production has them from AY2026 T3 on — about a quarter
  // of T3's (imported) excused days, most of T4's (entered in the app).
  const t4Start = roster.terms.find(
    (t) => t.ay === 'AY2026' && t.number === 4
  )!.start;
  const reasonShare = (ay: AttAy) => (date: string) =>
    ay !== 'AY2026' || date < t3.start
      ? 0
      : date >= t4Start || date === t3Last
        ? 0.7
        : 0.25;

  const marks = new Map<string, Mark>();
  for (const [key, rows] of byChild(roster.enrolments)) {
    const [ay, sn] = key.split('|') as [AttAy, string];
    const days: SchoolDayRow[] = rows
      .flatMap((e) => e.days)
      .sort((a, b) => a.date.localeCompare(b.date));
    const {
      marks: year,
      episodeOf,
      forced,
    } = drawYear(ay, sn, days, special.get(key) ?? null, TODAY);
    annotate(ay, sn, year, episodeOf, forced, reasonShare(ay));
    for (const e of rows)
      for (const d of e.days) marks.set(keyOf(e.id, d.date), year.get(d.date)!);
  }

  // NC — "no class" marks, rare (production: AY2025 T1 1, T2 20, T3 3;
  // AY2026 T3 3). One class's whole day in AY2025 T2, the rest single days.
  const r = rng('attendance:nc');
  const nc = (m: Mark | undefined) => {
    if (!m) return;
    m.status = 'NC';
    m.exReason = null;
    m.exNote = null;
  };
  const onDay = (ay: AttAy, term: number) =>
    roster.enrolments.filter(
      (e) => e.ay === ay && e.days.some((d) => d.term === term)
    );
  {
    const t2 = roster.terms.find((t) => t.ay === 'AY2025' && t.number === 2)!;
    const sections = [
      ...new Set(onDay('AY2025', 2).map((e) => e.sectionId)),
    ].sort();
    const sectionId = r.pick(sections);
    // The CLASS's school days in the term (never one child's — a child who
    // left in Term 1 has none in Term 2). Children not on the list that day
    // have no mark to change.
    const level = roster.enrolments.find(
      (e) => e.sectionId === sectionId
    )!.level;
    const days = roster
      .schoolDays('AY2025', level)
      .filter((d) => d.termId === t2.id);
    const date = r.pick(days).date;
    for (const e of roster.enrolments.filter((x) => x.sectionId === sectionId))
      nc(marks.get(keyOf(e.id, date)));
  }
  for (const [ay, term, n] of [
    ['AY2025', 1, 1],
    ['AY2025', 3, 3],
    ['AY2026', 3, 3],
  ] as const) {
    // The class's school days in the term that this child was on the list
    // for — T3's last day excluded (it is entered through the route, where a
    // teacher cannot write NC). Children with no such day are not drawn.
    const eligible = (e: Enrolment) => {
      const onList = new Set(e.days.map((d) => d.date));
      return roster
        .schoolDays(ay, e.level)
        .filter(
          (d) => d.term === term && d.date !== t3Last && onList.has(d.date)
        );
    };
    const pool = onDay(ay, term)
      .filter((e) => eligible(e).length > 0)
      .sort((a, b) => a.studentNumber.localeCompare(b.studentNumber));
    for (let i = 0; i < n; i++) {
      const e = r.pick(pool);
      nc(marks.get(keyOf(e.id, r.pick(eligible(e)).date)));
    }
  }
  return { roster, marks, t3Last };
}

// ── Writing ───────────────────────────────────────────────────────────────

/** Each AY2026 class's form adviser (the coordinator for a class with none). */
function registerTakers(): Map<string, Actor> {
  const rows = sqlRows(
    `select ta.section_id, u.id, u.email, coalesce(u.raw_app_meta_data->>'active_role', 'teacher')
       from teacher_assignments ta join auth.users u on u.id = ta.teacher_user_id
      where ta.role = 'form_adviser'`
  );
  return new Map(
    rows.map(([sectionId, id, email, role]) => [sectionId, { id, email, role }])
  );
}

async function writeImported(plan: RegisterPlan): Promise<number> {
  const sb = service();
  const done = new Set(
    sqlRows(
      `select distinct ss.section_id, d.term_id from attendance_daily d
         join section_students ss on ss.id = d.section_student_id where d.recorded_by is null`
    ).map(([sectionId, termId]) => `${sectionId}|${termId}`)
  );
  let written = 0;
  for (const term of plan.roster.terms) {
    if (term.ay === 'AY2026' && term.number === 4) continue;
    const enrolments = plan.roster.enrolments.filter((e) => e.ay === term.ay);
    const sections = [...new Set(enrolments.map((e) => e.sectionId))].sort();
    for (const sectionId of sections) {
      if (done.has(`${sectionId}|${term.id}`)) continue;
      const inputs: DailyWriteInput[] = [];
      for (const e of enrolments.filter((x) => x.sectionId === sectionId)) {
        for (const d of e.days) {
          if (d.termId !== term.id || d.date === plan.t3Last) continue;
          const m = plan.marks.get(keyOf(e.id, d.date))!;
          inputs.push({
            sectionStudentId: e.id,
            termId: term.id,
            date: d.date,
            status: m.status,
            exReason: m.exReason,
            exNote: m.exNote,
            recordedBy: null,
          });
        }
      }
      if (inputs.length === 0) continue;
      await writeDailyBatch(sb, inputs);
      written += inputs.length;
    }
  }
  return written;
}

type RouteEntry = {
  enrolment: Enrolment;
  termId: string;
  date: string;
  mark: Mark;
};
type RouteCall = {
  /** The day the register was taken (or changed). */
  enteredOn: string;
  /**
   * The register was taken on or before TODAY, so this call is the same on
   * every rebuild. A call that is not pinned — a day after TODAY, or one
   * taken late after TODAY — exists only because the real run date has
   * reached it (lib/constants.ts) and is masked from the fingerprints.
   */
  pinned: boolean;
  order: number;
  sectionKey: string;
  sectionId: string;
  sectionName: string;
  actor: Actor;
  entries: RouteEntry[];
};

/**
 * The route calls: each class's daily submit, the MC corrections and the
 * clears. Decided in full before anything is written.
 *
 * Every class's register is taken for every school day that is due — up to
 * `roster.registerEnd`, the real run date (capped at Term 4's end) — so no
 * class shows a day before the app's `sgToday()` as unmarked: a day whose
 * late entry would fall after the run date is taken late ON the run date
 * instead, and the run date's own register is taken only if it was taken on
 * the day. Whether a day is taken on the day or 1–3 school days late is drawn
 * over the WHOLE term, so it never depends on the run date. The corrections
 * are drawn from the pinned submits only, and are all done by TODAY.
 */
export function planRouteCalls(
  plan: RegisterPlan,
  takers: Map<string, Actor>
): RouteCall[] {
  const { roster, marks, t3Last } = plan;
  const run = runDateSg();
  const coord = STAFF.find((s) => s.key === 'coord')!;
  const coordActor: Actor = {
    id: staffId(coord),
    email: emailOf(coord),
    role: coord.roles[0],
  };
  const t4 = roster.terms.find((t) => t.ay === 'AY2026' && t.number === 4)!;
  const enrolments = roster.enrolments.filter((e) => e.ay === 'AY2026');

  const calls: RouteCall[] = [];
  const submitted: Array<{ call: RouteCall; entry: RouteEntry }> = [];
  for (const s of route2026Sections(roster)) {
    const actor = takers.get(s.id) ?? coordActor;
    for (const { day: d, natural } of entryDays(roster, t3Last, s)) {
      if (d.date > roster.registerEnd) continue;
      let enteredOn = natural;
      if (natural > roster.registerEnd) {
        // Not taken by the run date. A day before the run date is owed —
        // the app would show it unmarked — so it is taken late, today; the
        // run date's own register is today's job and stays open.
        if (d.date >= run) continue;
        enteredOn = run;
      }
      const entries: RouteEntry[] = enrolments
        .filter(
          (e) => e.sectionId === s.id && e.days.some((x) => x.date === d.date)
        )
        .map((e) => ({
          enrolment: e,
          termId: d.termId,
          date: d.date,
          mark: { ...marks.get(keyOf(e.id, d.date))! },
        }));
      if (entries.length === 0) continue;
      const call: RouteCall = {
        enteredOn,
        pinned: natural <= TODAY,
        order: 0,
        sectionKey: `${s.level} ${s.name}`,
        sectionId: s.id,
        sectionName: s.name,
        actor,
        entries,
      };
      calls.push(call);
      for (const entry of entries) submitted.push({ call, entry });
    }
  }

  // Corrections, drawn from the submits in a stable order.
  const r = rng('attendance:route:corrections');
  const laterDay = (call: RouteCall, n: number) => {
    const days = roster.schoolDays('AY2026', call.entries[0].enrolment.level);
    const i = days.findIndex((x) => x.date === call.enteredOn);
    return days[i + n]?.date ?? '9999-12-31';
  };
  const single = (
    call: RouteCall,
    entry: RouteEntry,
    enteredOn: string,
    order: number,
    mark: Mark
  ): RouteCall => ({
    ...call,
    enteredOn,
    order,
    entries: [{ ...entry, mark }],
  });

  // Absent on the day, MC brought in later: prior A → EX mc.
  const mcs = r
    .shuffle(
      submitted.filter(
        ({ call, entry }) =>
          call.pinned &&
          entry.date >= t4.start &&
          entry.mark.status === 'EX' &&
          entry.mark.exReason === 'mc' &&
          laterDay(call, 3) <= TODAY
      )
    )
    .slice(0, 25);
  for (const { call, entry } of mcs) {
    const final = entry.mark;
    entry.mark = { status: 'A', exReason: null, exNote: null };
    calls.push(single(call, entry, laterDay(call, r.int(1, 3)), 1, final));
  }

  // Marked by mistake, cleared, then (mostly) marked again.
  const clears = r
    .shuffle(
      submitted.filter(
        ({ call, entry }) =>
          call.pinned &&
          entry.date >= t4.start &&
          entry.mark.status === 'P' &&
          !entry.mark.exNote &&
          laterDay(call, 2) <= TODAY
      )
    )
    .slice(0, 15);
  clears.forEach(({ call, entry }, i) => {
    const final = entry.mark;
    entry.mark = {
      status: r.chance(0.5) ? 'L' : 'A',
      exReason: null,
      exNote: null,
    };
    const cleared: Mark = { status: null, exReason: null, exNote: null };
    calls.push(single(call, entry, call.enteredOn, 2, cleared));
    if (i < 10) calls.push(single(call, entry, laterDay(call, 1), 3, final));
    else marks.set(keyOf(entry.enrolment.id, entry.date), cleared);
  });

  return calls.sort(
    (a, b) =>
      a.enteredOn.localeCompare(b.enteredOn) ||
      a.order - b.order ||
      a.sectionKey.localeCompare(b.sectionKey) ||
      a.entries[0].date.localeCompare(b.entries[0].date) ||
      a.entries[0].enrolment.studentNumber.localeCompare(
        b.entries[0].enrolment.studentNumber
      )
  );
}

/**
 * PATCH /api/attendance/daily, mirrored for one call: the marks (one insert),
 * then the route's audit rows (one insert). `done` says which of the two an
 * earlier, interrupted run already landed — the ledger is advanced either way,
 * so the next call's prior marks are right.
 */
async function routeCall(
  call: RouteCall,
  ledger: Map<string, { status: string | null; note: string | null }>,
  done: { rows: boolean; audit: boolean } = { rows: false, audit: false }
): Promise<void> {
  const sb = service();
  // The route's own validation (bulk shape, reason only on EX, note only on
  // P/L/A/EX, empty note → null).
  const parsed = DailyBulkSchema.parse({
    entries: call.entries.map((e) => ({
      sectionStudentId: e.enrolment.id,
      termId: e.termId,
      date: e.date,
      status: e.mark.status,
      exReason: e.mark.exReason,
      exNote: e.mark.exNote,
    })),
  });
  if (
    call.actor.role === 'teacher' &&
    parsed.entries.some((e) => e.status === 'NC')
  )
    throw new Error('attendance: a teacher cannot write NC (the route 403s)');

  const auditRows = parsed.entries.map((entry, i) => {
    const e = call.entries[i].enrolment;
    const key = keyOf(entry.sectionStudentId, entry.date);
    const prior = ledger.get(key)?.status ?? null;
    const nextNote = statusTakesNote(entry.status)
      ? (entry.exNote ?? null)
      : null;
    const noteChanged = nextNote !== (ledger.get(key)?.note ?? null);
    return {
      action:
        entry.date < call.enteredOn
          ? ('attendance.daily.correct' as const)
          : ('attendance.daily.update' as const),
      entityType: 'attendance_daily' as const,
      entityId: null,
      context: {
        section_student_id: entry.sectionStudentId,
        section_id: call.sectionId,
        section_name: call.sectionName,
        student_number: e.studentNumber,
        student_name: `${e.firstName} ${e.lastName}`.trim(),
        term_id: entry.termId,
        date: entry.date,
        status: entry.status,
        ...(prior !== null ? { prior_status: prior } : {}),
        ...(entry.status === 'EX' && entry.exReason
          ? { ex_reason: entry.exReason }
          : {}),
        ...(nextNote != null ? { ex_note_present: true } : {}),
        ...(noteChanged ? { ex_note_changed: true } : {}),
      },
    };
  });

  if (!done.rows)
    await writeDailyBatch(
      sb,
      parsed.entries.map((entry) => ({
        sectionStudentId: entry.sectionStudentId,
        termId: entry.termId,
        date: entry.date,
        status: entry.status,
        exReason: entry.exReason ?? null,
        exNote: entry.exNote ?? null,
        recordedBy: call.actor.id,
      }))
    );
  if (!done.audit) await logActions(sb, call.actor, auditRows);
  for (const entry of parsed.entries) {
    ledger.set(keyOf(entry.sectionStudentId, entry.date), {
      status: entry.status,
      note: statusTakesNote(entry.status) ? (entry.exNote ?? null) : null,
    });
  }
}

export async function runAttendance(): Promise<void> {
  const t0 = Date.now();
  const plan = await planRegister();
  const tPlan = Date.now();

  const imported = await writeImported(plan);
  const tImport = Date.now();

  const takers = registerTakers();
  const calls = planRouteCalls(plan, takers);
  const progress = routeProgress(calls);
  const ledger = new Map<
    string,
    { status: string | null; note: string | null }
  >();
  // Which write of each (enrolment, day) a call is: its first, second, …
  const seen = new Map<string, number>();
  let routeRows = 0;
  let callsWritten = 0;
  let callsDone = 0;
  let auditOnly = 0;
  for (const call of calls) {
    const nth = call.entries.map((e) => {
      const k = keyOf(e.enrolment.id, e.date);
      const n = seen.get(k) ?? 0;
      seen.set(k, n + 1);
      return { k, n };
    });
    // One insert per call, so its marks are all there or none are; the same
    // for its audit rows. A mix means something else wrote route-shaped rows.
    const state = (have: Map<string, number>, what: string) => {
      const landed = nth.filter(({ k, n }) => (have.get(k) ?? 0) > n).length;
      if (landed !== 0 && landed !== nth.length)
        throw new Error(
          `attendance: ${call.sectionKey} ${call.entries[0].date} (entered ${call.enteredOn}): ${landed} of ${nth.length} ${what} already written — not a state one run leaves`
        );
      return landed === nth.length;
    };
    const done = {
      rows: state(progress.rows, 'marks'),
      audit: state(progress.audits, 'audit rows'),
    };
    if (done.rows && !done.audit) auditOnly++;
    if (done.rows && done.audit) callsDone++;
    else callsWritten++;
    await routeCall(call, ledger, done);
    if (!done.rows) routeRows += call.entries.length;
  }
  const tRoute = Date.now();

  for (const ay of ATTENDANCE_AYS) invalidateDrillTags('attendance', ay);
  const secs = (a: number, b: number) => ((b - a) / 1000).toFixed(1);
  console.log(
    `  planned the register in ${secs(t0, tPlan)}s; imported ${imported} marks (writeDailyBatch per class × term, recorded_by null) in ${secs(tPlan, tImport)}s` +
      (imported
        ? ` (${Math.round(imported / ((tImport - tPlan) / 1000))} rows/s)`
        : '')
  );
  console.log(
    `  daily route (registers due to ${plan.roster.registerEnd}, the run date capped at Term 4's end): ${calls.length} submits/corrections planned (${calls.filter((c) => !c.pinned).length} run-date dependent); ${callsWritten} written now (${routeRows} marks${auditOnly ? `, ${auditOnly} calls' missing audit rows only` : ''}), ${callsDone} already done, in ${secs(tImport, tRoute)}s`
  );
}

/**
 * What the route path has already written, per (enrolment, day): its marks
 * (recorded_by one of the register takers — an approved declaration's marks
 * are recorded by its approver, never a register taker) and its audit rows
 * (no `source` — the declaration's register write tags its own).
 */
function routeProgress(calls: RouteCall[]): {
  rows: Map<string, number>;
  audits: Map<string, number>;
} {
  const ids = [...new Set(calls.map((c) => `'${c.actor.id}'`))].join(',');
  if (!ids) return { rows: new Map(), audits: new Map() };
  const count = (rows: string[][]) =>
    new Map(rows.map(([ss, date, n]) => [keyOf(ss, date), Number(n)]));
  return {
    rows: count(
      sqlRows(`select section_student_id, date::text, count(*) from attendance_daily
                where recorded_by in (${ids}) group by 1, 2`)
    ),
    audits: count(
      sqlRows(`select context->>'section_student_id', context->>'date', count(*) from audit_log
                where action in ('attendance.daily.update', 'attendance.daily.correct')
                  and context->>'source' is null and actor_id in (${ids}) group by 1, 2`)
    ),
  };
}

/**
 * The (class, day) keys whose route marks depend on the real run date — every
 * call that is not pinned (see `RouteCall.pinned`): the days after TODAY, and
 * the days taken late after TODAY. Drawn over the whole of Term 4, so the set
 * is the same whatever the run date. The verify fingerprints leave these out
 * (lib/constants.ts).
 */
export async function runDependentRegisterKeys(): Promise<Set<string>> {
  const roster = await loadRoster();
  const t3Last = t3LastDay(roster);
  const out = new Set<string>();
  for (const s of route2026Sections(roster))
    for (const { day, natural } of entryDays(roster, t3Last, s))
      if (natural > TODAY) out.add(`${s.id}|${day.date}`);
  return out;
}
