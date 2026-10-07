import { revalidateTag } from 'next/cache';
import { NextResponse, type NextRequest } from 'next/server';
import { requireRole } from '@/lib/auth/require-role';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { subjectDisplayName } from '@/lib/sis/subjects/display-name';
import { logAction } from '@/lib/audit/log-action';
import { loadOneSheetAuditLabels } from '@/lib/grading/sheet-audit-labels';
import {
  BEST_TERM_SYSTEM_ACTOR,
  loadSheetRemovability,
} from '@/lib/grading/sheet-removal';
import { isTerm4Framework } from '@/lib/grading/term4-framework';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';

// GET /api/grading-sheets/[id]
// Returns the full sheet: config, section+level, term, subject, and all
// grade_entries joined to section_students + students, ordered by index.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole([
    'teacher',
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const supabase = await createClient();

  const { data: sheet, error: sheetErr } = await supabase
    .from('grading_sheets')
    .select(
      `id, teacher_name, is_locked, ww_totals, pt_totals, qa_total,
       term:terms(id, term_number, label),
       subject:subjects(id, code, name, is_examinable),
       section:sections(id, name, level:levels(id, code, label, level_type)),
       ww_weight, pt_weight, qa_weight,
       subject_config:subject_configs(display_name, ww_weight, pt_weight, qa_weight, ww_max_slots, pt_max_slots)`
    )
    .eq('id', id)
    .single();
  if (sheetErr || !sheet) {
    return NextResponse.json({ error: 'sheet not found' }, { status: 404 });
  }

  const { data: entries, error: entErr } = await supabase
    .from('grade_entries')
    .select(
      `id, ww_scores, pt_scores, qa_score,
       ww_ps, pt_ps, qa_ps, initial_grade, quarterly_grade,
       letter_grade, is_na,
       section_student:section_students(
         id, index_number, enrollment_status,
         student:students(student_number, last_name, first_name, middle_name)
       )`
    )
    .eq('grading_sheet_id', id);
  if (entErr)
    return NextResponse.json({ error: entErr.message }, { status: 500 });

  // Sort by index_number client-side since the join doesn't order.
  type EntryRow = typeof entries extends (infer U)[] | null ? U : never;
  const sorted = ((entries ?? []) as EntryRow[]).slice().sort((a, b) => {
    const ai = Array.isArray(a.section_student)
      ? a.section_student[0]
      : a.section_student;
    const bi = Array.isArray(b.section_student)
      ? b.section_student[0]
      : b.section_student;
    return (ai?.index_number ?? 0) - (bi?.index_number ?? 0);
  });

  // Resolve the subject's name for THIS sheet's academic year before the
  // payload leaves (migration 137). Doing it here rather than leaving it to
  // each consumer is what stops the API and the page it feeds disagreeing —
  // and the config carrying the name is the same row the weights come from,
  // so it costs nothing.
  const one = <T>(v: T | T[] | null | undefined): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
  type SubjectLite = { id: string; code: string; name: string };
  type ConfigLite = { display_name: string | null };
  const raw = sheet as unknown as {
    subject: SubjectLite | SubjectLite[] | null;
    subject_config: ConfigLite | ConfigLite[] | null;
  };
  const subj = one(raw.subject);
  const sheetOut = subj
    ? {
        ...sheet,
        subject: {
          ...subj,
          name: subjectDisplayName(subj, one(raw.subject_config)),
        },
      }
    : sheet;

  return NextResponse.json({ sheet: sheetOut, entries: sorted });
}

