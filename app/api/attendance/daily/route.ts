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
// Access:
// - Teachers: write only sections they form-advise (via teacher_assignments)
// - Registrar / school_admin / admin / superadmin: write any section
// - `NC` status is reserved for registrar+; teachers writing `NC` get 403
//
// Audit: logs `attendance.daily.update` for today/future dates,
// `attendance.daily.correct` for past dates.

async function assertAdviserForSections(
  service: ReturnType<typeof createServiceClient>,
  userId: string,
  sectionStudentIds: string[]
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (sectionStudentIds.length === 0) return { ok: true };

  const { data: enrolments, error: enrErr } = await service
    .from('section_students')
    .select('id, section_id')
    .in('id', sectionStudentIds);
  if (enrErr) {
    return { ok: false, reason: `enrolment lookup failed: ${enrErr.message}` };
  }
  const sectionIds = Array.from(
    new Set((enrolments ?? []).map((e) => e.section_id as string))
  );
  if (sectionIds.length === 0) {
    return { ok: false, reason: 'unknown section_student_id(s)' };
  }

  // Held OR covered. Taking the register is precisely the work a substitute is
  // brought in for, so a class they are covering must pass this gate — while
  // the regular adviser stays the name of record on the section everywhere it
  // is displayed.
  let assignments;
  try {
    assignments = await loadEffectiveAssignmentsForUser(service, userId);
  } catch (err) {
    return {
      ok: false,
      reason: `teacher_assignments lookup failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
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
  if (auth.role === 'teacher' && entries.some((e) => e.status === 'NC')) {
    return NextResponse.json(
      { error: 'teachers cannot write NC status; registrar only' },
      { status: 403 }
    );
  }

  const service = createServiceClient();

  // Teacher section gate — ALL touched sections must be ones they adviseform-.
  if (auth.role === 'teacher') {
    const check = await assertAdviserForSections(
      service,
      auth.user.id,
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
    status: string;
    rollup: RollupAfterWrite;
  }> = [];

  // Resolve each entry's section level type once so the day-type lookup
  // can pick the right audience scope (KD #50 audience-precedence rule,
  // migration 037). Two-step fetch — flatter than a nested join, and
  // avoids the Supabase-typed array-vs-object ambiguity on `!inner` joins.
  const studentIds = Array.from(
    new Set(entries.map((e) => e.sectionStudentId))
  );
  const { data: enrolmentRows } = await service
    .from('section_students')
    .select('id, section_id')
    .in('id', studentIds);
  const sectionIdByEnrolment = new Map<string, string>(
    ((enrolmentRows ?? []) as Array<{ id: string; section_id: string }>).map(
      (r) => [r.id, r.section_id]
    )
  );
  const sectionIds = Array.from(new Set(sectionIdByEnrolment.values()));
  // `name` rides along for the audit context — this query is already being
  // made for the day-type lookup, so the class name costs no extra round trip.
  const { data: sectionRows } = sectionIds.length
    ? await service
        .from('sections')
        .select('id, name, levels(code)')
        .in('id', sectionIds)
    : { data: [] };
  // `sections.levels` is typed as `{ code: string } | { code: string }[] | null`
  // depending on Supabase's join inference; normalise to a single code.
  type RawSectionRow = {
    id: string;
    name: string;
    levels: { code: string } | { code: string }[] | null;
  };
  const levelCodeBySection = new Map<string, string | null>();
  const sectionNameById = new Map<string, string>();
  for (const row of (sectionRows ?? []) as RawSectionRow[]) {
    const lvl = Array.isArray(row.levels) ? row.levels[0] : row.levels;
    levelCodeBySection.set(row.id, lvl?.code ?? null);
    sectionNameById.set(row.id, row.name);
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
      status: string;
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
  const priorStatusByKey = new Map<string, string>();
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
    if (blocked && entry.status !== 'NC') {
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
  const auditRows = entries.map((entry) => ({
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
      status: entry.status,
      // Omitted entirely when there is no prior row: a first mark is not a
      // transition, and humanize renders just the new status for that case.
      ...(priorStatusByKey.has(`${entry.sectionStudentId}|${entry.date}`)
        ? {
            prior_status: priorStatusByKey.get(
              `${entry.sectionStudentId}|${entry.date}`
            ),
          }
        : {}),
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
  }));

  if (results.length > 0) {
    await logActions(
      service,
      { id: auth.user.id, email: auth.user.email ?? null },
      auditRows
    );
    invalidateDrillTags('attendance', await requireCurrentAyCode(service));
  }

  return NextResponse.json({ ok: true, count: results.length, results });
}
