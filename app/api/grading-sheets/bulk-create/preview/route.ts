import { NextResponse, type NextRequest } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { buildGradingSheetScopes } from '@/lib/markbook/grading-sheet-scope';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/grading-sheets/bulk-create/preview
//
// Read-only dry run for the Generate Sheets dialog (Phase 4 — AY-Setup
// redesign). Same scope resolution + the same buildGradingSheetScopes
// builder as the real POST /api/grading-sheets/bulk-create, so "what the
// preview shows" and "what generate actually creates" can never drift
// (count == drill, KD #124/#128 discipline). Never writes.
//
// Body: { ay_id: uuid, section_ids?: uuid[], term_ids?: uuid[] }.
// AY-scoped only (the dialog always starts from an AY — a lone section's
// own header button still goes straight to the confirm-and-generate POST,
// it doesn't need a picker).
export async function POST(request: NextRequest) {
  const auth = await requireRole(['registrar', 'school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const body = (await request.json().catch(() => null)) as {
    ay_id?: string;
    section_ids?: string[];
    term_ids?: string[];
  } | null;

  const ayId = body?.ay_id;
  if (!ayId) {
    return NextResponse.json({ error: 'ay_id required' }, { status: 400 });
  }

  const service = createServiceClient();

  let sectionsQuery = service
    .from('sections')
    .select('id, name, level_id, levels(label)')
    .eq('academic_year_id', ayId);
  if (Array.isArray(body?.section_ids) && body.section_ids.length > 0) {
    sectionsQuery = sectionsQuery.in('id', body.section_ids);
  }

  let termsQuery = service
    .from('terms')
    .select('id, label, term_number')
    .eq('academic_year_id', ayId)
    .order('term_number', { ascending: true });
  if (Array.isArray(body?.term_ids) && body.term_ids.length > 0) {
    termsQuery = termsQuery.in('id', body.term_ids);
  }

  const [{ data: sectionRows }, { data: termRows }] = await Promise.all([
    sectionsQuery,
    termsQuery,
  ]);

  type TermRow = { id: string; label: string; term_number: number };
  const termsOut = ((termRows ?? []) as TermRow[]).map((t) => ({
    id: t.id,
    label: t.label,
    termNumber: t.term_number,
  }));

  type SectionRow = {
    id: string;
    name: string;
    level_id: string;
    levels: { label: string } | { label: string }[] | null;
  };
  const sections = (sectionRows ?? []) as SectionRow[];
  const terms = (termRows ?? []) as Array<{ id: string }>;

  if (sections.length === 0) {
    return NextResponse.json({
      ok: true,
      sections: [],
      subjects: [],
      terms: termsOut,
      totals: { toCreate: 0, alreadyExists: 0 },
    });
  }

  const levelIds = [...new Set(sections.map((s) => s.level_id))];
  const sectionIds = sections.map((s) => s.id);

  const [{ data: configRows }, { data: assignmentRows }] = await Promise.all([
    service
      .from('subject_configs')
      .select(
        'id, subject_id, level_id, ww_weight, pt_weight, qa_weight, ww_max_slots, pt_max_slots, qa_max, subject:subjects(code, name)'
      )
      .eq('academic_year_id', ayId)
      .in('level_id', levelIds),
    service
      .from('section_subjects')
      .select('section_id, subject_config_id')
      .in('section_id', sectionIds),
  ]);

  type ConfigRow = {
    id: string;
    subject_id: string;
    level_id: string;
    ww_weight: number;
    pt_weight: number;
    qa_weight: number;
    ww_max_slots: number;
    pt_max_slots: number;
    qa_max: number;
    subject:
      | { code: string; name: string }
      | { code: string; name: string }[]
      | null;
  };
  const configs = (configRows ?? []) as ConfigRow[];
  const assignments = (assignmentRows ?? []) as Array<{
    section_id: string;
    subject_config_id: string;
  }>;

  const scopes =
    terms.length > 0
      ? buildGradingSheetScopes(
          sections.map((s) => ({ id: s.id, level_id: s.level_id })),
          configs.map((c) => ({
            id: c.id,
            subject_id: c.subject_id,
            level_id: c.level_id,
          })),
          assignments,
          terms
        )
      : [];

  // Which of the in-scope sheets already exist — same unique key
  // (term_id, section_id, subject_id) the RPC's ON CONFLICT relies on.
  const existingKeys = new Set<string>();
  if (scopes.length > 0) {
    const { data: existingSheets } = await service
      .from('grading_sheets')
      .select('term_id, section_id, subject_id')
      .in('section_id', sectionIds)
      .in(
        'term_id',
        terms.map((t) => t.id)
      );
    for (const row of (existingSheets ?? []) as Array<{
      term_id: string;
      section_id: string;
      subject_id: string;
    }>) {
      existingKeys.add(`${row.term_id}|${row.section_id}|${row.subject_id}`);
    }
  }

  const levelLabelBySection = new Map<string, string>();
  for (const s of sections) {
    const lvl = Array.isArray(s.levels) ? s.levels[0] : s.levels;
    levelLabelBySection.set(s.id, lvl?.label ?? '—');
  }

  const sectionStats = new Map<
    string,
    { subjectIds: Set<string>; toCreate: number; alreadyExists: number }
  >();
  for (const s of sections) {
    sectionStats.set(s.id, {
      subjectIds: new Set(),
      toCreate: 0,
      alreadyExists: 0,
    });
  }
  let totalToCreate = 0;
  let totalAlreadyExists = 0;
  for (const scope of scopes) {
    const stat = sectionStats.get(scope.section_id);
    if (!stat) continue;
    stat.subjectIds.add(scope.subject_id);
    const exists = existingKeys.has(
      `${scope.term_id}|${scope.section_id}|${scope.subject_id}`
    );
    if (exists) {
      stat.alreadyExists += 1;
      totalAlreadyExists += 1;
    } else {
      stat.toCreate += 1;
      totalToCreate += 1;
    }
  }

  const sectionsOut = sections
    .map((s) => {
      const stat = sectionStats.get(s.id)!;
      return {
        id: s.id,
        name: s.name,
        levelLabel: levelLabelBySection.get(s.id) ?? '—',
        subjectCount: stat.subjectIds.size,
        toCreate: stat.toCreate,
        alreadyExists: stat.alreadyExists,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  // Union of subjects actually in scope (assigned to at least one selected
  // section) — the read-only weights summary. Sourced from subject_configs,
  // never edited here (KD #4 — single per-level source of truth).
  const subjectIdsInScope = new Set(scopes.map((sc) => sc.subject_id));
  const subjectsOut = configs
    .filter((c) => subjectIdsInScope.has(c.subject_id))
    .map((c) => {
      const subj = Array.isArray(c.subject) ? c.subject[0] : c.subject;
      return {
        subjectConfigId: c.id,
        code: subj?.code ?? '—',
        name: subj?.name ?? '—',
        wwSlots: c.ww_max_slots,
        ptSlots: c.pt_max_slots,
        qaMax: c.qa_max,
        wwWeight: c.ww_weight,
        ptWeight: c.pt_weight,
        qaWeight: c.qa_weight,
      };
    })
    // De-dupe by subject code (the same subject can have multiple configs
    // across different levels in scope — show it once per code).
    .filter((s, i, arr) => arr.findIndex((x) => x.code === s.code) === i)
    .sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({
    ok: true,
    sections: sectionsOut,
    terms: termsOut,
    subjects: subjectsOut,
    totals: { toCreate: totalToCreate, alreadyExists: totalAlreadyExists },
  });
}
