import { NextResponse, type NextRequest } from 'next/server';
import { requireRole } from '@/lib/auth/require-role';
// The GET below stays on requireRole deliberately: it admits `teacher` so a
// teacher can read their own assignments, and staff.read is the registrar-and-up
// set. Mapping it to staff.read would have narrowed it; adding teacher to
// staff.read would have widened every other staff surface. The writes below are
// capability-gated.
import { requireCapability } from '@/lib/auth/require-capability';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { subjectDisplayNameResolver } from '@/lib/sis/subjects/display-names-for-ay';
import { logActions } from '@/lib/audit/log-action';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import {
  AssignmentBulkCreateSchema,
  AssignmentCreateSchema,
  type AssignmentBulkCreate,
  type AssignmentCreate,
  type AssignmentRole,
  isAdviserRole,
} from '@/lib/schemas/teacher-assignment';
import type { SupabaseClient } from '@supabase/supabase-js';

// Staffing a whole year arrives here as ONE request of ~200 rows, so this
// handler is deliberately allowed longer than a single-record write would get.
// Without it the platform's default cut-off could kill the function AFTER the
// insert has committed, and the admin would be told the save failed when every
// row is in the database — the exact "failure that reads as good news" KD #183
// exists to prevent. The work after the insert is now parallel and bounded
// (two reads plus one audit write per row, and the batch itself is capped —
// see ASSIGNMENT_BULK_MAX in lib/schemas/teacher-assignment.ts), so 60s is
// headroom rather than a target.
export const maxDuration = 60;

type CreatedAssignment = {
  id: string;
  teacher_user_id: string;
  section_id: string;
  subject_id: string | null;
  role: AssignmentRole;
};

type LevelLite = { code: string | null; label: string | null };

type SectionRow = {
  id: string;
  name: string | null;
  level: LevelLite | LevelLite[] | null;
  academic_year:
    | { id: string; ay_code: string }
    | { id: string; ay_code: string }[]
    | null;
};

type SubjectRow = { id: string; name: string | null };

/** PostgREST returns an embedded to-one relation as an object or a 1-array. */
function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** What the audit line and the cache bust both need about one class. */
type SectionLookup = { displayName: string | null; ayCode: string | null };

/**
 * Resolve every class and subject named in a batch in TWO reads — not two per
 * row.
 *
 * A batch names the same class nine or ten times over (its adviser plus its
 * subject teachers), so resolving names row by row re-read the same `sections`
 * row once per assignment: measured at 11 reads for 10 rows in one class, and
 * 400 reads for a 200-row year. Distinct ids in, one read each out.
 *
 * The class read carries the academic year as well, because the cache bust
 * below needs exactly the same rows — reading them twice would put the N+1
 * straight back.
 *
 * Best-effort by design, matching what it replaces: a lookup that fails
 * degrades the audit line to its raw ids rather than failing a save that has
 * already committed. Never throws.
 */
