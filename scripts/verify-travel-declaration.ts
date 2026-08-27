// scripts/verify-travel-declaration.ts
//
// Everything a browser pass on the TRAVEL declaration needs to know, read from
// the live database rather than guessed.
//
// STRICTLY READ-ONLY. Every statement is a SELECT. Safe to point at production.
//
// WHY THIS EXISTS. Travel is the one half of the declaration feature that has
// never been through a browser (absence was verified 2026-08-27). Handing
// somebody a date range to file for is worthless if the calendar says those
// days are closed — the filing is refused, or worse it is approved and marks
// nothing, and the pass "passes" while proving nothing. AY2026 makes that a
// live hazard: Term 3 ends 2026-09-04 and there is no Term 4 row, so after that
// date NO term owns a day and a filing expands to zero days silently.
//
// So this answers, in order:
//   1. which terms exist and which of them are dated
//   2. exactly which days can still carry a mark, per half of the school
//   3. which children are usable for the test — enrolled, advised, and with a
//      parent who actually has an account to file from
//   4. whether the two approval steps are configured and cover both halves
//   5. what travel filings already exist, and what they wrote to the register
//
// Run it again AFTER filing and approving: section 5 is the data-side proof
// that the register write landed and that the trip count reads 1 for one trip.
//
// Run:
//   npx tsx --env-file=.env.local scripts/verify-travel-declaration.ts
//
// Exit code 0 when a browser pass is possible, 1 when it is not.
import { createServiceClient } from '../lib/supabase/service';
import { expandSchoolDays } from '../lib/attendance/school-days';
import { countVacationTrips } from '../lib/attendance/vacation-trips';
import { isReliefLive } from '../lib/auth/teacher-assignments';
import { sgToday } from '../lib/dates';
import { DECLARATION_APPROVAL_FLOW } from '../lib/schemas/approval-flows';

type Service = ReturnType<typeof createServiceClient>;
type LevelType = 'primary' | 'secondary' | 'preschool' | null;
/** What the calendar's audience understands — preschool reads the 'all' rows. */
type CalendarLevel = 'primary' | 'secondary' | null;

const problems: string[] = [];
const fail = (why: string) => problems.push(why);

const heading = (text: string) =>
  console.log(`\n${'─'.repeat(72)}\n${text}\n${'─'.repeat(72)}`);

// ── 1 · the year and its terms ────────────────────────────────────────────
type Term = {
  id: string;
  termNumber: number;
  startDate: string | null;
  endDate: string | null;
};

async function loadYear(service: Service) {
  const { data: ay, error } = await service
    .from('academic_years')
    .select('id, ay_code, label')
    .eq('is_current', true)
    .maybeSingle();
  if (error) throw new Error(`academic_years lookup failed: ${error.message}`);
  if (!ay) throw new Error('No academic year is marked current.');

  const { data: termRows, error: termErr } = await service
    .from('terms')
    .select('id, term_number, start_date, end_date')
    .eq('academic_year_id', (ay as { id: string }).id)
    .order('term_number');
  if (termErr) throw new Error(`terms lookup failed: ${termErr.message}`);

  const terms: Term[] = (
    (termRows ?? []) as Array<{
      id: string;
      term_number: number;
      start_date: string | null;
      end_date: string | null;
    }>
  ).map((t) => ({
    id: t.id,
    termNumber: t.term_number,
    startDate: t.start_date,
    endDate: t.end_date,
  }));

  return { ay: ay as { id: string; ay_code: string; label: string }, terms };
}

// ── 2 · which days can still carry a mark ─────────────────────────────────
//
// ⚠ Asked of the CALENDAR, never of the poster on the wall. The AY2026 PNG in
// the repo root calls 28 Aug a marking day and 4 Sep Teacher's Day; what
// decides is what `school_calendar` holds, which is what `expandSchoolDays`
// reads. The two disagreeing is itself a finding worth seeing.
async function markableDays(
  service: Service,
  academicYearId: string,
  from: string,
  to: string,
  levelType: CalendarLevel
): Promise<string[]> {
  if (to < from) return [];
  const days = await expandSchoolDays(service, {
    startDate: from,
    endDate: to,
    academicYearId,
    levelType,
  });
  return days.map((d) => d.date);
}

