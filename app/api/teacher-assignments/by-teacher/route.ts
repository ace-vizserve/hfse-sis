import { NextResponse, type NextRequest } from 'next/server';

import { requireCapability } from '@/lib/auth/require-capability';
import { createServiceClient } from '@/lib/supabase/service';
import { hasTermStarted } from '@/lib/sis/current-term';
import { sgToday } from '@/lib/dates';

type RawSection = {
  id: string;
  name: string;
  levels: { code: string } | { code: string }[] | null;
};

type RawAssignment = {
  id: string;
  section_id: string;
  subject_id: string | null;
  role: string;
  subjects:
    | { code: string; name: string }
    | { code: string; name: string }[]
    | null;
  sections: { name: string } | { name: string }[] | null;
};

// GET /api/teacher-assignments/by-teacher?teacherId=<uuid>&ayCode=AY2026
// Returns the teacher's current assignments + all sections + all subjects
// for the current AY. Used by the StaffAssignmentSheet to populate pickers.
export async function GET(request: NextRequest) {
  const auth = await requireCapability('staff.read');
  if ('error' in auth) return auth.error;

  const teacherId = request.nextUrl.searchParams.get('teacherId');
  const ayCode = request.nextUrl.searchParams.get('ayCode');
  if (!teacherId || !ayCode) {
    return NextResponse.json(
      { error: 'teacherId and ayCode are required' },
      { status: 400 }
    );
  }

  const service = createServiceClient();

  const { data: ayRow } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode)
    .maybeSingle();
  if (!ayRow) {
    return NextResponse.json({ error: 'AY not found' }, { status: 404 });
  }
  const ayId = (ayRow as { id: string }).id;

  // Has this AY's first term begun? The staff sheet uses it to decide whether
  // removing an assignment has to be explained (same gate as the DELETE route).
  const { data: termRows } = await service
    .from('terms')
    .select('start_date')
    .eq('academic_year_id', ayId);
  const termStarted = hasTermStarted(termRows ?? [], sgToday());

  // All sections for this AY (needed for pickers)
  const { data: sectionRows } = await service
    .from('sections')
    .select('id, name, levels(code)')
    .eq('academic_year_id', ayId)
    .order('name');

  const allSections = (sectionRows ?? []).map((s) => {
    const raw = s as RawSection;
    const levelCode = Array.isArray(raw.levels)
      ? (raw.levels[0]?.code ?? '')
      : (raw.levels?.code ?? '');
    return { id: raw.id, name: raw.name, levelCode };
  });

  const sectionIds = allSections.map((s) => s.id);

  // All subjects (needed for picker)
  const { data: subjectRows } = await service
    .from('subjects')
    .select('id, code, name')
    .order('code');
  const allSubjects = (subjectRows ?? []) as Array<{
    id: string;
    code: string;
    name: string;
  }>;

  // This teacher's assignments in this AY
  const { data: assignmentRows } = await service
    .from('teacher_assignments')
    .select(
      'id, section_id, subject_id, role, subjects(code, name), sections(name)'
    )
    .eq('teacher_user_id', teacherId)
    .in(
      'section_id',
      sectionIds.length > 0
        ? sectionIds
        : ['00000000-0000-0000-0000-000000000000']
    );

  const assignments = (assignmentRows ?? []) as RawAssignment[];

  // ALL of them, not the first.
  //
  // `teacher_assignments_form_adviser_unique` is on `(section_id)` alone
  // (migration 003), so it enforces one adviser PER SECTION and says nothing
  // about how many sections one teacher may advise. This used to `.find()` the
  // first row, which showed a two-class adviser only one of their classes —
  // and, worse, the drawer's change flow deleted the id it happened to be
  // holding, stranding the other.
  const fcaAssignments = assignments
    .filter((a) => a.role === 'form_adviser')
    .map((a) => {
      const sec = Array.isArray(a.sections) ? a.sections[0] : a.sections;
      return {
        id: a.id,
        sectionId: a.section_id,
        sectionName: sec?.name ?? '',
      };
    })
    .sort((x, y) => x.sectionName.localeCompare(y.sectionName));

  const subjectAssignments = assignments
    .filter((a) => a.role === 'subject_teacher')
    .map((a) => {
      const sub = Array.isArray(a.subjects) ? a.subjects[0] : a.subjects;
      const sec = Array.isArray(a.sections) ? a.sections[0] : a.sections;
      return {
        id: a.id,
        subjectId: a.subject_id ?? '',
        subjectCode: sub?.code ?? '',
        subjectName: sub?.name ?? '',
        sectionId: a.section_id,
        sectionName: sec?.name ?? '',
      };
    });

  return NextResponse.json({
    fcaAssignments,
    subjectAssignments,
    allSections,
    allSubjects,
    termStarted,
  });
}
