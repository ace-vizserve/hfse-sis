import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { logAction } from '@/lib/audit/log-action';
import type { Role } from '@/lib/auth/roles';
import { loadEffectiveAssignmentsForUser } from '@/lib/auth/teacher-assignments';
import {
  type CreateSowInput,
  type SowSnapshot,
  SowSnapshotSchema,
} from '@/lib/schemas/sow';
import { isSubjectRole } from '@/lib/schemas/teacher-assignment';
import type { SowKey } from '@/lib/sow/access';
import { loadTermWeeks, reconcileWeeks } from '@/lib/sow/weeks';

// Creating a scheme of work (SOW), blank or copied from last year.
//
// Who may: a teacher who HOLDS the subject (subject teacher or co-teacher, not
// relief cover) on at least one of the ticked classes. The role does not
// matter — an office user who also teaches qualifies by the assignment, and
// one who does not is refused.
//
// Dates are never copied. Every week row takes this year's dates from
// `loadTermWeeks`, and last year's content hangs on the week NUMBER.

export type SowActor = {
  id: string;
  email: string | null;
  role?: Role | null;
};

export type CreateSowResult =
  | { ok: true; sowId: string }
  | { ok: false; status: 400 | 403 | 409; error: string };

const DUPLICATE_KEY_MESSAGE =
  'A scheme of work already exists for this subject, level and track this term.';

const fail = (
  status: 400 | 403 | 409,
  error: string
): { ok: false; status: 400 | 403 | 409; error: string } => ({
  ok: false,
  status,
  error,
});

type LastYear = { id: string; label: string; snapshot: unknown };

/**
 * Last year's APPROVED scheme for the same term number, subject, level and
 * track. "Last year" is the academic year with the next-lower `ay_code` (the
 * ordering the rest of the app uses for years).
 */
async function loadLastYear(
  service: SupabaseClient,
  key: SowKey
): Promise<LastYear | null> {
  const { data: term, error: termErr } = await service
    .from('terms')
    .select('academic_year_id, term_number')
    .eq('id', key.termId)
    .maybeSingle();
  if (termErr) throw new Error(termErr.message);
  if (!term) return null;
  const { academic_year_id: ayId, term_number: termNumber } = term as {
    academic_year_id: string;
    term_number: number;
  };

  const { data: years, error: yearsErr } = await service
    .from('academic_years')
    .select('id, ay_code, label');
  if (yearsErr) throw new Error(yearsErr.message);
  const all = (years ?? []) as { id: string; ay_code: string; label: string }[];
  const current = all.find((y) => y.id === ayId);
  if (!current) return null;
  const previous = all
    .filter((y) => y.ay_code < current.ay_code)
    .sort((a, b) => b.ay_code.localeCompare(a.ay_code))[0];
  if (!previous) return null;

  const { data: priorTerm, error: priorErr } = await service
    .from('terms')
    .select('id, label')
    .eq('academic_year_id', previous.id)
    .eq('term_number', termNumber)
    .maybeSingle();
  if (priorErr) throw new Error(priorErr.message);
  if (!priorTerm) return null;

  const { data: sow, error: sowErr } = await service
    .from('schemes_of_work')
    .select('id, approved_snapshot')
    .eq('term_id', (priorTerm as { id: string }).id)
    .eq('subject_id', key.subjectId)
    .eq('level_id', key.levelId)
    .eq('track', key.track)
    .eq('state', 'approved')
    .maybeSingle();
  if (sowErr) throw new Error(sowErr.message);
  if (!sow) return null;

  return {
    id: (sow as { id: string }).id,
    // "AY2025 Term 2": the year's code and the term number, which is how the
    // New SOW drawer names it. The stored labels read "Academic Year 2025" and
    // "Term 2 — AY2025", which together repeat the year.
    label: `${previous.ay_code} Term ${termNumber}`,
    snapshot: (sow as { approved_snapshot: unknown }).approved_snapshot,
  };
}

export async function findLastYearSow(
  service: SupabaseClient,
  key: SowKey
): Promise<{ id: string; label: string } | null> {
  const found = await loadLastYear(service, key);
  return found ? { id: found.id, label: found.label } : null;
}

type WeekContent = Partial<
  Pick<
    SowSnapshot['weeks'][number],
    | 'topic'
    | 'learningOutcomes'
    | 'textbookPages'
    | 'activities'
    | 'assessment'
    | 'remarks'
  >
>;