// DELETE /api/grading-sheets/[id] — remove a sheet NOTHING was ever entered on.
//
// Mr Ace, 2026-09-29: "theres no way to un-attach a grading sheet to a
// section". Same audience as creating one (POST /api/grading-sheets) and as
// editing its totals. The rule lives in `lib/grading/sheet-removal.ts`: refused
// when the sheet is locked, when any row holds anything (a 0 included — Hard
// Rule #3), or when the sheet has any grade history or change request. Grade
// entries with a value are never deleted (Hard Rule #6); only a sheet whose
// rows are all blank goes, rows and all, with one audit row saying what it was.
//
// ⚠ NO TRANSACTION IN SUPABASE-JS, SO THE ORDER IS THE SAFETY. The blank rows
// go first, and only rows that are STILL blank (the filter below), then the
// sheet. `grade_entries` and `grade_audit_log` both reference the sheet with
// ON DELETE RESTRICT, so if a teacher typed a first score between the check and
// the delete — a new row, or a row the filter kept — the sheet delete fails and
// the sheet stays, with its marks. The worst a failure leaves is a sheet
// missing some blank rows, which the grid does not need (it lists the roster,
// migration 156).
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole([
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const { id: sheetId } = await params;
  const service = createServiceClient();

  const { data: sheet, error: sheetErr } = await service
    .from('grading_sheets')
    .select(
      'id, is_locked, sheet_type, term_id, section_id, subject_id, section:sections(academic_year_id)'
    )
    .eq('id', sheetId)
    .maybeSingle();
  if (sheetErr)
    return NextResponse.json({ error: sheetErr.message }, { status: 500 });
  if (!sheet)
    return NextResponse.json({ error: 'sheet not found' }, { status: 404 });

  let verdict;
  try {
    verdict = (
      await loadSheetRemovability(service, [
        {
          id: sheet.id,
          is_locked: sheet.is_locked,
          sheet_type: sheet.sheet_type,
        },
      ])
    ).get(sheet.id);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'could not check the sheet' },
      { status: 500 }
    );
  }
  if (!verdict)
    return NextResponse.json(
      { error: 'could not check the sheet' },
      { status: 500 }
    );
  if (!verdict.removable) {
    return NextResponse.json(
      { error: verdict.reason, code: `sheet_${verdict.block}` },
      { status: 409 }
    );
  }

  // Snapshot what the sheet WAS before it goes — after the delete there is
  // nothing left to look the labels up from.
  const labels = await loadOneSheetAuditLabels(service, sheet.id);
  const section = (
    Array.isArray(sheet.section) ? sheet.section[0] : sheet.section
  ) as { academic_year_id: string } | null;
  let ayCode: string | null = null;
  if (section?.academic_year_id) {
    const { data: ayRow } = await service
      .from('academic_years')
      .select('ay_code')
      .eq('id', section.academic_year_id)
      .maybeSingle();
    ayCode = (ayRow as { ay_code: string } | null)?.ay_code ?? null;
  }

  const actor = {
    id: auth.user.id,
    email: auth.user.email ?? null,
    role: auth.role,
  };
  const baseContext = {
    ...labels,
    term_id: sheet.term_id,
    section_id: sheet.section_id,
    subject_id: sheet.subject_id,
    academic_year_id: section?.academic_year_id ?? null,
    ay_code: ayCode,
    // Blank rows the sheet carried when it was checked.
    entry_rows: verdict.entryCount,
    entries_removed: 0,
  };

  // A Term 4 framework sheet (KD #230): the database fills the WW slot (the
  // best term average) and so the derived figures, and records each change
  // to that slot in `grade_audit_log` as 'system: best term average'. Those
  // rows hold the sheet and its entries by FK, so they go first — their
  // content is kept in the `sheet.delete` audit row below.
  const framework = isTerm4Framework(sheet.sheet_type);
  let systemRowsRemoved: unknown[] = [];
  if (framework) {
    const { data: sysRows, error: sysErr } = await service
      .from('grade_audit_log')
      .delete()
      .eq('grading_sheet_id', sheet.id)
      .eq('changed_by', BEST_TERM_SYSTEM_ACTOR)
      .select(
        'grade_entry_id, field_changed, old_value, new_value, approval_reference, changed_at'
      );
    if (sysErr)
      return NextResponse.json({ error: sysErr.message }, { status: 500 });
    systemRowsRemoved = sysRows ?? [];
  }
  const systemContext = framework
    ? { system_audit_rows_removed: systemRowsRemoved }
    : {};

  // Blank rows only — belt and braces over the check above. A row that gained
  // a score since is left in place, and its FK then refuses the sheet delete.
  // `is_na` is NOT filtered: it is seeded true for late enrollees, and a
  // person's N/A leaves history the check above already refused on.
  // On a framework sheet only what a person writes is filtered: the
  // recommendation (pt_ps follows it), the exam and a letter.
  let entryDelete = service
    .from('grade_entries')
    .delete()
    .eq('grading_sheet_id', sheet.id)
    .is('pt_ps', null)
    .is('qa_score', null)
    .is('letter_grade', null);
  if (!framework)
    entryDelete = entryDelete
      .is('ww_ps', null)
      .is('initial_grade', null)
      .is('quarterly_grade', null);
  const { data: removedRows, error: entErr } = await entryDelete.select('id');
  if (entErr) {
    if (systemRowsRemoved.length > 0)
      await logAction({
        service,
        actor,
        action: 'sheet.delete',
        entityType: 'grading_sheet',
        entityId: sheet.id,
        context: {
          ...baseContext,
          ...systemContext,
          partial: true,
          failed_step: 'delete_entries',
          error: entErr.message,
        },
      });
    return NextResponse.json({ error: entErr.message }, { status: 500 });
  }
  const entriesRemoved = (removedRows ?? []).length;

  const { error: delErr } = await service
    .from('grading_sheets')
    .delete()
    .eq('id', sheet.id);
  if (delErr) {
    // Something now references the sheet — most likely a score typed in the
    // last second. The sheet stays; say what was taken off it.
    if (entriesRemoved > 0 || systemRowsRemoved.length > 0) {
      await logAction({
        service,
        actor,
        action: 'sheet.delete',
        entityType: 'grading_sheet',
        entityId: sheet.id,
        context: {
          ...baseContext,
          ...systemContext,
          entries_removed: entriesRemoved,
          partial: true,
          failed_step: 'delete_sheet',
          error: delErr.message,
        },
      });
    }
    return NextResponse.json(
      {
        error:
          delErr.code === '23503'
            ? 'Scores were entered on this sheet just now, so it wasn’t removed.'
            : delErr.message,
      },
      { status: delErr.code === '23503' ? 409 : 500 }
    );
  }

  await logAction({
    service,
    actor,
    action: 'sheet.delete',
    entityType: 'grading_sheet',
    entityId: sheet.id,
    context: {
      ...baseContext,
      ...systemContext,
      entries_removed: entriesRemoved,
    },
  });

  // What creating one busts (POST /api/grading-sheets + bulk-create): the
  // markbook drills, and SIS — subject setup lists each class's sheets.
  if (ayCode) {
    invalidateDrillTags('markbook', ayCode);
    revalidateTag(`sis:${ayCode}`, 'max');
  }

  return NextResponse.json({ ok: true, entries_removed: entriesRemoved });
}