async function resolveBatchNames(
  service: SupabaseClient,
  created: CreatedAssignment[]
): Promise<{
  sections: Map<string, SectionLookup>;
  subjects: Map<string, string>;
}> {
  const sections = new Map<string, SectionLookup>();
  const subjects = new Map<string, string>();

  const sectionIds = [...new Set(created.map((a) => a.section_id))];
  const subjectIds = [
    ...new Set(
      created
        .map((a) => a.subject_id)
        .filter((id): id is string => id !== null && id !== undefined)
    ),
  ];

  const loadSections = async (): Promise<SectionRow[]> => {
    if (sectionIds.length === 0) return [];
    const { data } = await service
      .from('sections')
      .select(
        'id, name, level:levels(code, label), academic_year:academic_years(id, ay_code)'
      )
      .in('id', sectionIds);
    return (data ?? []) as SectionRow[];
  };

  const loadSubjects = async (): Promise<SubjectRow[]> => {
    if (subjectIds.length === 0) return [];
    const { data } = await service
      .from('subjects')
      .select('id, name')
      .in('id', subjectIds);
    return (data ?? []) as SubjectRow[];
  };

  try {
    const [sectionRows, subjectRows] = await Promise.all([
      loadSections(),
      loadSubjects(),
    ]);

    for (const row of sectionRows) {
      const level = firstOf(row.level);
      // "P4 Diligence" reads the way staff say it; the bare virtue name alone
      // ("Diligence") is ambiguous across levels.
      const displayName = row.name
        ? level?.code
          ? `${level.code} ${row.name}`
          : row.name
        : null;
      sections.set(row.id, {
        displayName,
        ayCode: firstOf(row.academic_year)?.ay_code ?? null,
      });
    }

    // Name each subject the way the SECTION'S OWN academic year names it
    // (migration 137), so an audit row records the words the operator saw on
    // screen when they made the assignment. Freezing it at write time is the
    // point — resolving on read would rewrite history on the next rename.
    const resolveName = await subjectDisplayNameResolver(
      service,
      sectionRows.map((r) => firstOf(r.academic_year)?.id),
      subjectRows.map((r) => r.id)
    );
    // One AY is in play on any real batch (a save is per section list), so the
    // first section's year answers for all of them.
    const ayIdForSubjects =
      sectionRows.map((r) => firstOf(r.academic_year)?.id).find(Boolean) ??
      null;

    for (const row of subjectRows) {
      // `name` is nullable on the row type; the guard above already means we
      // only get here with a real one.
      if (!row.name) continue;
      subjects.set(
        row.id,
        resolveName(ayIdForSubjects, { id: row.id, name: row.name })
      );
    }
  } catch {
    // Swallow — the ids are recorded on every audit row regardless, and a
    // missing display name must never surface as a failed save.
  }

  return { sections, subjects };
}

// GET /api/teacher-assignments?section_id=... — list assignments.
// Managers (registrar+) see all; any other authenticated user can request
// their own via ?mine=1 (used by teacher-facing screens later).
export async function GET(request: NextRequest) {
  const auth = await requireRole([
    'teacher',
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const supabase = await createClient();
  const sectionId = request.nextUrl.searchParams.get('section_id');
  const mine = request.nextUrl.searchParams.get('mine') === '1';

  const isManager =
    auth.role === 'academic_coordinator' ||
    auth.role === 'school_admin' ||
    auth.role === 'superadmin';

  let q = supabase
    .from('teacher_assignments')
    .select(
      'id, teacher_user_id, section_id, subject_id, role, relief_teacher_user_id'
    );
  if (sectionId) q = q.eq('section_id', sectionId);
  // Teachers always see only their own rows regardless of ?mine param.
  if (!isManager) q = q.eq('teacher_user_id', auth.user.id);

  const { data, error } = await q;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ assignments: data ?? [] });
}