const contentColumns = (c: WeekContent | undefined) => ({
  topic: c?.topic ?? null,
  learning_outcomes: c?.learningOutcomes ?? null,
  textbook_pages: c?.textbookPages ?? null,
  activities: c?.activities ?? null,
  assessment: c?.assessment ?? null,
  remarks: c?.remarks ?? null,
});

export async function createSow(
  service: SupabaseClient,
  actor: SowActor,
  input: CreateSowInput
): Promise<CreateSowResult> {
  const { key, start } = input;
  const sectionIds = [...new Set(input.sectionIds)];

  // 1. Who: a substantive teacher of this subject on at least one ticked class.
  const assignments = await loadEffectiveAssignmentsForUser(service, actor.id);
  const holds = assignments.some(
    (a) =>
      a.via === 'substantive' &&
      a.teacher_user_id === actor.id &&
      isSubjectRole(a.role) &&
      a.subject_id === key.subjectId &&
      sectionIds.includes(a.section_id)
  );
  if (!holds) {
    return fail(
      403,
      'You can only start a scheme of work for a subject you teach, on a class you teach it to.'
    );
  }

  // 2. The term and the ticked classes.
  const { data: term, error: termErr } = await service
    .from('terms')
    .select('academic_year_id')
    .eq('id', key.termId)
    .maybeSingle();
  if (termErr) throw new Error(termErr.message);
  if (!term) return fail(400, 'That term could not be found.');
  const ayId = (term as { academic_year_id: string }).academic_year_id;

  const { data: sectionData, error: sectionErr } = await service
    .from('sections')
    .select('id, name, level_id, class_type, academic_year_id')
    .in('id', sectionIds);
  if (sectionErr) throw new Error(sectionErr.message);
  const sections = (sectionData ?? []) as {
    id: string;
    name: string;
    level_id: string;
    class_type: string | null;
    academic_year_id: string;
  }[];
  if (sections.length !== sectionIds.length) {
    return fail(400, 'One of the classes you ticked could not be found.');
  }
  for (const s of sections) {
    // A class with no class type is a Standard class.
    const track = s.class_type === 'Global' ? 'Global' : 'Standard';
    if (
      s.academic_year_id !== ayId ||
      s.level_id !== key.levelId ||
      track !== key.track
    ) {
      return fail(
        400,
        `${s.name} does not belong with this level and track, so it cannot be on this scheme of work.`
      );
    }
  }

  // 3. Nothing already there: the same key, or a ticked class already planned
  // under another scheme for this subject and term.
  const { data: sameTermData, error: sameTermErr } = await service
    .from('schemes_of_work')
    .select('id, level_id, track')
    .eq('term_id', key.termId)
    .eq('subject_id', key.subjectId);
  if (sameTermErr) throw new Error(sameTermErr.message);
  const sameTerm = (sameTermData ?? []) as {
    id: string;
    level_id: string;
    track: string;
  }[];
  if (
    sameTerm.some((s) => s.level_id === key.levelId && s.track === key.track)
  ) {
    return fail(409, DUPLICATE_KEY_MESSAGE);
  }
  // A race here needs no extra handling: a section has one level and one
  // class type, and every ticked section was just checked against the key's
  // level and track, so two schemes that could share a section share the whole
  // (term, subject, level, track) key. The loser of a race hits that unique key
  // on the schemes_of_work insert below (23505 -> the duplicate 409), before
  // any class row is written. scheme_of_work_classes is unique only on
  // (sow_id, section_id), so it cannot raise a cross-scheme conflict itself.
  if (sameTerm.length > 0) {
    const { data: takenData, error: takenErr } = await service
      .from('scheme_of_work_classes')
      .select('sow_id, section_id')
      .in(
        'sow_id',
        sameTerm.map((s) => s.id)
      )
      .in('section_id', sectionIds);
    if (takenErr) throw new Error(takenErr.message);
    const taken = (takenData ?? []) as { section_id: string }[];
    if (taken.length > 0) {
      const names = sections
        .filter((s) => taken.some((t) => t.section_id === s.id))
        .map((s) => s.name)
        .sort();
      return fail(
        409,
        `${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} already on another scheme of work for this subject this term.`
      );
    }
  }

  // 4. This year's weeks.
  const { weeks } = await loadTermWeeks(service, key.termId, key.levelId);
  const termWeeks = weeks.filter(
    (w): w is Extract<typeof w, { kind: 'week' }> => w.kind === 'week'
  );
  if (termWeeks.length === 0) {
    return fail(
      400,
      'This term has no teaching weeks yet. Ask the office to set the term dates and the school calendar first.'
    );
  }

  // 5. Work out the rows.
  let module: Record<string, unknown> = {};
  let copiedFrom: string | null = null;
  type WeekRow = ReturnType<typeof contentColumns> & {
    week_number: number;
    starts_on: string;
    ends_on: string;
  };
  let weekRows: WeekRow[];

  if (start === 'copy') {
    const last = await loadLastYear(service, key);
    if (!last) {
      return fail(
        400,
        'There is no approved scheme of work from last year to copy for this subject, level and track.'
      );
    }
    const parsed = SowSnapshotSchema.safeParse(last.snapshot);
    if (!parsed.success) {
      return fail(
        400,
        "Last year's scheme of work could not be read, so it cannot be copied. Start a blank one instead."
      );
    }
    const snapshot = parsed.data;
    module = snapshot.module;
    copiedFrom = last.id;

    const { kept, missing, surplus } = reconcileWeeks(
      snapshot.weeks,
      termWeeks
    );
    const lastTermWeek = termWeeks[termWeeks.length - 1];
    weekRows = [
      ...kept.map((w) => ({
        week_number: w.weekNumber,
        starts_on: w.startsOn,
        ends_on: w.endsOn,
        ...contentColumns(w),
      })),
      ...missing.map((n) => {
        const tw = termWeeks.find((w) => w.weekNumber === n)!;
        return {
          week_number: n,
          starts_on: tw.startsOn,
          ends_on: tw.endsOn,
          ...contentColumns(undefined),
        };
      }),
      // Weeks this term no longer reaches are kept, numbered after the last
      // term week, so the teacher can merge or delete them. They sit on the
      // last term week's dates to satisfy the date check; a number beyond the
      // term's week count is what marks them as surplus.
      ...[...surplus]
        .sort((a, b) => a.weekNumber - b.weekNumber)
        .map((w, i) => ({
          week_number: lastTermWeek.weekNumber + 1 + i,
          starts_on: lastTermWeek.startsOn,
          ends_on: lastTermWeek.endsOn,
          ...contentColumns(w),
        })),
    ].sort((a, b) => a.week_number - b.week_number);
  } else {
    weekRows = termWeeks.map((w) => ({
      week_number: w.weekNumber,
      starts_on: w.startsOn,
      ends_on: w.endsOn,
      ...contentColumns(undefined),
    }));
  }

  // 6. Write: scheme, then classes, then weeks. A failure after the scheme row
  // exists removes it (classes and weeks cascade), so nobody is left with a
  // half-made scheme.
  const { data: created, error: createErr } = await service
    .from('schemes_of_work')
    .insert({
      academic_year_id: ayId,
      term_id: key.termId,
      subject_id: key.subjectId,
      level_id: key.levelId,
      track: key.track,
      state: 'draft',
      module,
      started_from: start,
      copied_from_sow_id: copiedFrom,
      created_by: actor.id,
    })
    .select('id')
    .single();
  if (createErr) {
    if ((createErr as { code?: string }).code === '23505') {
      return fail(409, DUPLICATE_KEY_MESSAGE);
    }
    throw new Error(createErr.message);
  }
  const sowId = (created as { id: string }).id;

  try {
    const classes = await service
      .from('scheme_of_work_classes')
      .insert(sectionIds.map((section_id) => ({ sow_id: sowId, section_id })));
    if (classes.error) throw new Error(classes.error.message);

    const weekInsert = await service
      .from('scheme_of_work_weeks')
      .insert(weekRows.map((w) => ({ sow_id: sowId, ...w })));
    if (weekInsert.error) throw new Error(weekInsert.error.message);
  } catch (e) {
    const { error: cleanupErr } = await service
      .from('schemes_of_work')
      .delete()
      .eq('id', sowId);
    if (cleanupErr) {
      console.error(
        '[sow.create] could not remove a half-made scheme:',
        sowId,
        cleanupErr.message
      );
    }
    throw e;
  }

  await logAction({
    service,
    actor: { id: actor.id, email: actor.email, role: actor.role ?? null },
    action: 'sow.create',
    entityType: 'scheme_of_work',
    entityId: sowId,
    context: {
      started_from: start,
      copied_from_sow_id: copiedFrom,
      week_count: weekRows.length,
      class_count: sectionIds.length,
    },
  });

  return { ok: true, sowId };
}
