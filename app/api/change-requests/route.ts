import { NextResponse, type NextRequest } from 'next/server';
import { requireRole } from '@/lib/auth/require-role';
import { createServiceClient } from '@/lib/supabase/service';
import { logAction } from '@/lib/audit/log-action';
import {
  ChangeRequestFormSchema,
  type ChangeRequestField,
} from '@/lib/schemas/change-request';
import {
  loadAssignmentsForUser,
  isSubjectTeacher,
} from '@/lib/auth/teacher-assignments';
import { notifyRequestFiled } from '@/lib/notifications/email-change-request';
import { createClient } from '@/lib/supabase/server';

// GET /api/change-requests
// Query params:
//   ?status=pending|approved|rejected|applied|cancelled (optional, default = all)
//   ?sheet_id=<uuid>   (optional, scope to one sheet)
//   ?mine=1            (teachers: their own requests only — enforced for teacher role)
//
// Teachers always get only their own rows. Admin/superadmin/registrar see all.
export async function GET(request: NextRequest) {
  const auth = await requireRole(['teacher', 'registrar', 'admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const sheetId = url.searchParams.get('sheet_id');

  const service = createServiceClient();
  let query = service
    .from('grade_change_requests')
    .select(
      `id, grading_sheet_id, grade_entry_id, field_changed, slot_index,
       current_value, proposed_value, reason_category, justification,
       status, requested_by, requested_by_email, requested_at,
       reviewed_by, reviewed_by_email, reviewed_at, decision_note,
       applied_by, applied_at`,
    )
    .order('requested_at', { ascending: false });

  if (auth.role === 'teacher') {
    query = query.eq('requested_by', auth.user.id);
  }
  if (status) {
    query = query.eq('status', status);
  }
  if (sheetId) {
    query = query.eq('grading_sheet_id', sheetId);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ requests: data ?? [] });
}

// POST /api/change-requests
// Teachers file a new request against a locked sheet they are assigned to.
// Admin+ can also file one (shouldn't need to, but not blocked).
export async function POST(request: NextRequest) {
  const auth = await requireRole(['teacher', 'registrar', 'admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const raw = await request.json().catch(() => null);
  const parsed = ChangeRequestFormSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: issue?.message ?? 'invalid body' },
      { status: 400 },
    );
  }
  const body = parsed.data;

  const service = createServiceClient();

  // Load the sheet + entry + section metadata in one round-trip.
  const [sheetRes, entryRes] = await Promise.all([
    service
      .from('grading_sheets')
      .select('id, section_id, subject_id, is_locked')
      .eq('id', body.grading_sheet_id)
      .single(),
    service
      .from('grade_entries')
      .select('id, grading_sheet_id, ww_scores, pt_scores, qa_score, letter_grade, is_na')
      .eq('id', body.grade_entry_id)
      .single(),
  ]);

  if (sheetRes.error || !sheetRes.data) {
    return NextResponse.json({ error: 'sheet not found' }, { status: 404 });
  }
  if (entryRes.error || !entryRes.data) {
    return NextResponse.json({ error: 'entry not found' }, { status: 404 });
  }
  const sheet = sheetRes.data as {
    id: string;
    section_id: string;
    subject_id: string;
    is_locked: boolean;
  };
  const entry = entryRes.data as {
    id: string;
    grading_sheet_id: string;
    ww_scores: (number | null)[] | null;
    pt_scores: (number | null)[] | null;
    qa_score: number | null;
    letter_grade: string | null;
    is_na: boolean;
  };
  if (entry.grading_sheet_id !== sheet.id) {
    return NextResponse.json(
      { error: 'entry does not belong to sheet' },
      { status: 400 },
    );
  }
  if (!sheet.is_locked) {
    return NextResponse.json(
      { error: 'sheet is not locked — edit directly instead of filing a request' },
      { status: 400 },
    );
  }

  // Teachers must be assigned to this section + subject to file a request.
  if (auth.role === 'teacher') {
    const cookieClient = await createClient();
    const assignments = await loadAssignmentsForUser(cookieClient, auth.user.id);
    if (!isSubjectTeacher(assignments, sheet.section_id, sheet.subject_id)) {
      return NextResponse.json(
        { error: 'not assigned to this sheet' },
        { status: 403 },
      );
    }
  }

  // Snapshot the current value from the entry for the requested field/slot.
  const currentValue = snapshotCurrentValue(entry, body.field_changed, body.slot_index);

  const { data: inserted, error: insertError } = await service
    .from('grade_change_requests')
    .insert({
      grading_sheet_id: body.grading_sheet_id,
      grade_entry_id: body.grade_entry_id,
      field_changed: body.field_changed,
      slot_index: body.slot_index,
      current_value: currentValue,
      proposed_value: body.proposed_value,
      reason_category: body.reason_category,
      justification: body.justification,
      status: 'pending',
      requested_by: auth.user.id,
      requested_by_email: auth.user.email ?? '(unknown)',
    })
    .select('*')
    .single();

  if (insertError || !inserted) {
    return NextResponse.json(
      { error: insertError?.message ?? 'insert failed' },
      { status: 500 },
    );
  }

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'grade_change_requested',
    entityType: 'grade_change_request',
    entityId: inserted.id,
    context: {
      grading_sheet_id: body.grading_sheet_id,
      grade_entry_id: body.grade_entry_id,
      field: body.field_changed,
      slot_index: body.slot_index,
      proposed: body.proposed_value,
      reason_category: body.reason_category,
    },
  });

  // Fire-and-forget notification to approvers. Never blocks the response.
  void (async () => {
    try {
      const approverEmails = await fetchApproverEmails(service);
      const { student_label, sheet_label } = await fetchLabels(service, sheet.id, entry.id);
      await notifyRequestFiled(
        {
          id: inserted.id,
          grading_sheet_id: inserted.grading_sheet_id,
          field_changed: inserted.field_changed,
          current_value: inserted.current_value,
          proposed_value: inserted.proposed_value,
          reason_category: inserted.reason_category,
          justification: inserted.justification,
          requested_by_email: inserted.requested_by_email,
          requested_at: inserted.requested_at,
          student_label,
          sheet_label,
        },
        approverEmails,
      );
    } catch (e) {
      console.error('[change-requests] notify filed failed', e);
    }
  })();

  return NextResponse.json({ request: inserted }, { status: 201 });
}