// ── 3 · children usable for the test ──────────────────────────────────────
type Candidate = {
  studentNumber: string;
  studentId: string;
  sectionStudentId: string;
  name: string;
  sectionId: string;
  sectionName: string;
  levelCode: string | null;
  levelType: LevelType;
  parentEmails: string[];
  /** Parent emails that actually have an account and so can sign in and file. */
  parentEmailsWithAccount: string[];
  adviserCount: number;
};

/** Every account email, lowercased. ~500 parent rows share `auth.users`. */
async function loadAccountEmails(service: Service): Promise<Set<string>> {
  const emails = new Set<string>();
  const perPage = 1000;
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const users = data?.users ?? [];
    for (const u of users) {
      if (u.email) emails.add(u.email.trim().toLowerCase());
    }
    if (users.length < perPage) break;
  }
  return emails;
}

async function loadCandidates(
  service: Service,
  ayId: string,
  ayCode: string,
  today: string
): Promise<Candidate[]> {
  // Live enrolments in the current year, with their section and level.
  const { data: enrolments, error } = await service
    .from('section_students')
    .select(
      'id, student_id, section_id, enrollment_status, students!inner(id, student_number, first_name, last_name), sections!inner(id, name, academic_year_id, levels(code, level_type))'
    )
    .neq('enrollment_status', 'withdrawn')
    .eq('sections.academic_year_id', ayId);
  if (error)
    throw new Error(`section_students lookup failed: ${error.message}`);

  type Row = {
    id: string;
    student_id: string;
    section_id: string;
    students: {
      id: string;
      student_number: string | null;
      first_name: string | null;
      last_name: string | null;
    };
    sections: {
      id: string;
      name: string | null;
      levels:
        | { code: string; level_type: string }
        | { code: string; level_type: string }[]
        | null;
    };
  };
  const rows = (enrolments ?? []) as unknown as Row[];
  if (rows.length === 0) return [];

  // Which sections actually have somebody who can decide step 1.
  //
  // ⚠ Adviser of record OR co-adviser OR a relief teacher inside their window
  // — the same set `is_section_adviser` resolves, because step 1 is a DERIVED
  // pool that resolves live (KD #196). A section with nobody would stall the
  // filing at the first step and prove nothing.
  const { data: assignments, error: aErr } = await service
    .from('teacher_assignments')
    .select(
      'section_id, role, teacher_user_id, relief_teacher_user_id, relief_started_on, relief_ended_on'
    )
    .in('role', ['form_adviser', 'co_adviser']);
  if (aErr)
    throw new Error(`teacher_assignments lookup failed: ${aErr.message}`);

  const adviserCounts = new Map<string, number>();
  for (const a of (assignments ?? []) as Array<{
    section_id: string;
    teacher_user_id: string | null;
    relief_teacher_user_id: string | null;
    relief_started_on: string | null;
    relief_ended_on: string | null;
  }>) {
    let holders = a.teacher_user_id ? 1 : 0;
    // ⚠ The shared predicate, never a fourth copy of the window. KD #191: the
    // rule is deliberately written twice (SQL + TS) and pinned by a parity
    // test; a script inlining its own comparison is exactly the drift
    // migration 115 was paid for.
    const reliefLive =
      a.relief_teacher_user_id != null &&
      isReliefLive(a.relief_started_on, a.relief_ended_on, today);
    if (reliefLive) holders += 1;
    adviserCounts.set(
      a.section_id,
      (adviserCounts.get(a.section_id) ?? 0) + holders
    );
  }

  // Parent emails, from the AY-prefixed admissions table.
  const numbers = rows
    .map((r) => r.students?.student_number)
    .filter((n): n is string => !!n);
  const year = ayCode.replace(/^AY/i, '').toLowerCase();
  const { data: apps, error: appErr } = await service
    .from(`ay${year}_enrolment_applications`)
    .select('studentNumber, motherEmail, fatherEmail')
    .in('studentNumber', numbers);
  if (appErr) {
    throw new Error(
      `ay${year}_enrolment_applications read failed: ${appErr.message}`
    );
  }
  const emailsByNumber = new Map<string, string[]>();
  for (const a of (apps ?? []) as Array<{
    studentNumber: string | null;
    motherEmail: string | null;
    fatherEmail: string | null;
  }>) {
    if (!a.studentNumber) continue;
    const list: string[] = [];
    for (const raw of [a.motherEmail, a.fatherEmail]) {
      const norm = raw?.trim().toLowerCase();
      if (norm && norm.includes('@')) list.push(norm);
    }
    emailsByNumber.set(a.studentNumber, [...new Set(list)]);
  }

  const accountEmails = await loadAccountEmails(service);

  const out: Candidate[] = [];
  for (const r of rows) {
    const number = r.students?.student_number;
    if (!number) continue;
    const levels = Array.isArray(r.sections?.levels)
      ? r.sections.levels[0]
      : r.sections?.levels;
    const parentEmails = emailsByNumber.get(number) ?? [];
    out.push({
      studentNumber: number,
      studentId: r.students.id,
      sectionStudentId: r.id,
      name: `${r.students.first_name ?? ''} ${r.students.last_name ?? ''}`.trim(),
      sectionId: r.section_id,
      sectionName: r.sections?.name ?? '(unnamed)',
      levelCode: levels?.code ?? null,
      levelType: (levels?.level_type as LevelType) ?? null,
      parentEmails,
      parentEmailsWithAccount: parentEmails.filter((e) => accountEmails.has(e)),
      adviserCount: adviserCounts.get(r.section_id) ?? 0,
    });
  }
  return out;
}

