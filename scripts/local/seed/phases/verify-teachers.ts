// The Phase 2 check (teacher assignments + cover), called from `verify`.
//
// Prints per-AY / per-role counts against production's, distinct teachers,
// the per-teacher distribution, the cover rows (ended vs live) and the classes
// without an adviser; then asks the app's OWN loaders the questions Classroom
// and the cover surfaces ask:
//   * `loadEffectiveAssignmentsForUser` + `resolveClassroomScope('teacher')`
//     — every seeded teacher's Classroom scope equals the classes they hold
//     (plus, for relief@, exactly the live cover);
//   * `getCoverBoard` — the /sis/admin/cover page: the live cover is `active`,
//     the recent ended one is in `recentlyEnded`;
//   * `loadUpcomingCoverForUser` — the "You're covering" panel, which lists
//     cover NOT yet started: exactly the scheduled cover.
// Ends with a content fingerprint of teacher_assignments (two rebuilds must
// print the same one).

import { createHash } from 'node:crypto';

import {
  loadAssignmentsForUser,
  loadEffectiveAssignmentsForUser,
} from '@/lib/auth/teacher-assignments';
import { resolveClassroomScope } from '@/lib/classroom/scope';
import { sgToday } from '@/lib/dates';
import { getCoverBoard } from '@/lib/relief/cover-board';
import { loadUpcomingCoverForUser } from '@/lib/relief/upcoming';

import { runDateSg } from '../lib/constants';
import { service, sql, sqlRows } from '../lib/local';
import { STAFF, emailOf, staffId } from './staff';
import {
  TEACHERS_AY,
  coverPlan,
  isCleanWindow,
  pickCoverWindows,
  schoolDays,
} from './teachers';

const num = (q: string) => Number(sql(q).trim());

const failures: string[] = [];
function check(ok: boolean, what: string) {
  if (!ok) failures.push(what);
}

const TA_AY = `teacher_assignments ta join sections s on s.id = ta.section_id
  join academic_years a on a.id = s.academic_year_id`;