function snapshotCurrentValue(
  entry: {
    ww_scores: (number | null)[] | null;
    pt_scores: (number | null)[] | null;
    qa_score: number | null;
    letter_grade: string | null;
    is_na: boolean;
  },
  field: ChangeRequestField,
  slotIndex: number | null,
): string | null {
  switch (field) {
    case 'ww_scores': {
      const v = entry.ww_scores?.[slotIndex ?? -1];
      return v == null ? null : String(v);
    }
    case 'pt_scores': {
      const v = entry.pt_scores?.[slotIndex ?? -1];
      return v == null ? null : String(v);
    }
    case 'qa_score':
      return entry.qa_score == null ? null : String(entry.qa_score);
    case 'letter_grade':
      return entry.letter_grade;
    case 'is_na':
      return entry.is_na ? 'true' : 'false';
  }
}

// Helpers shared with the [id]/route.ts handler. Kept local to avoid a new
// module layer — the workflow helpers live here where they're used.
export async function fetchApproverEmails(
  service: ReturnType<typeof createServiceClient>,
): Promise<string[]> {
  // Admin + superadmin users. Uses auth.admin API which needs service role.
  try {
    const { data, error } = await service.auth.admin.listUsers();
    if (error || !data) return [];
    return data.users
      .filter((u) => {
        const role =
          (u.app_metadata as { role?: string } | null)?.role ??
          (u.user_metadata as { role?: string } | null)?.role ??
          null;
        return role === 'admin' || role === 'superadmin';
      })
      .map((u) => u.email ?? '')
      .filter(Boolean);
  } catch (e) {
    console.error('[change-requests] listUsers failed', e);
    return [];
  }
}

export async function fetchRegistrarEmails(
  service: ReturnType<typeof createServiceClient>,
): Promise<string[]> {
  try {
    const { data, error } = await service.auth.admin.listUsers();
    if (error || !data) return [];
    return data.users
      .filter((u) => {
        const role =
          (u.app_metadata as { role?: string } | null)?.role ??
          (u.user_metadata as { role?: string } | null)?.role ??
          null;
        return role === 'registrar';
      })
      .map((u) => u.email ?? '')
      .filter(Boolean);
  } catch (e) {
    console.error('[change-requests] listUsers failed', e);
    return [];
  }
}

export async function fetchLabels(
  service: ReturnType<typeof createServiceClient>,
  sheetId: string,
  entryId: string,
): Promise<{ student_label: string | null; sheet_label: string | null }> {
  const [sheetRes, entryRes] = await Promise.all([
    service
      .from('grading_sheets')
      .select(
        `term:terms(label),
         section:sections(name, level:levels(label)),
         subject:subjects(name)`,
      )
      .eq('id', sheetId)
      .single(),
    service
      .from('grade_entries')
      .select(
        'section_student:section_students(student:students(student_number, first_name, last_name))',
      )
      .eq('id', entryId)
      .single(),
  ]);

  const sheetData = sheetRes.data as
    | {
        term: { label: string | null } | { label: string | null }[] | null;
        section:
          | {
              name: string | null;
              level: { label: string | null } | { label: string | null }[] | null;
            }
          | null;
        subject: { name: string | null } | { name: string | null }[] | null;
      }
    | null;
  const term = sheetData
    ? Array.isArray(sheetData.term)
      ? sheetData.term[0]
      : sheetData.term
    : null;
  const section = sheetData?.section ?? null;
  const level = section
    ? Array.isArray(section.level)
      ? section.level[0]
      : section.level
    : null;
  const subject = sheetData
    ? Array.isArray(sheetData.subject)
      ? sheetData.subject[0]
      : sheetData.subject
    : null;
  const sheetLabel =
    sheetData && subject && section
      ? `${level?.label ?? ''} ${section.name ?? ''} · ${subject.name ?? ''} · ${term?.label ?? ''}`.trim()
      : null;

  type StudentRef = {
    student_number: string | null;
    first_name: string | null;
    last_name: string | null;
  };
  type SectionStudentRef = { student: StudentRef | StudentRef[] | null };
  const entryData = entryRes.data as
    | { section_student: SectionStudentRef | SectionStudentRef[] | null }
    | null;
  const sectionStudent = entryData
    ? Array.isArray(entryData.section_student)
      ? entryData.section_student[0]
      : entryData.section_student
    : null;
  const student = sectionStudent
    ? Array.isArray(sectionStudent.student)
      ? sectionStudent.student[0]
      : sectionStudent.student
    : null;
  const studentLabel = student
    ? `${student.last_name ?? ''}, ${student.first_name ?? ''}`.trim() +
      ` (${student.student_number ?? '—'})`
    : null;

  return { student_label: studentLabel, sheet_label: sheetLabel };
}