// ── 5 · trips, computed the way the register defines them ─────────────────
//
// A trip is a run of vacation-marked SCHOOL days with no ordinary school day
// interrupting it (KD #199). Reported here from the raw marks so the figure on
// the student card can be checked against its own source.
async function vacationDatesInTerm(
  service: Service,
  sectionStudentIds: string[],
  termId: string
): Promise<string[]> {
  if (sectionStudentIds.length === 0) return [];
  const { data, error } = await service
    .from('attendance_daily')
    .select(
      'section_student_id, date, period_id, status, ex_reason, recorded_at'
    )
    .in('section_student_id', sectionStudentIds)
    .eq('term_id', termId)
    .order('recorded_at', { ascending: true });
  if (error) throw new Error(`attendance_daily read failed: ${error.message}`);

  // Append-only ledger: the LAST row for a (student, date, period) is the mark.
  const latest = new Map<string, { status: string; exReason: string | null }>();
  for (const row of (data ?? []) as Array<{
    section_student_id: string;
    date: string;
    period_id: string | null;
    status: string;
    ex_reason: string | null;
  }>) {
    latest.set(`${row.section_student_id}|${row.date}|${row.period_id ?? ''}`, {
      status: row.status,
      exReason: row.ex_reason,
    });
  }

  const dates = new Set<string>();
  for (const [key, mark] of latest) {
    if (mark.status === 'EX' && mark.exReason === 'vacation') {
      dates.add(key.split('|')[1]);
    }
  }
  return [...dates].sort();
}

