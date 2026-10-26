import { loadEnvConfig } from '@next/env';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Service-role access to the LOCAL Supabase stack, for arranging and checking
// the data around the browser steps. It reads the same env files `next dev`
// does (`.env.development.local` over `.env.local`) and refuses to run unless
// they point at 127.0.0.1 — these helpers delete and rewrite rows, and must
// never reach production.
loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const serviceKey = process.env.SUPABASE_SERVICE_KEY ?? '';

export function localDb(): SupabaseClient {
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+/.test(url)) {
    throw new Error(
      `Refusing to run: NEXT_PUBLIC_SUPABASE_URL is "${url}", not the local stack. ` +
        'Create .env.development.local as in docs/context/24-local-dev.md.'
    );
  }
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_KEY is not set.');
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

/** Every seeded local login shares this password (docs/context/24-local-dev.md). */
export const LOCAL_PASSWORD = 'localdev123';

/** Marks every declaration this suite files, so a re-run can clear its own. */
export const E2E_MARK = '[e2e]';

export type Scenario = {
  parentEmail: string;
  studentId: string;
  studentNumber: string;
  firstName: string;
  lastName: string;
  sectionId: string;
  sectionStudentId: string;
  levelType: 'primary' | 'secondary';
  publication: { id: string; termNumber: number; from: string; until: string };
  adviserEmail: string;
  officerEmail: string;
  writeupText: string;
  organizationName: string;
  schoolDays: string[];
};

function singaporeToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
  }).format(new Date());
}

function plain(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Finds a family the whole story can run on: a child in the published class
 * of the current year, with a parent who has a login, a submitted adviser
 * comment for the published term, a form adviser and an officer in charge.
 */
export async function findScenario(db: SupabaseClient): Promise<Scenario> {
  const { data: ay, error: ayErr } = await db
    .from('academic_years')
    .select('id, ay_code')
    .eq('is_current', true)
    .single();
  if (ayErr || !ay)
    throw new Error(`No current academic year: ${ayErr?.message}`);

  const { data: pubs, error: pubErr } = await db
    .from('report_card_publications')
    .select(
      'id, section_id, publish_from, publish_until, terms!inner(id, term_number, academic_year_id)'
    )
    .eq('terms.academic_year_id', ay.id);
  if (pubErr) throw pubErr;
  if (!pubs?.length)
    throw new Error(`No report-card publication in ${ay.ay_code}.`);

  for (const pub of pubs) {
    const term = pub.terms as unknown as { id: string; term_number: number };
    const { data: roster } = await db
      .from('section_students')
      .select(
        'id, student_id, students!inner(student_number, first_name, last_name), sections!inner(levels(level_type))'
      )
      .eq('section_id', pub.section_id)
      .eq('enrollment_status', 'active');

    for (const row of roster ?? []) {
      const st = row.students as unknown as {
        student_number: string;
        first_name: string;
        last_name: string;
      };
      const levelType = (
        row.sections as unknown as { levels: { level_type: string } }
      ).levels.level_type;

      const { data: apps } = await db
        .from(`${ay.ay_code.toLowerCase()}_enrolment_applications`)
        .select('motherEmail, fatherEmail, guardianEmail')
        .eq('studentNumber', st.student_number);
      const emails = (apps ?? [])
        .flatMap((a) => [a.motherEmail, a.fatherEmail, a.guardianEmail])
        .filter((e): e is string => !!e)
        .map((e) => e.toLowerCase());
      if (!emails.length) continue;

      const parentEmail = await firstEmailWithLogin(db, emails);
      if (!parentEmail) continue;

      const { data: writeup } = await db
        .from('evaluation_writeups')
        .select('writeup')
        .eq('student_id', row.student_id)
        .eq('term_id', term.id)
        .eq('submitted', true)
        .maybeSingle();
      const writeupText = plain(writeup?.writeup ?? '');
      if (writeupText.length < 8) continue;

      const adviserEmail = await adviserFor(db, pub.section_id);
      const officerEmail = await officerFor(db, levelType);
      if (!adviserEmail || !officerEmail) continue;

      const { data: config } = await db
        .from('school_config')
        .select('organization_name')
        .limit(1)
        .single();

      return {
        parentEmail,
        studentId: row.student_id,
        studentNumber: st.student_number,
        firstName: st.first_name,
        lastName: st.last_name,
        sectionId: pub.section_id,
        sectionStudentId: row.id,
        levelType: levelType as 'primary' | 'secondary',
        publication: {
          id: pub.id,
          termNumber: term.term_number,
          from: pub.publish_from,
          until: pub.publish_until,
        },
        adviserEmail,
        officerEmail,
        writeupText,
        organizationName: config?.organization_name ?? '',
        schoolDays: await upcomingSchoolDays(db, ay.id),
      };
    }
  }
  throw new Error(
    'No child in a published class has a parent login, a comment and both approvers.'
  );
}

async function firstEmailWithLogin(
  db: SupabaseClient,
  emails: string[]
): Promise<string | null> {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw error;
    const hit = data.users.find(
      (u) => u.email && emails.includes(u.email.toLowerCase())
    );
    if (hit?.email) return hit.email.toLowerCase();
    if (data.users.length < 1000) return null;
  }
  return null;
}

async function emailOf(
  db: SupabaseClient,
  userId: string
): Promise<string | null> {
  const { data } = await db.auth.admin.getUserById(userId);
  return data.user?.email ?? null;
}

