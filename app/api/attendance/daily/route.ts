import { NextResponse, type NextRequest } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { logAction } from '@/lib/audit/log-action';
import { createServiceClient } from '@/lib/supabase/service';
import { writeDailyEntry } from '@/lib/attendance/mutations';
import { levelTypeForAudienceLookup } from '@/lib/sis/levels';
import {
  DailyBulkSchema,
  DailyEntrySchema,
  type DailyEntryInput,
  type Audience,
  type DayType,
} from '@/lib/schemas/attendance';

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
  sectionStudentIds: string[],
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
    new Set((enrolments ?? []).map((e) => e.section_id as string)),
  );
  if (sectionIds.length === 0) {
    return { ok: false, reason: 'unknown section_student_id(s)' };
  }

  const { data: assignments, error: taErr } = await service
    .from('teacher_assignments')
    .select('section_id, role')
    .eq('teacher_user_id', userId)
    .eq('role', 'form_adviser')
    .in('section_id', sectionIds);
  if (taErr) {
    return { ok: false, reason: `teacher_assignments lookup failed: ${taErr.message}` };
  }
  const covered = new Set((assignments ?? []).map((a) => a.section_id as string));
  const uncovered = sectionIds.filter((s) => !covered.has(s));
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
    'registrar',
    'school_admin',
    'admin',
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
        { status: 400 },
      );
    }
    entries = parsed.data.entries;
  } else {
    const parsed = DailyEntrySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'invalid payload', details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    entries = [parsed.data];
  }

  // Teachers can't write `NC` — only registrar+ marks holidays / not-yet-enrolled.
  if (auth.role === 'teacher' && entries.some((e) => e.status === 'NC')) {
    return NextResponse.json(
      { error: 'teachers cannot write NC status; registrar only' },
      { status: 403 },
    );
  }

  const service = createServiceClient();

  // Teacher section gate — ALL touched sections must be ones they adviseform-.
  if (auth.role === 'teacher') {
    const check = await assertAdviserForSections(
      service,
      auth.user.id,
      entries.map((e) => e.sectionStudentId),
    );
    if (!check.ok) {
      return NextResponse.json({ error: check.reason }, { status: 403 });
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const results: Array<{
    sectionStudentId: string;
    termId: string;
    date: string;
    status: string;
    rollup: Awaited<ReturnType<typeof writeDailyEntry>>;
  }> = [];

  // Resolve each entry's section level type once so the day-type lookup
  // can pick the right audience scope (KD #50 audience-precedence rule,
  // migration 037). Two-step fetch — flatter than a nested join, and
  // avoids the Supabase-typed array-vs-object ambiguity on `!inner` joins.
  const studentIds = Array.from(new Set(entries.map((e) => e.sectionStudentId)));
  const { data: enrolmentRows } = await service
    .from('section_students')
    .select('id, section_id')
    .in('id', studentIds);
  const sectionIdByEnrolment = new Map<string, string>(
    ((enrolmentRows ?? []) as Array<{ id: string; section_id: string }>).map((r) => [
      r.id,
      r.section_id,
    ]),
  );
  const sectionIds = Array.from(new Set(sectionIdByEnrolment.values()));
  const { data: sectionRows } = sectionIds.length
    ? await service
        .from('sections')
        .select('id, levels(code)')
        .in('id', sectionIds)
    : { data: [] };
  // `sections.levels` is typed as `{ code: string } | { code: string }[] | null`
  // depending on Supabase's join inference; normalise to a single code.
  type RawSectionRow = {
    id: string;
    levels: { code: string } | { code: string }[] | null;
  };
  const levelCodeBySection = new Map<string, string | null>();
  for (const row of (sectionRows ?? []) as RawSectionRow[]) {
    const lvl = Array.isArray(row.levels) ? row.levels[0] : row.levels;
    levelCodeBySection.set(row.id, lvl?.code ?? null);
  }
  const levelTypeByEnrolment = new Map<string, 'primary' | 'secondary' | null>();
  for (const [enrolmentId, sectionId] of sectionIdByEnrolment) {
    const code = levelCodeBySection.get(sectionId) ?? null;
    levelTypeByEnrolment.set(enrolmentId, levelTypeForAudienceLookup(code));
  }

  // Cache write-gate lookups per (termId, date, levelType) to avoid N round-
  // trips on bulk. Audience precedence: a row with audience=$levelType beats
  // the audience='all' row for the same date. Preschool sections (levelType
  // null) only consider 'all' rows.
  // Gate: encodable when day_type IN ('school_day','hbl'); blocked otherwise.
  // When the term has NO calendar rows (legacy/unconfigured mode) we don't
  // block — same behaviour as pre-migration-019.
  const blockCache = new Map<string, boolean>();
  async function isNonSchoolDay(
    termId: string,
    date: string,
    levelType: 'primary' | 'secondary' | null,
  ): Promise<boolean> {
    const key = `${termId}|${date}|${levelType ?? 'all'}`;
    if (blockCache.has(key)) return blockCache.get(key)!;

    const audiences: Audience[] = levelType ? ['all', levelType] : ['all'];
    const { data } = await service
      .from('school_calendar')
      .select('day_type, audience')
      .eq('term_id', termId)
      .eq('date', date)
      .in('audience', audiences);
    if (!data || data.length === 0) {
      // Date not listed for any audience this section sees. If the term has
      // any rows at all, treat as non-school (implicit holiday); otherwise
      // legacy mode (no block).
      const { count } = await service
        .from('school_calendar')
        .select('*', { count: 'exact', head: true })
        .eq('term_id', termId);
      const isBlocked = (count ?? 0) > 0;
      blockCache.set(key, isBlocked);
      return isBlocked;
    }
    // Audience precedence — prefer the level-specific row over 'all'.
    const rows = data as Array<{ day_type: DayType; audience: Audience }>;
    const specific = rows.find((r) => r.audience === levelType);
    const chosen = specific ?? rows[0];
    const dt = chosen.day_type;
    const isBlocked = dt !== 'school_day' && dt !== 'hbl';
    blockCache.set(key, isBlocked);
    return isBlocked;
  }

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
          writtenSoFar: results.length,
        },
        { status: 409 },
      );
    }

    try {
      const rollup = await writeDailyEntry(service, {
        sectionStudentId: entry.sectionStudentId,
        termId: entry.termId,
        date: entry.date,
        status: entry.status,
        exReason: entry.exReason ?? null,
        recordedBy: auth.user.id,
      });

      await logAction({
        service,
        actor: { id: auth.user.id, email: auth.user.email ?? null },
        action: entry.date < today ? 'attendance.daily.correct' : 'attendance.daily.update',
        entityType: 'attendance_daily',
        entityId: null,
        context: {
          section_student_id: entry.sectionStudentId,
          term_id: entry.termId,
          date: entry.date,
          status: entry.status,
          ...(entry.exReason ? { ex_reason: entry.exReason } : {}),
        },
      });

      results.push({
        sectionStudentId: entry.sectionStudentId,
        termId: entry.termId,
        date: entry.date,
        status: entry.status,
        rollup,
      });
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      return NextResponse.json(
        { error: reason, writtenSoFar: results.length },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({ ok: true, count: results.length, results });
}