async function main() {
  const service = createServiceClient();
  const today = sgToday();
  console.log(`Today (Singapore): ${today}`);

  // ── 1 ───────────────────────────────────────────────────────────────────
  const { ay, terms } = await loadYear(service);
  heading(`1 · ${ay.ay_code} — ${ay.label}`);

  for (const t of terms) {
    const window =
      t.startDate && t.endDate ? `${t.startDate} → ${t.endDate}` : 'NO DATES';
    console.log(`  Term ${t.termNumber}  ${window}`);
  }
  const missing = [1, 2, 3, 4].filter(
    (n) => !terms.some((t) => t.termNumber === n)
  );
  if (missing.length > 0) {
    console.log(
      `\n  🔴 No row at all for term ${missing.join(', ')}. Attendance cannot be`
    );
    console.log(
      `     marked on any date those terms would have owned, and a parent's`
    );
    console.log(`     filing for such a date expands to ZERO days, silently.`);
  }
  const undated = terms.filter((t) => !t.startDate || !t.endDate);
  if (undated.length > 0) {
    console.log(
      `  ⚠ Term ${undated.map((t) => t.termNumber).join(', ')} has a row but no dates,` +
        ` which every reader filters out.`
    );
  }

  const dated = terms.filter(
    (t): t is Term & { startDate: string; endDate: string } =>
      !!t.startDate && !!t.endDate
  );
  if (dated.length === 0) {
    fail('No dated term in the current year — nothing can be marked at all.');
  }
  const lastEnd =
    dated
      .map((t) => t.endDate)
      .sort()
      .at(-1) ?? today;

  // ── 2 ───────────────────────────────────────────────────────────────────
  heading('2 · Days that can still carry a mark');
  console.log(
    `  Window examined: ${today} → ${lastEnd} (end of the last dated term)`
  );

  const byHalf: Record<'primary' | 'secondary', string[]> = {
    primary: await markableDays(service, ay.id, today, lastEnd, 'primary'),
    secondary: await markableDays(service, ay.id, today, lastEnd, 'secondary'),
  };

  for (const half of ['primary', 'secondary'] as const) {
    const days = byHalf[half];
    console.log(`\n  ${half.toUpperCase()} — ${days.length} day(s)`);
    if (days.length === 0) {
      console.log(
        '    (none — a filing here would be refused as "school closed")'
      );
    } else {
      console.log(`    ${days.join(', ')}`);
    }
  }

  // ⚠ WHY each day is closed, not just that it is. A missing calendar row in a
  // configured term reads as an implicit holiday (`decideNonSchoolDay`), which
  // is indistinguishable on every screen from a day the school deliberately
  // shut. If a normal Monday is closed here, the calendar is wrong — and that
  // is a finding about the school's data, not about this feature.
  const { data: calRows } = await service
    .from('school_calendar')
    .select('date, day_type, audience, hbl_overlay, term_id')
    .gte('date', today)
    .lte('date', lastEnd);
  const calByDate = new Map<string, string[]>();
  for (const r of (calRows ?? []) as Array<{
    date: string;
    day_type: string;
    audience: string;
    hbl_overlay: boolean | null;
  }>) {
    const bucket = calByDate.get(r.date) ?? [];
    bucket.push(`${r.audience}:${r.day_type}${r.hbl_overlay ? '+hbl' : ''}`);
    calByDate.set(r.date, bucket);
  }

  console.log('\n  Every date in the window, and what the calendar says:');
  const cursor = new Date(`${today}T00:00:00Z`);
  const stop = new Date(`${lastEnd}T00:00:00Z`);
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let unexplained = 0;
  while (cursor <= stop) {
    const date = cursor.toISOString().slice(0, 10);
    const dow = cursor.getUTCDay();
    const open =
      byHalf.primary.includes(date) || byHalf.secondary.includes(date);
    const rows = calByDate.get(date);
    const says = rows ? rows.join(', ') : 'NO ROW';
    const isWeekend = dow === 0 || dow === 6;
    let flag = '';
    if (!open && !isWeekend && !rows) {
      flag = '  ← 🔴 a weekday with no calendar row = silently treated as shut';
      unexplained += 1;
    }
    console.log(
      `    ${date} ${weekday[dow]}  ${open ? 'OPEN  ' : 'closed'}  ${says}${flag}`
    );
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  if (unexplained > 0) {
    console.log(
      `\n  🔴 ${unexplained} weekday(s) are shut only because nobody wrote a calendar` +
        `\n     row for them. Attendance cannot be marked on those days and no screen` +
        `\n     says why. Seed the calendar for this term before reading anything else here.`
    );
  }

  if (byHalf.primary.length === 0 && byHalf.secondary.length === 0) {
    fail(
      'No markable school day remains in the year, so a travel filing cannot be ' +
        'proved end to end. Fix the term dates before the browser pass.'
    );
  }

  // A range worth suggesting: a run that spans a weekend proves the skip.
  for (const half of ['primary', 'secondary'] as const) {
    const days = byHalf[half];
    if (days.length >= 2) {
      console.log(
        `\n  Suggested ${half} range: ${days[0]} → ${days[days.length - 1]}` +
          ` (${days.length} school days inside it)`
      );
    }
  }

  // ── 3 ───────────────────────────────────────────────────────────────────
  heading('3 · Children usable for the test');
  const candidates = await loadCandidates(service, ay.id, ay.ay_code, today);

  const usable = candidates.filter(
    (c) => c.adviserCount > 0 && c.parentEmailsWithAccount.length > 0
  );

  for (const half of ['primary', 'secondary'] as const) {
    const forHalf = usable.filter((c) => c.levelType === half);
    console.log(
      `\n  ${half.toUpperCase()} — ${forHalf.length} child(ren) with both an adviser and a parent account`
    );
    for (const c of forHalf.slice(0, 3)) {
      console.log(
        `    ${c.studentNumber}  ${c.name}  ·  ${c.levelCode ?? '?'} ${c.sectionName}` +
          `  ·  parent: ${c.parentEmailsWithAccount.join(', ')}`
      );
    }
    if (forHalf.length === 0) {
      fail(
        `No ${half} child has both a live adviser and a parent with an account — ` +
          `a filing would either stall at step 1 or have nobody able to send it.`
      );
    }
  }

  const noAccount = candidates.filter(
    (c) => c.parentEmails.length > 0 && c.parentEmailsWithAccount.length === 0
  ).length;
  const noAdviser = candidates.filter((c) => c.adviserCount === 0).length;
  console.log(
    `\n  Of ${candidates.length} enrolled children: ${noAdviser} sit in a section with no` +
      ` live adviser, ${noAccount} have a parent email on the application but no account.`
  );

  // ── 4 ───────────────────────────────────────────────────────────────────
  heading('4 · The approval steps');
  const { data: stages, error: stageErr } = await service
    .from('approval_stages')
    .select('id, stage_order, label, resolver')
    .eq('flow', DECLARATION_APPROVAL_FLOW)
    .eq('is_active', true)
    .order('stage_order');
  if (stageErr)
    throw new Error(`approval_stages read failed: ${stageErr.message}`);

  const stageRows = (stages ?? []) as Array<{
    id: string;
    stage_order: number;
    label: string;
    resolver: string;
  }>;
  if (stageRows.length === 0) {
    fail('The declaration flow has no steps configured at all.');
  }

  const { data: approvers, error: apprErr } = await service
    .from('approval_stage_approvers')
    .select('stage_id, user_id, applies_to_level_type')
    .in(
      'stage_id',
      stageRows.map((s) => s.id)
    );
  if (apprErr) {
    throw new Error(`approval_stage_approvers read failed: ${apprErr.message}`);
  }
  const approverRows = (approvers ?? []) as Array<{
    stage_id: string;
    user_id: string;
    applies_to_level_type: string | null;
  }>;

  for (const s of stageRows) {
    const mine = approverRows.filter((a) => a.stage_id === s.id);
    if (s.resolver !== 'named') {
      console.log(
        `  ${s.stage_order}. ${s.label}  ·  derived (${s.resolver}) — resolves live, nobody to name`
      );
      continue;
    }
    console.log(
      `  ${s.stage_order}. ${s.label}  ·  named, ${mine.length} approver(s)`
    );
    for (const half of ['primary', 'secondary'] as const) {
      const covering = mine.filter(
        (a) =>
          a.applies_to_level_type == null || a.applies_to_level_type === half
      );
      // Name them. "1 approver" is not enough to act on — a browser pass needs
      // to know WHICH account has to sign in, and there are two Ms Elaines.
      const who: string[] = [];
      for (const a of covering) {
        const { data } = await service.auth.admin.getUserById(a.user_id);
        who.push(data?.user?.email ?? a.user_id);
      }
      const mark = covering.length > 0 ? '✓' : '🔴';
      console.log(
        `       ${mark} ${half}: ${covering.length} approver(s)` +
          (who.length > 0 ? ` — ${who.join(', ')}` : '') +
          (covering.length === 0
            ? ' — a filing from this half STALLS here'
            : '')
      );
      if (covering.length === 0) {
        fail(`Step ${s.stage_order} covers nobody for ${half}.`);
      }
    }
  }

  // ── 5 ───────────────────────────────────────────────────────────────────
  heading('5 · Travel filings already on record');
  const { data: filings, error: filErr } = await service
    .from('student_declarations')
    .select(
      'id, student_id, section_student_id, section_id, academic_year_id, start_date, end_date, status, destination_country, destination_city, register_written_at, register_days_written, register_write_error, filed_by_email, created_at, students(student_number, first_name, last_name), sections(name)'
    )
    .eq('declaration_type', 'travel')
    .order('created_at', { ascending: false })
    .limit(10);
  if (filErr) {
    throw new Error(`student_declarations read failed: ${filErr.message}`);
  }

  // `as unknown as` because PostgREST types an embedded row as an array; these
  // two are to-one joins and arrive as objects.
  const travelRows = (filings ?? []) as unknown as Array<{
    id: string;
    student_id: string;
    section_student_id: string;
    section_id: string;
    academic_year_id: string;
    start_date: string;
    end_date: string;
    status: string;
    destination_country: string | null;
    destination_city: string | null;
    register_written_at: string | null;
    register_days_written: number | null;
    register_write_error: string | null;
    filed_by_email: string;
    students: {
      student_number: string | null;
      first_name: string | null;
      last_name: string | null;
    } | null;
    sections: { name: string | null } | null;
  }>;

  if (travelRows.length === 0) {
    console.log(
      '  None yet. That is expected before the browser pass — run this again after.'
    );
  }

  for (const f of travelRows) {
    const child = f.students
      ? `${f.students.student_number ?? '?'} ${f.students.first_name ?? ''} ${f.students.last_name ?? ''}`.trim()
      : '(unknown student)';
    console.log(
      `\n  ${f.start_date} → ${f.end_date}  ·  ${f.status}  ·  ` +
        `${[f.destination_city, f.destination_country].filter(Boolean).join(', ')}`
    );
    console.log(`    ${child}  ·  ${f.sections?.name ?? '?'}`);
    console.log(`    filed by ${f.filed_by_email}`);

    if (f.status === 'approved') {
      if (f.register_write_error) {
        console.log(`    🔴 register write FAILED: ${f.register_write_error}`);
        fail(`Travel filing ${f.id} approved but its register write failed.`);
      } else if (!f.register_written_at) {
        console.log(
          '    🔴 approved but the register was never written (no stamp).'
        );
        fail(`Travel filing ${f.id} approved with no register stamp.`);
      } else if ((f.register_days_written ?? 0) === 0) {
        // ⚠ NOT a pass. The write ran and skipped every day, because the range
        // held no school day. That is correct behaviour (KD #197 skips closed
        // days silently) and it means this filing proves NOTHING about travel:
        // no `EX`/vacation row exists, so nothing marked the register, nothing
        // counted a trip, and no screen changed.
        console.log(
          `    ⚠ register written ${f.register_written_at} but 0 days marked —` +
            ` every date in the range was a closure. This filing proves nothing.`
        );
      } else {
        console.log(
          `    ✓ register written ${f.register_written_at} — ` +
            `${f.register_days_written} day(s) marked`
        );
      }

      // The trip count, from the marks themselves.
      const term = dated.find(
        (t) => t.startDate <= f.start_date && t.endDate >= f.start_date
      );
      if (!term) {
        console.log(
          '    ⚠ the start date falls in no dated term, so no term owns this trip.'
        );
      } else {
        const { data: enrolRows } = await service
          .from('section_students')
          .select('id, sections!inner(academic_year_id)')
          .eq('student_id', f.student_id)
          .eq('sections.academic_year_id', f.academic_year_id);
        const ssIds = ((enrolRows ?? []) as Array<{ id: string }>).map(
          (r) => r.id
        );

        const vacationDates = await vacationDatesInTerm(
          service,
          ssIds,
          term.id
        );
        const { data: sectionRow } = await service
          .from('sections')
          .select('levels(level_type)')
          .eq('id', f.section_id)
          .maybeSingle();
        const lv = (
          sectionRow as { levels?: { level_type?: string } | null } | null
        )?.levels;
        const rawType = Array.isArray(lv)
          ? (lv[0] as { level_type?: string })?.level_type
          : lv?.level_type;
        const calendarLevel: CalendarLevel =
          rawType === 'primary' || rawType === 'secondary' ? rawType : null;

        const termDays = await markableDays(
          service,
          f.academic_year_id,
          term.startDate,
          term.endDate,
          calendarLevel
        );
        // `startedBeforeTerm` is false here on purpose: this probe reports what
        // THIS term's marks say. A trip carried in from the previous term is
        // counted in the term it started in (KD #199) and the student card is
        // the authority on that case.
        const trips = countVacationTrips(
          termDays,
          new Set(vacationDates),
          false
        );
        console.log(
          `    Term ${term.termNumber}: ${vacationDates.length} vacation day(s) ` +
            `= ${trips} trip(s)`
        );
        if (vacationDates.length > 0) {
          console.log(`      ${vacationDates.join(', ')}`);
        }
      }
    }
  }

  // ── verdict ─────────────────────────────────────────────────────────────
  heading('Verdict');
  if (problems.length === 0) {
    console.log(
      '  ✓ A travel browser pass is possible. Use a range from section 2.'
    );
    process.exit(0);
  }
  for (const p of problems) console.log(`  🔴 ${p}`);
  console.log(
    `\n  ${problems.length} blocker(s). Fix these before spending a browser pass.`
  );
  process.exit(1);
}

main().catch((e) => {
  console.error('\nProbe failed to run:', e instanceof Error ? e.message : e);
  process.exit(1);
});