async function adviserFor(
  db: SupabaseClient,
  sectionId: string
): Promise<string | null> {
  const { data } = await db
    .from('teacher_assignments')
    .select('teacher_user_id')
    .eq('section_id', sectionId)
    .eq('role', 'form_adviser')
    .limit(1)
    .maybeSingle();
  return data ? emailOf(db, data.teacher_user_id) : null;
}

async function officerFor(
  db: SupabaseClient,
  levelType: string
): Promise<string | null> {
  const { data } = await db
    .from('approval_stage_approvers')
    .select(
      'user_id, applies_to_level_type, approval_stages!inner(flow, is_active, resolver)'
    )
    .eq('approval_stages.flow', 'attendance.student_declaration')
    .eq('approval_stages.is_active', true)
    .eq('approval_stages.resolver', 'named');
  const hit = (data ?? []).find(
    (r) => !r.applies_to_level_type || r.applies_to_level_type === levelType
  );
  return hit ? emailOf(db, hit.user_id) : null;
}

/** Whole-school school days after today, in the current year's calendar. */
async function upcomingSchoolDays(
  db: SupabaseClient,
  academicYearId: string
): Promise<string[]> {
  const { data, error } = await db
    .from('school_calendar')
    .select('date, day_type, audience, terms!inner(academic_year_id)')
    .eq('terms.academic_year_id', academicYearId)
    .eq('day_type', 'school_day')
    .eq('audience', 'all')
    .gt('date', singaporeToday())
    .order('date');
  if (error) throw error;
  return (data ?? []).map((d) => d.date as string);
}

/** Opens the publication window for the test, returning a function that restores it. */
export async function openPublicationWindow(
  db: SupabaseClient,
  s: Scenario
): Promise<() => Promise<void>> {
  const now = Date.now();
  const { error } = await db
    .from('report_card_publications')
    .update({
      publish_from: new Date(now - 3_600_000).toISOString(),
      publish_until: new Date(now + 86_400_000).toISOString(),
    })
    .eq('id', s.publication.id);
  if (error) throw error;
  return async () => {
    await db
      .from('report_card_publications')
      .update({
        publish_from: s.publication.from,
        publish_until: s.publication.until,
      })
      .eq('id', s.publication.id);
  };
}

/** Deletes the declarations an earlier run of this suite filed for the child, with their approvals. */
export async function clearOwnDeclarations(
  db: SupabaseClient,
  s: Scenario
): Promise<void> {
  const { data: rows } = await db
    .from('student_declarations')
    .select('id')
    .eq('student_id', s.studentId)
    // Its own, and any left by a dry run of the production spec against local.
    .or(
      `parent_note.like.${E2E_MARK}%,parent_note.like.Automated test by the SIS team%`
    );
  const ids = (rows ?? []).map((r) => r.id as string);
  if (!ids.length) return;
  const { data: reqs } = await db
    .from('approval_requests')
    .select('id')
    .in('subject_id', ids);
  const reqIds = (reqs ?? []).map((r) => r.id as string);
  if (reqIds.length) {
    const { data: stages } = await db
      .from('approval_request_stages')
      .select('id')
      .in('request_id', reqIds);
    const stageIds = (stages ?? []).map((r) => r.id as string);
    if (stageIds.length) {
      await db
        .from('approval_request_stage_decisions')
        .delete()
        .in('request_stage_id', stageIds);
    }
    await db.from('approval_request_stages').delete().in('request_id', reqIds);
    await db.from('approval_requests').delete().in('id', reqIds);
  }
  const { error } = await db
    .from('student_declarations')
    .delete()
    .in('id', ids);
  if (error) throw error;
}

/** School days the child has no live filing on, so the suite never collides with seeded data. */
export async function freeSchoolDays(
  db: SupabaseClient,
  s: Scenario
): Promise<string[]> {
  const { data } = await db
    .from('student_declarations')
    .select('start_date, end_date, status')
    .eq('student_id', s.studentId)
    .in('status', ['pending', 'approved']);
  const taken = data ?? [];
  return s.schoolDays.filter(
    (d) => !taken.some((t) => t.start_date <= d && d <= t.end_date)
  );
}

export type FiledDeclaration = {
  id: string;
  status: string;
  requestId: string;
  registerWrittenAt: string | null;
  registerWriteError: string | null;
};

export async function declarationByNote(
  db: SupabaseClient,
  s: Scenario,
  note: string
): Promise<FiledDeclaration | null> {
  const { data } = await db
    .from('student_declarations')
    .select('id, status, register_written_at, register_write_error')
    .eq('student_id', s.studentId)
    .eq('parent_note', note)
    .maybeSingle();
  if (!data) return null;
  const { data: req } = await db
    .from('approval_requests')
    .select('id')
    .eq('subject_id', data.id)
    .maybeSingle();
  return {
    id: data.id,
    status: data.status,
    requestId: req?.id ?? '',
    registerWrittenAt: data.register_written_at,
    registerWriteError: data.register_write_error,
  };
}

export async function registerMark(
  db: SupabaseClient,
  s: Scenario,
  date: string
): Promise<{
  status: string;
  ex_reason: string | null;
  recorded_at: string;
} | null> {
  const { data } = await db
    .from('attendance_daily')
    .select('status, ex_reason, recorded_at')
    .eq('section_student_id', s.sectionStudentId)
    .eq('date', date)
    .is('period_id', null)
    // A ledger: the newest row for the day is the mark (migration 014).
    .order('recorded_at', { ascending: false })
    .limit(1);
  return data?.[0] ?? null;
}