export async function verifyTeachers(): Promise<void> {
  failures.length = 0;
  const total = num('select count(*) from teacher_assignments');
  if (total === 0) {
    console.log(
      '  teachers: no assignments yet (teachers phase not run) — skipped'
    );
    return;
  }

  // ── Per AY × role ─────────────────────────────────────────────────────
  const prod: Record<string, [number, number, number]> = {
    form_adviser: [21, 21, 21],
    subject_teacher: [120, 26, 21],
    co_teacher: [4, 3, 4],
    co_adviser: [0, 0, 0],
  };
  console.log(
    '  teacher_assignments per AY x role (rows / teachers / classes; prod in brackets)'
  );
  const byRole =
    sqlRows(`select a.ay_code, ta.role, count(*), count(distinct ta.teacher_user_id),
                                 count(distinct ta.section_id)
                            from ${TA_AY} group by 1, 2 order by 1, 2`);
  for (const [ay, role, n, t, c] of byRole) {
    const p = prod[role];
    console.log(
      `    ${ay}  ${role.padEnd(16)} ${n.padStart(4)} / ${t.padStart(2)} / ${c.padStart(2)}${ay === TEACHERS_AY && p ? `   [${p.join(' / ')}]` : ''}`
    );
  }
  for (const ay of ['AY2025', 'AY2027']) {
    const n = num(`select count(*) from ${TA_AY} where a.ay_code = '${ay}'`);
    check(n === 0, `${ay} has ${n} assignments (production has none)`);
  }
  const roleCount = (r: string) =>
    num(
      `select count(*) from ${TA_AY} where a.ay_code = '${TEACHERS_AY}' and ta.role = '${r}'`
    );
  const advisers = roleCount('form_adviser');
  const subjects = roleCount('subject_teacher');
  const co = roleCount('co_teacher');
  check(advisers === 21, `form_adviser ${advisers}, want 21`);
  check(
    Math.abs(subjects - 120) <= 12,
    `subject_teacher ${subjects} not within ±10% of 120`
  );
  check(co === 4, `co_teacher ${co}, want 4`);
  check(
    roleCount('co_adviser') === 0,
    'co_adviser rows present (production has none)'
  );
  const bad = num(`select count(*) from teacher_assignments
     where (role in ('form_adviser','co_adviser') and subject_id is not null)
        or (role in ('subject_teacher','co_teacher') and subject_id is null)`);
  check(bad === 0, `${bad} rows break the role/subject shape`);

  const sectionSubjects =
    num(`select count(*) from section_subjects ss join sections s on s.id = ss.section_id
     join academic_years a on a.id = s.academic_year_id where a.ay_code = '${TEACHERS_AY}'`);
  const unstaffed = sqlRows(`select l.code || ' ' || s.name || ' · ' || sub.code
       from section_subjects ss join sections s on s.id = ss.section_id
       join levels l on l.id = s.level_id
       join academic_years a on a.id = s.academic_year_id
       join subject_configs sc on sc.id = ss.subject_config_id
       join subjects sub on sub.id = sc.subject_id
      where a.ay_code = '${TEACHERS_AY}'
        and not exists (select 1 from teacher_assignments ta where ta.section_id = s.id
                          and ta.subject_id = sc.subject_id and ta.role = 'subject_teacher')
      order by 1`).map((r) => r[0]);
  console.log(
    `  class subjects staffed: ${sectionSubjects - unstaffed.length} of ${sectionSubjects} (unstaffed: ${unstaffed.join(', ') || 'none'})`
  );

  const distinct = num(
    `select count(distinct ta.teacher_user_id) from ${TA_AY} where a.ay_code = '${TEACHERS_AY}'`
  );
  console.log(
    `  distinct teachers holding a class: ${distinct} (prod 27; relief@ holds none)`
  );
  check(
    distinct === 27,
    `distinct teachers holding a class ${distinct}, want 27`
  );

  // ── Per teacher ───────────────────────────────────────────────────────
  console.log(
    '  per teacher (advises / subject rows / distinct subjects / co rows / subjects)'
  );
  const perTeacher = sqlRows(`select u.email,
        count(*) filter (where ta.role = 'form_adviser'),
        count(*) filter (where ta.role = 'subject_teacher'),
        count(distinct ta.subject_id) filter (where ta.role = 'subject_teacher'),
        count(*) filter (where ta.role = 'co_teacher'),
        coalesce(string_agg(distinct sub.code, ',') filter (where ta.role = 'subject_teacher'), '')
      from ${TA_AY} join auth.users u on u.id = ta.teacher_user_id
      left join subjects sub on sub.id = ta.subject_id
     where a.ay_code = '${TEACHERS_AY}' group by 1 order by 1`);
  for (const [email, adv, sub, dsub, cot, codes] of perTeacher) {
    console.log(
      `    ${email.padEnd(28)} ${adv.padStart(2)}  ${sub.padStart(2)}  ${dsub.padStart(2)}  ${cot.padStart(2)}  ${codes}`
    );
  }
  const subjectLoads = perTeacher
    .map((r) => Number(r[2]))
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  // percentile_disc, as the production profile measured it.
  const pdisc = (xs: number[], p: number) =>
    xs[Math.max(0, Math.ceil(p * xs.length) - 1)];
  const p50 = pdisc(subjectLoads, 0.5);
  const p90 = pdisc(subjectLoads, 0.9);
  const distinctSubs = perTeacher
    .map((r) => Number(r[3]))
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  console.log(
    `  subject rows per teacher (${subjectLoads.length} subject teachers, prod 26): min ${subjectLoads[0]} / p50 ${p50} / p90 ${p90} / max ${subjectLoads.at(-1)} (prod 1 / 5 / 7 / 11); distinct subjects p50 ${pdisc(distinctSubs, 0.5)} max ${distinctSubs.at(-1)} (prod 2 / 4)`
  );
  check(
    subjectLoads.length === 26 &&
      subjectLoads[0] === 1 &&
      p50 === 5 &&
      p90 === 7 &&
      subjectLoads.at(-1) === 11,
    'subject rows per teacher do not match production (26 teachers, 1 / 5 / 7 / 11)'
  );
  const head = STAFF.find((s) => s.key === 'coordScience')!;
  const headSci =
    num(`select count(*) from teacher_assignments ta join subjects sub on sub.id = ta.subject_id
     where ta.teacher_user_id = '${staffId(head)}' and sub.code = 'SCI'`);
  console.log(
    `  Science subject head (${emailOf(head)}) Science classes: ${headSci}`
  );
  check(headSci > 0, 'Science subject head has no Science class');

  // ── Advisers per class ────────────────────────────────────────────────
  const noAdviser =
    sqlRows(`select a.ay_code, l.code || ' ' || s.name from sections s
       join levels l on l.id = s.level_id join academic_years a on a.id = s.academic_year_id
      where not exists (select 1 from teacher_assignments ta where ta.section_id = s.id and ta.role = 'form_adviser')
      order by 1, 2`);
  const noAdv2026 = noAdviser
    .filter((r) => r[0] === TEACHERS_AY)
    .map((r) => r[1]);
  console.log(
    `  classes without a form adviser: ${TEACHERS_AY} ${noAdv2026.length} (${noAdv2026.join(', ')}); AY2025 ${noAdviser.filter((r) => r[0] === 'AY2025').length}; AY2027 ${noAdviser.filter((r) => r[0] === 'AY2027').length}  (prod 1 / 22 / 4)`
  );
  check(
    noAdv2026.length === 1,
    `${TEACHERS_AY} classes without adviser: ${noAdv2026.length}, want 1`
  );
  const twoAdvisers =
    num(`select count(*) from (select section_id from teacher_assignments
     where role = 'form_adviser' group by 1 having count(*) > 1) x`);
  check(twoAdvisers === 0, `${twoAdvisers} classes with two form advisers`);

  // ── Cover ─────────────────────────────────────────────────────────────
  const today = sgToday();
  const covers =
    sqlRows(`select l.code || ' ' || s.name || ' · ' || coalesce(sub.code, 'form class'),
        cu.email, ru.email, ta.relief_started_on, ta.relief_ended_on,
        case when ta.relief_ended_on < '${today}' then 'ended'
             when ta.relief_started_on > '${today}' then 'scheduled' else 'live' end,
        -- Free text LAST, on one line: rejoined below, so a '|' in it cannot
        -- shift the columns before it.
        regexp_replace(coalesce(ta.relief_reason, ''), '\\s+', ' ', 'g')
      from teacher_assignments ta join sections s on s.id = ta.section_id
      join levels l on l.id = s.level_id
      left join subjects sub on sub.id = ta.subject_id
      join auth.users cu on cu.id = ta.teacher_user_id
      join auth.users ru on ru.id = ta.relief_teacher_user_id
     order by ta.relief_started_on`);
  console.log(
    '  cover rows (class / covered / substitute / window / reason / state)'
  );
  for (const [cls, covered, sub, from, to, state, ...rest] of covers) {
    const reason = rest.join('|');
    console.log(
      `    ${state.padEnd(6)} ${cls.padEnd(30)} ${covered} -> ${sub}  ${from}..${to}  ${reason || '(no reason)'}`
    );
  }
  const ended = covers.filter((c) => c[5] === 'ended').length;
  const live = covers.filter((c) => c[5] === 'live').length;
  const scheduled = covers.filter((c) => c[5] === 'scheduled').length;
  // What the plan's dates make of today: 3 / 1 / 1 on any school-term run;
  // near the year's end the scheduled one is skipped and the "live" one may
  // already be over (teachers.ts pickCoverWindows).
  const plan = coverPlan();
  const stateOf = (c: (typeof plan)[number]) =>
    c.endedOn < today ? 'ended' : c.startedOn > today ? 'scheduled' : 'live';
  const want = (s: string) => plan.filter((c) => stateOf(c) === s).length;
  console.log(
    `  cover: ${ended} ended (prod 3, all without a reason), ${live} live, ${scheduled} scheduled (live + scheduled dated from the run date ${runDateSg()}; plan wants ${want('ended')} / ${want('live')} / ${want('scheduled')})`
  );
  check(
    ended === want('ended') &&
      live === want('live') &&
      scheduled === want('scheduled'),
    `cover: ${ended} ended / ${live} live / ${scheduled} scheduled, want ${want('ended')} / ${want('live')} / ${want('scheduled')}`
  );

  // ── Cover window picker self-check ────────────────────────────────────
  // Every run date from Term 3's start to 14 days past Term 4's end: the
  // picker must never throw, and every window it gives must be clean (three
  // school days, no non-school weekday between) — the condition
  // `assertSchoolDays` enforces before a cover is booked.
  const [[t3Start, t4End]] = sqlRows(`select
      (select t.start_date from terms t join academic_years a on a.id = t.academic_year_id
        where a.ay_code = '${TEACHERS_AY}' and t.term_number = 3),
      (select t.end_date from terms t join academic_years a on a.id = t.academic_year_id
        where a.ay_code = '${TEACHERS_AY}' and t.term_number = 4)`);
  const days = schoolDays();
  const stop = new Date(`${t4End}T00:00:00Z`);
  stop.setUTCDate(stop.getUTCDate() + 14);
  let simulated = 0;
  let containsRunDate = 0;
  let skippedScheduled = 0;
  const pickerFailures: string[] = [];
  for (
    const d = new Date(`${t3Start}T00:00:00Z`);
    d <= stop;
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    const runDate = d.toISOString().slice(0, 10);
    simulated++;
    try {
      const w = pickCoverWindows(days, runDate);
      if (!isCleanWindow(days, w.live))
        pickerFailures.push(`${runDate}: live ${w.live.from}..${w.live.to}`);
      if (w.live.from <= runDate && runDate <= w.live.to) containsRunDate++;
      if (!w.scheduled) skippedScheduled++;
      else if (!isCleanWindow(days, w.scheduled))
        pickerFailures.push(
          `${runDate}: scheduled ${w.scheduled.from}..${w.scheduled.to}`
        );
    } catch (e) {
      pickerFailures.push(
        `${runDate}: threw ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }
  console.log(
    `  cover window picker: ${simulated} run dates ${t3Start}..${stop.toISOString().slice(0, 10)} simulated — ${pickerFailures.length} failures; live window contains the run date on ${containsRunDate}; scheduled skipped on ${skippedScheduled}`
  );
  check(
    pickerFailures.length === 0,
    `cover window picker: ${pickerFailures.slice(0, 5).join('; ')}`
  );
  check(
    covers
      .filter((c) => c[5] === 'ended')
      .every((c) => c.slice(6).join('|') === ''),
    'an ended cover carries a reason (production’s carry none)'
  );

  // ── The app's own loaders ─────────────────────────────────────────────
  const sb = service();
  const ayId = sqlRows(
    `select id from academic_years where ay_code = '${TEACHERS_AY}'`
  )[0][0];
  const teaching = STAFF.filter((s) => s.roles.includes('teacher'));
  let scopesOk = 0;
  for (const s of teaching) {
    const id = staffId(s);
    const effective = await loadEffectiveAssignmentsForUser(sb, id);
    const scope = resolveClassroomScope('teacher', effective);
    const held = new Set(
      (await loadAssignmentsForUser(sb, id)).map((a) => a.section_id)
    );
    const liveCover = new Set(
      effective.filter((a) => a.via === 'relief').map((a) => a.section_id)
    );
    const want = new Set([...held, ...liveCover]);
    const got = new Set(scope.sectionIds ?? []);
    const same = got.size === want.size && [...want].every((x) => got.has(x));
    if (same) scopesOk++;
    else
      failures.push(
        `classroom scope for ${emailOf(s)}: ${got.size} classes, holds/covers ${want.size}`
      );
    if (s.key !== 'relief') {
      check(held.size > 0, `${emailOf(s)} holds no class`);
    }
  }
  console.log(
    `  classroom scope (loadEffectiveAssignmentsForUser -> resolveClassroomScope): ${scopesOk}/${teaching.length} teachers see exactly the classes they hold or cover`
  );

  const relief = STAFF.find((s) => s.key === 'relief')!;
  const reliefId = staffId(relief);
  const eff = await loadEffectiveAssignmentsForUser(sb, reliefId);
  const reliefScope = resolveClassroomScope('teacher', eff);
  const liveSpec = plan.find((c) => c.state === 'live')!;
  const schedSpec = plan.find((c) => c.state === 'scheduled');
  const liveNow = stateOf(liveSpec) === 'live';
  const liveSection =
    sqlRows(`select s.id from sections s join levels l on l.id = s.level_id
     where s.academic_year_id = '${ayId}' and l.code = '${liveSpec.level}' and s.name = '${liveSpec.section}'`)[0][0];
  console.log(
    `  ${emailOf(relief)} effective: ${eff.length} row(s) — ${eff.map((a) => `${a.via} ${a.role} section ${a.section_id === liveSection ? `${liveSpec.level} ${liveSpec.section}` : a.section_id}`).join('; ') || 'none'}; capability ${JSON.stringify(reliefScope.capabilityBySection)}`
  );
  check(
    liveNow
      ? eff.length === 1 &&
          eff[0].via === 'relief' &&
          eff[0].section_id === liveSection
      : eff.length === 0,
    liveNow
      ? `${emailOf(relief)} should act on exactly the live cover`
      : `${emailOf(relief)} should act on nothing (the "live" cover is not live today)`
  );

  const board = await getCoverBoard(ayId, today);
  const fmt = (g: (typeof board.active)[number]) =>
    `${g.coveredTeacherName} -> ${g.reliefTeacherName} ${g.startedOn}..${g.endedOn} [${g.classes.map((c) => c.label).join(', ')}]${g.reason ? ` "${g.reason}"` : ''}`;
  console.log(
    `  getCoverBoard (/sis/admin/cover): active ${board.active.length}, scheduled ${board.scheduled.length}, recently ended ${board.recentlyEnded.length}`
  );
  for (const g of board.active) console.log(`    active: ${fmt(g)}`);
  for (const g of board.recentlyEnded)
    console.log(`    recently ended: ${fmt(g)}`);
  for (const g of board.scheduled) console.log(`    scheduled: ${fmt(g)}`);
  // Every live and scheduled cover is relief@'s.
  check(
    board.active.length === want('live') &&
      board.active.every((g) => g.reliefTeacherId === reliefId),
    `cover board should show ${want('live')} live cover(s) by relief@, got ${board.active.length}`
  );
  check(
    board.scheduled.length === want('scheduled') &&
      board.scheduled.every((g) => g.reliefTeacherId === reliefId),
    `cover board should show ${want('scheduled')} scheduled cover(s) by relief@, got ${board.scheduled.length}`
  );

  const upcoming = await loadUpcomingCoverForUser(sb, reliefId, ayId);
  console.log(
    `  loadUpcomingCoverForUser ("You're covering", not-yet-started only): ${upcoming.length} for ${emailOf(relief)} — ${schedSpec ? `the scheduled cover ${schedSpec.level} ${schedSpec.section} ${schedSpec.startedOn}..${schedSpec.endedOn}` : 'no scheduled cover this run'}; the live one (from ${liveSpec.startedOn}) is on the classroom scope above, not here`
  );
  check(
    upcoming.length === want('scheduled'),
    `loadUpcomingCoverForUser should list ${want('scheduled')} not-yet-started cover(s) for ${emailOf(relief)}, got ${upcoming.length}`
  );

  // ── Fingerprint ───────────────────────────────────────────────────────
  // A cover's DATES are left out when it carries a reason — only the live
  // and scheduled covers do, and those are dated from the real run date
  // (lib/constants.ts, the one exception). The ended covers' dates count.
  const fp = createHash('sha256')
    .update(
      sql(`select a.ay_code, ta.teacher_user_id, l.code, s.name, coalesce(sub.code, ''), ta.role,
                  coalesce(ta.relief_teacher_user_id::text, ''),
                  case when ta.relief_reason is null then coalesce(ta.relief_started_on::text, '') else '<run-date>' end,
                  case when ta.relief_reason is null then coalesce(ta.relief_ended_on::text, '') else '<run-date>' end,
                  coalesce(ta.relief_reason, '')
             from ${TA_AY} join levels l on l.id = s.level_id left join subjects sub on sub.id = ta.subject_id
            order by 1, 2, 3, 4, 5, 6`)
    )
    .digest('hex')
    .slice(0, 16);
  console.log(`  teachers fingerprint: ${fp}`);

  if (failures.length) {
    throw new Error(
      `teachers check failed:\n    - ${failures.join('\n    - ')}`
    );
  }
  console.log('  teachers check: PASS');
}
