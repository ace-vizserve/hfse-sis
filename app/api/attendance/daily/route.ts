import { NextResponse, type NextRequest } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { loadEffectiveAssignmentsForUser } from '@/lib/auth/teacher-assignments';
import { isAdviserRole } from '@/lib/schemas/teacher-assignment';
import { logActions } from '@/lib/audit/log-action';
import { createServiceClient } from '@/lib/supabase/service';
import { sgToday } from '@/lib/dates';
import {
  writeDailyBatch,
  type RollupAfterWrite,
} from '@/lib/attendance/mutations';
import { createNonSchoolDayChecker } from '@/lib/attendance/school-days';
import { levelTypeForAudienceLookup } from '@/lib/sis/levels';
import {
  DailyBulkSchema,
  DailyEntrySchema,
  type DailyEntryInput,
} from '@/lib/schemas/attendance';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { requireCurrentAyCode } from '@/lib/academic-year';
import { fetchAllPages, fetchInChunks } from '@/lib/supabase/paginate';

// PATCH /api/attendance/daily
//
// Body: { sectionStudentId, termId, date, status }
// OR   : { entries: [...] } (bulk paste from the grid)
//
// Writes one `attendance_daily` row per entry (append-only — corrections
// supersede by recorded_at desc) and recomputes the `attendance_records`
// rollup for each affected (term × section_student) pair.
//
// A `null` status CLEARS the day (migration 134) — it returns the cell to
// unmarked rather than writing a sixth kind of mark. It is appended to the
// ledger like any other correction, so the prior mark survives and the audit
// row still records what was undone.
//
// Access:
// - Teachers: write only sections they form-advise (via teacher_assignments)
// - Registrar / school_admin / admin / superadmin: write any section
// - `NC` status is reserved for registrar+; teachers writing `NC` get 403
//
// Audit: logs `attendance.daily.update` for today/future dates,
// `attendance.daily.correct` for past dates.

/**
 * The teacher section gate, over enrolments the CALLER has already resolved.
 *
 * It used to run its own `section_students` read, identical to the one the
 * level-type/audit block ran a few lines later — same table, same columns, same
 * ids, differing only in that this one did not dedupe, which `.in()` does not
 * care about. The read is hoisted; the gate now receives its result.
 *
 * ⚠ IT STILL FAILS CLOSED, AND THAT IS WHY THE ERROR IS PASSED IN RATHER THAN
 * SWALLOWED BY THE CALLER. A lookup that fails must refuse, and an empty result
 * must refuse — "no section ids came back" is not "no section to object to".
 * Both are asserted in __tests__/attendance/daily-enrolment-read-gate.test.ts,
 * which was run green on all four refusal cases BEFORE the read was hoisted.
 */
function assertAdviserForSections(
  assignments: Array<{ section_id: string; role: string }>,
  enrolment: {
    error: string | null;
    sectionIdByEnrolment: Map<string, string>;
  },
  sectionStudentIds: string[]
): { ok: true } | { ok: false; reason: string } {
  if (sectionStudentIds.length === 0) return { ok: true };

  if (enrolment.error) {
    return { ok: false, reason: `enrolment lookup failed: ${enrolment.error}` };
  }
  const sectionIds = Array.from(
    new Set(enrolment.sectionIdByEnrolment.values())
  );
  if (sectionIds.length === 0) {
    return { ok: false, reason: 'unknown section_student_id(s)' };
  }

  const advisedSectionIds = new Set(
    assignments
      // isAdviserRole, not the literal: migration 124's `is_adviser_for_section`
      // admits a co-adviser, so comparing the literal here would refuse a
      // co-adviser the register the database already lets them write.
      .filter((a) => isAdviserRole(a.role))
      .map((a) => a.section_id)
  );
  const uncovered = sectionIds.filter((s) => !advisedSectionIds.has(s));
  if (uncovered.length > 0) {
    return {
      ok: false,
      reason: `not form adviser for section(s): ${uncovered.join(', ')}`,
    };
  }
  return { ok: true };
}

