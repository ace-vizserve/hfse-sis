import type { SupabaseClient } from '@supabase/supabase-js';

import { subjectDisplayName } from '@/lib/sis/subjects/display-name';

// The words an audit row needs to say WHICH grading sheet it is about.
//
// A sheet id on its own tells a reader nothing — "Sheet locked" with a uuid
// cannot be answered without a database. Every sheet-level audit row (create,
// lock, unlock, labels, totals, the overdue sweep) carries these keys so the
// activity views can say "P5 Diamond · Maths · Term 2" on their own.
//
// The subject is named the way THAT sheet's year names it (migration 137), and
// the words are frozen into the row at the time: an audit row keeps the name
// that was in use when the thing happened.
//
// Never throws. A failed lookup leaves the row with ids only, which is what it
// had before — the write it describes has already happened and must still be
// logged.

export type SheetAuditLabels = {
  subject_code: string | null;
  subject_name: string | null;
  section_name: string | null;
  level_label: string | null;
  term_label: string | null;
  term_number: number | null;
};

type One<T> = T | T[] | null;
const one = <T>(v: One<T> | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

type SheetLabelRow = {
  id: string;
  term: One<{ label: string | null; term_number: number | null }>;
  section: One<{
    name: string | null;
    level: One<{ label: string | null }>;
  }>;
  subject: One<{ code: string | null; name: string | null }>;
  subject_config: One<{ display_name: string | null }>;
};

/** PostgREST puts `.in()` in the URL; 200 uuids stays well under its limit. */
const CHUNK = 200;

export function toSheetAuditLabels(row: SheetLabelRow): SheetAuditLabels {
  const term = one(row.term);
  const section = one(row.section);
  const level = section ? one(section.level) : null;
  const subject = one(row.subject);
  const config = one(row.subject_config);
  return {
    subject_code: subject?.code ?? null,
    subject_name: subject
      ? subjectDisplayName({ name: subject.name ?? '' }, config) || null
      : null,
    section_name: section?.name ?? null,
    level_label: level?.label ?? null,
    term_label: term?.label ?? null,
    term_number: term?.term_number ?? null,
  };
}

export async function loadSheetAuditLabels(
  service: SupabaseClient,
  sheetIds: string[]
): Promise<Map<string, SheetAuditLabels>> {
  const out = new Map<string, SheetAuditLabels>();
  const ids = [...new Set(sheetIds)];
  try {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data, error } = await service
        .from('grading_sheets')
        .select(
          `id,
           term:terms(label, term_number),
           section:sections(name, level:levels(label)),
           subject:subjects(code, name),
           subject_config:subject_configs(display_name)`
        )
        .in('id', ids.slice(i, i + CHUNK));
      if (error) {
        console.error('[audit] sheet labels lookup failed:', error.message);
        return out;
      }
      for (const row of (data ?? []) as unknown as SheetLabelRow[]) {
        out.set(row.id, toSheetAuditLabels(row));
      }
    }
  } catch (e) {
    console.error(
      '[audit] sheet labels lookup threw:',
      e instanceof Error ? e.message : String(e)
    );
  }
  return out;
}

/** One sheet's labels, or an empty object so a spread adds nothing. */
export async function loadOneSheetAuditLabels(
  service: SupabaseClient,
  sheetId: string
): Promise<SheetAuditLabels | Record<string, never>> {
  const map = await loadSheetAuditLabels(service, [sheetId]);
  return map.get(sheetId) ?? {};
}

// ── Which child an entry belongs to ──────────────────────────────────────

export type StudentAuditLabels = {
  student_number: string | null;
  student_name: string | null;
};

type EntryStudentRow = {
  id: string;
  section_student: One<{
    student: One<{
      student_number: string | null;
      first_name: string | null;
      last_name: string | null;
    }>;
  }>;
};

/** Grade entry id → the child it belongs to. Never throws. */
export async function loadEntryStudentLabels(
  service: SupabaseClient,
  entryIds: string[]
): Promise<Map<string, StudentAuditLabels>> {
  const out = new Map<string, StudentAuditLabels>();
  const ids = [...new Set(entryIds)];
  try {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data, error } = await service
        .from('grade_entries')
        .select(
          'id, section_student:section_students(student:students(student_number, first_name, last_name))'
        )
        .in('id', ids.slice(i, i + CHUNK));
      if (error) {
        console.error('[audit] student labels lookup failed:', error.message);
        return out;
      }
      for (const row of (data ?? []) as unknown as EntryStudentRow[]) {
        const student = one(one(row.section_student)?.student);
        out.set(row.id, {
          student_number: student?.student_number ?? null,
          student_name: student
            ? `${student.last_name ?? ''}, ${student.first_name ?? ''}`.trim()
            : null,
        });
      }
    }
  } catch (e) {
    console.error(
      '[audit] student labels lookup threw:',
      e instanceof Error ? e.message : String(e)
    );
  }
  return out;
}