// POST /api/teacher-assignments — registrar+ only.
//
// Two bodies, one behaviour:
//   { teacher_user_id, section_id, role, subject_id? }   — one assignment
//   { assignments: [ { ...the same four fields }, ... ] } — a whole batch
//
// role='form_adviser' — subject_id must be null; one per section.
// role='subject_teacher' — subject_id required; one per (section, subject).
//
// Both rules are "one per class", differing only in what "one" is counted
// against. They are database indexes as well (003 for the adviser, 118 for the
// subject), and the messages below restate them as sentences — an index name
// reaching a school admin is a bug, not an explanation.
//
// The single shape is not a legacy alias kept alive out of politeness: adding
// one subject teacher to one class is a thing staff do all year, and the
// section Teachers tab and the per-teacher staff sheet both send it. It keeps
// returning `{ assignment }` (singular), which is what those two callers read.
//
// The batch is written in ONE insert, which Postgres runs as one statement — so
// it is all-or-nothing. Looping would let 180 of 200 assignments land and the
// 181st fail on a unique index, leaving a half-staffed year and no screen
// saying which half. The batch returns `{ assignments, count }`.
export async function POST(request: NextRequest) {
  // Unchanged: the same capability that has always guarded this write.
  const auth = await requireCapability('staff.edit_assignments');
  if ('error' in auth) return auth.error;

  const raw = await request.json().catch(() => null);

  // Nothing readable arrived at all. Handled before zod, because zod's answer
  // to a null body is "Invalid input: expected object, received null" — the one
  // sentence a school admin can do least with.
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return NextResponse.json(
      { error: 'Nothing was sent to save. Refresh the page and try again.' },
      { status: 400 }
    );
  }

  const isBulk = 'assignments' in (raw as object);

  const parsed = isBulk
    ? AssignmentBulkCreateSchema.safeParse(raw)
    : AssignmentCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ?? 'Check the form and try again.',
      },
      { status: 400 }
    );
  }

  const rows: AssignmentCreate[] = isBulk
    ? (parsed.data as AssignmentBulkCreate).assignments
    : [parsed.data as AssignmentCreate];

  // Every name on the list must be a STAFF account — any staff role, not only
  // `teacher`.
  //
  // ⚠ THE ROLE IS NOT THE POINT. THE PARENT ACCOUNTS ARE. Neither this list
  // nor its predecessor may ever become `getStaffDisplayNameById()`: the
  // latter returns every auth user with an email, which in this database means
  // the ~1,000 parent portal accounts as well as staff (KD #1), so validating
  // against it would let a parent's id be recorded as teaching a class, and
  // the RLS helpers in migration 005 would then hand that parent read access
  // to that class's students and grades. Migration 003 declares no FK to
  // auth.users and says in as many words that "the service role enforces
  // validity when writing assignments": this line is that enforcement.
  //
  // `getAssignableStaffList()` keeps exactly that property while dropping the
  // one that was never a security rule. It filters `role !== null`, and a
  // parent carries no role at all — so parents stay out for precisely the
  // reason they always did, while a school_admin who advises a form class can
  // now be recorded as doing so. Six of them already are, written straight to
  // the database by the deployment import because this gate refused them, and
  // four hold a form class whose FCA write-ups gate report-card publishing
  // (KD #138 / #145). Until now nobody could maintain those rows on screen.
  //
  // `excludeDisabled: false` because the Accounts tab offers "Manage teaching
  // assignments" on any staff row, disabled or not
  // (components/sis/staff-accounts-client.tsx). Recording who holds a class is
  // a separate question from whether that person can sign in today, and
  // tightening it here would break a path that works. The staff-vs-parent
  // distinction is unaffected: the helper filters on role BEFORE it filters on
  // disabled.
  const { getAssignableStaffList } = await import('@/lib/auth/staff-list');
  const assignable = await getAssignableStaffList({ excludeDisabled: false });
  const assignableIds = new Set(assignable.map((t) => t.id));
  if (rows.some((r) => !assignableIds.has(r.teacher_user_id))) {
    // Not "refresh the list and try again": the list this check reads is
    // cached on the server for five minutes and shared by everyone, so a
    // refresh in the browser cannot change the answer. The account is what has
    // to change — and POST /api/sis/admin/users now busts the `teacher-emails`
    // tag, so an account created on the Staff page is assignable immediately
    // rather than up to five minutes later. (PATCH and DELETE on that same
    // resource still do not: giving an existing account a role keeps the
    // five-minute wait.)
    return NextResponse.json(
      {
        error:
          'Only someone with a staff account can be given a class. Check that person on the Staff page, then try again.',
      },
      { status: 400 }
    );
  }

  const service = createServiceClient();

  // Every column this route writes is set on EVERY row, including the
  // `subject_id` that is null for advisers.
  //
  // PostgREST takes the union of the keys across a multi-row insert and fills
  // any row missing one with NULL rather than falling back to the column
  // default. So a batch that omitted `subject_id` on adviser rows would still
  // send the column, and a batch is only safe when every row spells out every
  // key. This bit in production on migrations 112-116, where an omitted date
  // became a NOT NULL violation instead of "use today".
  //
  // `id` and `created_at` are the deliberate exceptions: no row mentions them,
  // so they are not in the union at all and their defaults apply as normal.
  // That is what we want — a row's creation time should be the database's
  // clock, not a caller's.
  const { data, error } = await service
    .from('teacher_assignments')
    .insert(
      rows.map((r) => ({
        teacher_user_id: r.teacher_user_id,
        section_id: r.section_id,
        // isAdviserRole, not the literal — `co_adviser` also carries no
        // subject, and the role/subject CHECK constraint rejects one that
        // does. The zod schema already refuses such a body, so this is the
        // second of two guards rather than the only one.
        subject_id: isAdviserRole(r.role) ? null : (r.subject_id ?? null),
        role: r.role,
      }))
    )
    .select(
      'id, teacher_user_id, section_id, subject_id, role, relief_teacher_user_id'
    );

  if (error) {
    // Every branch here ends in "Nothing was saved." — that sentence is the
    // whole point of the message. The insert is one statement, so a failure
    // means not one row landed, and an admin who has just staffed 200 classes
    // needs to know whether to redo all of it or none of it. It used to be
    // appended only inside the two mapped branches, so the unmapped path — the
    // realistic one, a class deleted in another tab — said nothing about it.
    const raw = error.message ?? '';
    const code = (error as { code?: string }).code ?? '';

    // Postgres tells the caller apart from the server by SQLSTATE class 23
    // (integrity violation): a duplicate, a missing class, or a shape the table
    // forbids is something the admin can fix. Everything else — a dropped
    // connection, a permissions problem, the database being down — is ours, and
    // answering 400 to it told the admin to correct a form that was correct.
    const isIntegrityViolation =
      code === '23505' ||
      code === '23503' ||
      code === '23514' ||
      /violates (unique|foreign key|check) constraint/i.test(raw);

    let message: string;
    if (raw.includes('teacher_assignments_form_adviser_unique')) {
      message = `${isBulk ? 'One of those classes' : 'This section'} already has a form adviser. Remove the existing one first.`;
    } else if (
      raw.includes('teacher_assignments_one_subject_teacher_per_class') ||
      // The pre-118 index, kept so a database that has not run 118 yet still
      // answers in words rather than in an index name.
      raw.includes('teacher_assignments_subject_teacher_unique')
    ) {
      message = `${isBulk ? 'One of those subjects' : 'This subject'} already has a teacher in this class. Remove the existing one first.`;
    } else if (raw.includes('teacher_assignments_section_id_fkey')) {
      // A well-formed id for a class that is no longer there — a grid left open
      // while someone else deleted the class, or a stale page.
      message = `${isBulk ? 'One of those classes' : 'That class'} no longer exists. Refresh the page and try again.`;
    } else if (raw.includes('teacher_assignments_subject_id_fkey')) {
      message = `${isBulk ? 'One of those subjects' : 'That subject'} no longer exists. Refresh the page and try again.`;
    } else if (raw.includes('teacher_assignments_role_subject_shape')) {
      message =
        'A form class adviser covers the whole class and a subject teacher takes one subject. Check the subject column and try again.';
    } else if (isIntegrityViolation) {
      message =
        'That does not match what is already saved. Refresh the page and try again.';
    } else {
      // Never the raw text. It reads like
      // `insert or update on table "teacher_assignments" violates foreign key
      // constraint …` — three database words and a table name, to a school
      // admin. Keep it in the server log, where it is useful.
      console.error('[teacher-assignments] insert failed', {
        code,
        message: raw,
      });
      message = 'The assignments could not be saved just now. Try again.';
    }

    return NextResponse.json(
      { error: `${message} Nothing was saved.` },
      { status: isIntegrityViolation ? 400 : 500 }
    );
  }

  const created = (data ?? []) as CreatedAssignment[];

  // Kept, not deleted, even though `.select()` on a service-client insert makes
  // it unreachable today: PostgREST answers with the inserted representation,
  // so no error means every row came back. It stays because the thing it
  // watches for — a save that returns fewer rows than it was given, quietly —
  // is one of the two failure shapes KD #183 was written about, and the cost of
  // keeping it is one comparison.
  //
  // What it must NOT do is what it used to: say "Nothing was changed" on a path
  // where the insert SUCCEEDED. If this ever fires, some rows are in the
  // database, and telling an admin otherwise sends them to re-enter work that
  // is already saved. So it reports the count and sends them to look.
  if (created.length !== rows.length) {
    console.error('[teacher-assignments] insert returned an unexpected count', {
      requested: rows.length,
      returned: created.length,
    });
    return NextResponse.json(
      {
        error:
          created.length === 0
            ? 'Nothing came back from that save, so it may not have been recorded. Check the class before saving again.'
            : `Only ${created.length} of ${rows.length} assignments came back from that save. Check the classes before saving again — some are already recorded.`,
      },
      { status: 500 }
    );
  }

  // NOTE: this used to also mirror the adviser's display name onto
  // `sections.form_class_adviser`. That write was removed — every consumer
  // (report card, masterfile, publish-readiness) resolves the adviser LIVE from
  // teacher_assignments and deliberately ignores the mirror, because it was
  // written on assign and never cleared on unassign. Nothing read it, so the
  // only thing it could do was drift and mislead the next reader. The column
  // itself stays: a dozen AY-setup and template RPCs reference it, so dropping
  // it is a large migration for no gain.

  // Everything below runs AFTER the rows are committed, and it used to run one
  // row at a time: 200 assignments meant 400 `sections` reads, 200 `subjects`
  // reads and 200 audit inserts, all sequential — 801 round trips for a save
  // the database had already finished. Long enough that the platform could kill
  // the function mid-way, at which point the browser reports a failure for a
  // year that is fully staffed, the admin re-sends the same 200 rows, and the
  // unique index answers "…Nothing was saved" — which by then is false.
  //
  // Names first, in two reads for the whole batch. The teacher names are free:
  // the account check above already loaded the assignable-staff list.
  const teacherNames = new Map(assignable.map((t) => [t.id, t.name]));
  const { sections, subjects } = await resolveBatchNames(service, created);

  // One audit row per assignment, not one per batch. Each assignment is removed
  // and changed on its own afterwards, with its own explanation (the reason gate
  // in DELETE /api/teacher-assignments/[id]), so its creation belongs on its own
  // timeline. A single batch row would leave 199 classes with a history that
  // begins mid-story.
  //
  // `logActions` (plural) writes them with Promise.all. The ids stay in the
  // context beside the names: the audit humanizer hides `*_id` keys, so they are
  // invisible on screen, but they are what keeps an entry traceable if a name is
  // corrected later — same contract as buildAssignmentAuditContext, which this
  // replaces for the batch path.
  await logActions(
    service,
    { id: auth.user.id, email: auth.user.email ?? null },
    created.map((assignment) => {
      const teacherName = teacherNames.get(assignment.teacher_user_id);
      const sectionName = sections.get(assignment.section_id)?.displayName;
      const subjectName = assignment.subject_id
        ? subjects.get(assignment.subject_id)
        : undefined;
      return {
        action: 'assignment.create' as const,
        entityType: 'teacher_assignment' as const,
        entityId: assignment.id,
        context: {
          teacher_user_id: assignment.teacher_user_id,
          section_id: assignment.section_id,
          subject_id: assignment.subject_id,
          role: assignment.role,
          ...(teacherName ? { teacher_name: teacherName } : {}),
          ...(sectionName ? { section_name: sectionName } : {}),
          ...(subjectName ? { subject_name: subjectName } : {}),
        },
      };
    })
  );

  // Teacher assignments scope per-section grading-sheet lists (markbook),
  // evaluation sections, and attendance section drills — all `unstable_cache`d.
  // A change must bust those three modules' tags for the section's AY so the
  // next dashboard/drill read is fresh (not stale until the 60s TTL backstop).
  //
  // One section can appear several times in a batch (its adviser plus its eight
  // subject teachers), so bust each one once. The AY came back with the name
  // read above — this used to be its own `sections` read per section, on top of
  // the two the audit line already did.
  //
  // Best-effort: an AY that would not resolve skips the bust rather than
  // failing a save that has committed.
  for (const sectionId of new Set(created.map((a) => a.section_id))) {
    const ayCode = sections.get(sectionId)?.ayCode;
    if (!ayCode) continue;
    invalidateDrillTags('markbook', ayCode);
    invalidateDrillTags('evaluation', ayCode);
    invalidateDrillTags('attendance', ayCode);
  }

  // The single shape keeps its original response verbatim — the staff sheet
  // reads `json.assignment.id` off it to build its optimistic row.
  return isBulk
    ? NextResponse.json({ assignments: created, count: created.length })
    : NextResponse.json({ assignment: created[0] });
}
