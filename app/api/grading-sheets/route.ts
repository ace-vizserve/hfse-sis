import { NextResponse, type NextRequest } from 'next/server';
import { requireRole } from '@/lib/auth/require-role';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { loadAssignmentsForUser, subjectTeacherPairs } from '@/lib/auth/teacher-assignments';
import { logAction } from '@/lib/audit/log-action';

// GET /api/grading-sheets?term_id=...
// Lists grading sheets for the current AY (or a specific term).
// Teachers only see sheets matching their (section, subject) assignments.
// Managers (registrar/admin/superadmin) see everything.
export async function GET(request: NextRequest) {
  const auth = await requireRole(['teacher', 'registrar', 'school_admin', 'admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const supabase = await createClient();
  const termId = request.nextUrl.searchParams.get('term_id');
  const role = auth.role;

  let query = supabase
    .from('grading_sheets')
    .select(
      `id, teacher_name, is_locked, ww_totals, pt_totals, qa_total, section_id, subject_id,
       term:terms(id, term_number, label),
       subject:subjects(id, code, name, is_examinable),
       section:sections(id, name, level:levels(id, code, label, level_type))`,
    )
    .order('id');

  if (termId) query = query.eq('term_id', termId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let sheets = data ?? [];

  // Teachers: filter to assigned (section, subject) pairs.
  if (role === 'teacher') {
    const assignments = await loadAssignmentsForUser(supabase, auth.user.id);
    const pairs = subjectTeacherPairs(assignments);
    const allowed = new Set(pairs.map(p => `${p.section_id}::${p.subject_id}`));
    sheets = sheets.filter(s => allowed.has(`${s.section_id}::${s.subject_id}`));
  }

  return NextResponse.json({ sheets });
}

// POST /api/grading-sheets
// Creates a sheet for (term, section, subject) and seeds one grade_entries row
// per active / late_enrollee student in the section.
export async function POST(request: NextRequest) {
  const auth = await requireRole(['registrar', 'school_admin', 'admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const body = (await request.json().catch(() => null)) as
    | {
        term_id?: string;
        section_id?: string;
        subject_id?: string;
        ww_totals?: number[];
        pt_totals?: number[];
        qa_total?: number | null;
        teacher_name?: string | null;
      }
    | null;
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 });

  const { term_id, section_id, subject_id } = body;
  if (!term_id || !section_id || !subject_id) {
    return NextResponse.json(
      { error: 'term_id, section_id, subject_id are required' },
      { status: 400 },
    );
  }
  const ww_totals = Array.isArray(body.ww_totals) ? body.ww_totals : [];
  const pt_totals = Array.isArray(body.pt_totals) ? body.pt_totals : [];
  const qa_total = body.qa_total ?? null;
  if (ww_totals.some(v => typeof v !== 'number' || v <= 0)) {
    return NextResponse.json({ error: 'ww_totals must be positive numbers' }, { status: 400 });
  }
  if (pt_totals.some(v => typeof v !== 'number' || v <= 0)) {
    return NextResponse.json({ error: 'pt_totals must be positive numbers' }, { status: 400 });
  }

  const service = createServiceClient();

  // Resolve section → level → academic_year, then look up subject_config.
  const { data: section, error: secErr } = await service
    .from('sections')
    .select('id, level_id, academic_year_id')
    .eq('id', section_id)
    .single();
  if (secErr || !section) {
    return NextResponse.json({ error: 'section not found' }, { status: 404 });
  }

  const { data: config, error: cfgErr } = await service
    .from('subject_configs')
    .select('id, ww_max_slots, pt_max_slots, ww_weight, pt_weight, qa_weight')
    .eq('academic_year_id', section.academic_year_id)
    .eq('subject_id', subject_id)
    .eq('level_id', section.level_id)
    .maybeSingle();
  if (cfgErr) return NextResponse.json({ error: cfgErr.message }, { status: 500 });
  if (!config) {
    return NextResponse.json(
      { error: 'no subject_config for this subject × level × academic year' },
      { status: 400 },
    );
  }
  if (ww_totals.length > config.ww_max_slots) {
    return NextResponse.json(
      { error: `too many WW slots (max ${config.ww_max_slots})` },
      { status: 400 },
    );
  }
  if (pt_totals.length > config.pt_max_slots) {
    return NextResponse.json(
      { error: `too many PT slots (max ${config.pt_max_slots})` },
      { status: 400 },
    );
  }

  // Insert the sheet.
  const { data: sheet, error: sheetErr } = await service
    .from('grading_sheets')
    .insert({
      term_id,
      section_id,
      subject_id,
      subject_config_id: config.id,
      teacher_name: body.teacher_name ?? null,
      ww_totals,
      pt_totals,
      qa_total,
    })
    .select('id')
    .single();
  if (sheetErr || !sheet) {
    // Unique(term_id, section_id, subject_id) likely hit.
    return NextResponse.json(
      { error: sheetErr?.message ?? 'failed to create sheet' },
      { status: 400 },
    );
  }

  // Seed grade_entries for every active / late_enrollee student in the section.
  const { data: enrolments, error: enrErr } = await service
    .from('section_students')
    .select('id, enrollment_status')
    .eq('section_id', section_id)
    .in('enrollment_status', ['active', 'late_enrollee']);
  if (enrErr) return NextResponse.json({ error: enrErr.message }, { status: 500 });

  if (enrolments && enrolments.length > 0) {
    const { error: entriesErr } = await service.from('grade_entries').insert(
      enrolments.map(e => ({
        grading_sheet_id: sheet.id,
        section_student_id: e.id,
        is_na: e.enrollment_status === 'late_enrollee',
      })),
    );
    if (entriesErr) {
      return NextResponse.json({ error: entriesErr.message }, { status: 500 });
    }
  }

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'sheet.create',
    entityType: 'grading_sheet',
    entityId: sheet.id,
    context: {
      term_id,
      section_id,
      subject_id,
      ww_totals,
      pt_totals,
      qa_total,
      entries_seeded: enrolments?.length ?? 0,
    },
  });

  return NextResponse.json({ id: sheet.id });
}