export async function PATCH(request: NextRequest) {
  const auth = await requireRole([
    'teacher',
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  // Accept single OR bulk. Normalise to an array.
  let entries: DailyEntryInput[];
  if ('entries' in body) {
    const parsed = DailyBulkSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'invalid payload', details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    entries = parsed.data.entries;
  } else {
    const parsed = DailyEntrySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'invalid payload', details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    entries = [parsed.data];
  }

  // Teachers can't write `NC` — only registrar+ marks holidays / not-yet-enrolled.
  //
  // ⚠ UNCHANGED BY MIGRATION 134, deliberately. A cleared entry carries
  // `status: null`, which is not `'NC'`, so it passes this gate — and it
  // should: clearing removes a mark, it never writes the one this reserves.
  // A teacher clearing a day a registrar marked `NC` is undoing their own
  // reach into that cell, not claiming it.
  if (auth.role === 'teacher' && entries.some((e) => e.status === 'NC')) {
    return NextResponse.json(
      { error: 'teachers cannot write NC status; registrar only' },
      { status: 403 }
    );
  }

  const service = createServiceClient();

  // ONE `section_students` READ FOR THE WHOLE REQUEST. It resolves two things
  // that used to fetch it separately: the teacher gate below, and the
  // section-name / level-type maps the audit context and the day-type lookup
  // need. Both asked for the same columns over the same ids.
  //
  // ⚠ THE ERROR IS CARRIED, NOT DISCARDED — the gate has to be able to refuse
  // on a failed lookup. For non-teachers the behaviour is unchanged: a failed
  // read leaves the maps empty and the request proceeds exactly as it did when
  // this query ignored its own error.
  const studentIds = Array.from(
    new Set(entries.map((e) => e.sectionStudentId))
  );
  const { data: enrolmentRows, error: enrolmentErr } = await service
    .from('section_students')
    .select('id, section_id')
    .in('id', studentIds);
  const sectionIdByEnrolment = new Map<string, string>(
    ((enrolmentRows ?? []) as Array<{ id: string; section_id: string }>).map(
      (r) => [r.id, r.section_id]
    )
  );

  // Teacher section gate — ALL touched sections must be ones they form-advise.
  if (auth.role === 'teacher') {
    // Held OR covered. Taking the register is precisely the work a substitute
    // is brought in for, so a class they are covering must pass this gate —
    // while the regular adviser stays the name of record on the section
    // everywhere it is displayed.
    let assignments;
    try {
      assignments = await loadEffectiveAssignmentsForUser(
        service,
        auth.user.id
      );
    } catch (err) {
      return NextResponse.json(
        {
          error: `teacher_assignments lookup failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        },
        { status: 403 }
      );
    }
    const check = assertAdviserForSections(
      assignments,
      {
        error: enrolmentErr?.message ?? null,
        sectionIdByEnrolment,
      },
      entries.map((e) => e.sectionStudentId)
    );
    if (!check.ok) {
      return NextResponse.json({ error: check.reason }, { status: 403 });
    }
  }

  const today = sgToday();
  const results: Array<{
    sectionStudentId: string;
    termId: string;
    date: string;
    // `null` = the day was CLEARED. Echoed back exactly as it was written so
    // the grid's optimistic cell and the server agree on "unmarked".
    status: string | null;
    rollup: RollupAfterWrite;
  }> = [];

  // Each entry's section level type, so the day-type lookup can pick the right
  // audience scope (KD #50 audience-precedence rule, migration 037). Two-step
  // resolution — flatter than a nested join, and avoids the Supabase-typed
  // array-vs-object ambiguity on `!inner` joins. The first step is the single
  // enrolment read above; only the sections read remains here.
  const sectionIds = Array.from(new Set(sectionIdByEnrolment.values()));
  // `name` rides along for the audit context, and `academic_years(ay_code)`
  // for the cache invalidation at the end of this handler — this query is
  // already being made for the day-type lookup, so both cost no extra round
  // trip. The AY code used to come from `requireCurrentAyCode(service)`, a
  // separate read paid on EVERY PATCH, and the grid PATCHes one cell at a time.
  const { data: sectionRows } = sectionIds.length
    ? await service
        .from('sections')
        .select('id, name, levels(code), academic_years(ay_code)')
        .in('id', sectionIds)
    : { data: [] };
  // `sections.levels` is typed as `{ code: string } | { code: string }[] | null`
  // depending on Supabase's join inference; normalise to a single code. Same
  // for `academic_years`.
  type RawSectionRow = {
    id: string;
    name: string;
    levels: { code: string } | { code: string }[] | null;
    academic_years: { ay_code: string } | { ay_code: string }[] | null;
  };
  const levelCodeBySection = new Map<string, string | null>();
  const sectionNameById = new Map<string, string>();
  // Every academic year this submit actually touched. Normally one — a submit
  // covers one class — but the schema does not forbid a bulk PATCH spanning
  // sections, so this is a set rather than a single value.
  const ayCodesTouched = new Set<string>();
  for (const row of (sectionRows ?? []) as RawSectionRow[]) {
    const lvl = Array.isArray(row.levels) ? row.levels[0] : row.levels;
    levelCodeBySection.set(row.id, lvl?.code ?? null);
    sectionNameById.set(row.id, row.name);
    const ay = Array.isArray(row.academic_years)
      ? row.academic_years[0]
      : row.academic_years;
    if (ay?.ay_code) ayCodesTouched.add(ay.ay_code);
  }

  // Prior status per (enrolment, date), for the before -> after rendering in
  // lib/audit/humanize.ts. One batched read for the whole request rather than
  // one per entry.
  //
  // attendance_daily is an append-only ledger superseded by `recorded_at desc`
  // (migration 014), so the first row seen per key in that order IS the
  // current mark — the same single-pass rule lib/attendance/queries.ts uses.
  // The secondary sort on `id` gives a total order, without which `.range()`
  // paging could show a row twice or skip it.
  //
  // Chunked because DailyBulkSchema caps a submit at 500 entries and
  // section_student_id is a uuid — past the ~396-uuid URL ceiling documented
  // in lib/supabase/paginate.ts. A truncated read here would hand the audit
  // trail a WRONG prior status, which is worse than an absent one.
  const submittedDates = Array.from(new Set(entries.map((e) => e.date)));
  const priorRows = await fetchInChunks(studentIds, (slice) =>
    fetchAllPages<{
      section_student_id: string;
      date: string;
      // Nullable since migration 134 — a cleared day is a real ledger row.
      status: string | null;
    }>((from, to) =>
      service
        .from('attendance_daily')
        .select('section_student_id, date, status, recorded_at')
        .in('section_student_id', slice)
        .in('date', submittedDates)
        .order('recorded_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to)
    )
  );
  // ⚠ A CLEARED ROW IS RECORDED HERE TOO, as `null`. It is the newest row and
  // therefore IS the current mark, so skipping it would let the older mark
  // underneath read as current — the audit trail would then claim a day was
  // changed "from Absent" when it had already been blanked. The audit block
  // below is what decides not to render a null prior; this map's job is only
  // to answer "what was on the day", and "nothing" is an answer.
  const priorStatusByKey = new Map<string, string | null>();
  for (const row of priorRows) {
    const key = `${row.section_student_id}|${row.date}`;
    if (!priorStatusByKey.has(key)) priorStatusByKey.set(key, row.status);
  }
  const levelTypeByEnrolment = new Map<
    string,
    'primary' | 'secondary' | null
  >();
  for (const [enrolmentId, sectionId] of sectionIdByEnrolment) {
    const code = levelCodeBySection.get(sectionId) ?? null;
    levelTypeByEnrolment.set(enrolmentId, levelTypeForAudienceLookup(code));
  }

  // Write-gate: encodable when day_type IN ('school_day','hbl'); blocked
  // otherwise; a term with NO calendar rows blocks nothing (legacy mode, same
  // behaviour as pre-migration-019).
  //
  // The rule used to be a closure right here. It now lives in
  // `lib/attendance/school-days.ts` because the approved absence declaration
  // has to ask the same question of a date RANGE, and two copies of a calendar
  // rule is how the register and the sheet start disagreeing. Behaviour here
  // is unchanged — the checker caches per (term, date, level) exactly as this
  // did.
  const isNonSchoolDay = createNonSchoolDayChecker(service);

  // ── Validate EVERY entry before writing ANY of them ──────────────────────
  // This loop used to validate and write one entry at a time, so a rejection
  // partway through left the earlier students marked and reported how many had
  // got through (`writtenSoFar`). Checking first makes the request all-or-
  // nothing, which is both faster and easier to reason about: a submit either
  // happened or it did not.
  for (const entry of entries) {
    // Write-gate: encodable day_types are school_day + hbl. Others reject
    // unless registrar+ is writing NC (the legitimate way to mark "no class"
    // on a pre-calendar date or back-fill a closure).
    const levelType = levelTypeByEnrolment.get(entry.sectionStudentId) ?? null;
    const blocked = await isNonSchoolDay(entry.termId, entry.date, levelType);
    // ⚠ A CLEAR (status null) IS ALWAYS LET THROUGH, whatever the calendar
    // says. This gate exists to stop a mark being PUT on a day the school was
    // shut; clearing only ever takes one away, so refusing it protects
    // nothing. And the case is real rather than theoretical: a day is marked
    // while the calendar still calls it a school day, the registrar then
    // corrects the calendar, and the mark left behind is now unreachable —
    // blocked from being changed and blocked from being removed. The 409
    // would strand exactly the rows somebody is trying to clean up.
    if (blocked && entry.status !== 'NC' && entry.status !== null) {
      return NextResponse.json(
        {
          error: `${entry.date} isn't a school day (it's marked as a public holiday, school holiday, or no class). Update the school calendar if this is wrong.`,
          // Always zero now — nothing is written until every entry has passed.
          // Kept in the shape so existing clients reading it stay valid.
          writtenSoFar: 0,
        },
        { status: 409 }
      );
    }
  }

  // ── Write ────────────────────────────────────────────────────────────────
  let rollups: Map<string, RollupAfterWrite>;
  try {
    rollups = await writeDailyBatch(
      service,
      entries.map((entry) => ({
        sectionStudentId: entry.sectionStudentId,
        termId: entry.termId,
        date: entry.date,
        status: entry.status,
        exReason: entry.exReason ?? null,
        exNote: entry.exNote ?? null,
        recordedBy: auth.user.id,
      }))
    );
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: reason, writtenSoFar: 0 },
      { status: 500 }
    );
  }

  for (const entry of entries) {
    results.push({
      sectionStudentId: entry.sectionStudentId,
      termId: entry.termId,
      date: entry.date,
      status: entry.status,
      rollup: rollups.get(`${entry.termId}|${entry.sectionStudentId}`)!,
    });
  }

  // ── Audit ────────────────────────────────────────────────────────────────
  // Written in ONE parallel wave instead of one awaited INSERT per student.
  //
  // Deliberately still awaited, and deliberately NOT moved into `after()`.
  // `after()` was tried and reverted: an audit row is a compliance record, and
  // if post-response work is ever dropped the trail gains a hole that nothing
  // reports — the same "a failure that reads as good news" shape this codebase
  // already guards against elsewhere. Parallelising takes 30 sequential
  // round-trips down to roughly one, which is nearly all of the win at none of
  // that risk.
  const auditRows = entries.map((entry) => {
    const priorKey = `${entry.sectionStudentId}|${entry.date}`;
    // `undefined` = no ledger row at all; `null` = the day was already
    // cleared. Neither is a transition worth rendering, and only a real prior
    // mark goes in the context — see the comment on `prior_status` below.
    const prior = priorStatusByKey.get(priorKey) ?? null;
    return {
      action:
        entry.date < today
          ? ('attendance.daily.correct' as const)
          : ('attendance.daily.update' as const),
      entityType: 'attendance_daily' as const,
      entityId: null,
      // Key names match the FIRST alternative in each `??` chain in
      // lib/audit/humanize.ts (`section_name` at :358, `prior_status` at
      // :365) and match what the import route already writes, so the two
      // attendance writers finally agree. The renderer was always correct;
      // only this writer was silent, which is why every daily row showed up
      // on /attendance/audit-log with no class name and no before -> after.
      context: {
        section_student_id: entry.sectionStudentId,
        section_id: sectionIdByEnrolment.get(entry.sectionStudentId) ?? null,
        section_name:
          sectionNameById.get(
            sectionIdByEnrolment.get(entry.sectionStudentId) ?? ''
          ) ?? null,
        term_id: entry.termId,
        date: entry.date,
        // ⚠ AN EXPLICIT `null` HERE IS THE RECORD OF A CLEAR, and it is the one
        // thing that tells the renderer this row undid a mark rather than
        // writing one. It must stay a present key with a null value — dropping
        // it would leave the summary saying nothing happened.
        status: entry.status,
        // Omitted entirely when there is no prior mark: a first mark is not a
        // transition, and neither is clearing a day that was already blank.
        // humanize renders just the new status for that case — and it never
        // sees a `null` prior, which it could only render as the word "null".
        ...(prior !== null ? { prior_status: prior } : {}),
        ...(entry.exReason ? { ex_reason: entry.exReason } : {}),
        // PRESENCE ONLY — never the note text. `audit_log` is readable by
        // every `is_registrar_or_above()` user, a wider audience than the
        // mark itself (attendance_daily is registrar+ OR that section's form
        // adviser), and its rows can never be updated or deleted. A note
        // reading "MC submitted — dengue, hospitalised" would therefore be
        // permanently un-redactable and visible to more people than the
        // absence it explains. The trail still proves a note was attached or
        // changed and by whom, which is what an audit needs to answer.
        ...(entry.exNote != null ? { ex_note_present: true } : {}),
      },
    };
  });

  if (results.length > 0) {
    await logActions(
      service,
      { id: auth.user.id, email: auth.user.email ?? null, role: auth.role },
      auditRows
    );

    // ⚠ A DELIBERATE SEMANTIC CHANGE, not a refactor. This used to invalidate
    // whatever year is CURRENT (`requireCurrentAyCode(service)`, its own round
    // trip on every PATCH, and the grid PATCHes one cell at a time). It now
    // invalidates THE SECTION'S OWN year, read for free off the sections query
    // above. For a mark inside the current year the two agree; for a
    // back-dated correction in a year that is no longer current they do not,
    // and the section's year is the right answer — the old code busted a year
    // nothing had changed and left the stale one cached.
    //
    // The fallback exists because over-invalidating a cache is harmless and
    // under-invalidating is not: if the sections read somehow came back
    // without an AY, fall back to the current year rather than skip the bust.
    const ayCodes = ayCodesTouched.size
      ? [...ayCodesTouched]
      : [await requireCurrentAyCode(service)];
    for (const ayCode of ayCodes) invalidateDrillTags('attendance', ayCode);
  }

  return NextResponse.json({ ok: true, count: results.length, results });
}
