// Phase "classroom-notes" (plan phase 6): teachers' private class notes
// (Classroom Settings, migration 094). A live feature production has not used
// yet, so a few rows: three teachers, each on a class of their own.
//
// Write path: PATCH /api/classroom/[sectionId]/notes, mirrored (it gates on a
// cookie session): the body through `ClassroomNoteSchema`, the caller's
// classroom capability over the section (`loadClassroomAccess` — no
// relationship, no write), the caller's existing note, the upsert keyed on
// (section, the caller's own id), and — only when the content changed — the
// route's `classroom.note.save` audit row with the length, never the words.
//
// Idempotent as the route is: saving the same content again changes nothing
// and logs nothing — unless the note's audit row is missing (a run that died
// between the save and the log), which is then written.

import { logAction } from '@/lib/audit/log-action';
import type { Role } from '@/lib/auth/roles';
import { loadClassroomAccess } from '@/lib/classroom/queries';
import { proseLength } from '@/lib/rich-text';
import { ClassroomNoteSchema } from '@/lib/schemas/classroom';

import { must, service, sqlRows } from '../lib/local';

type Writer = { id: string; email: string; role: Role };

/**
 * The three notes: a form adviser on their own class, a subject teacher on a
 * class they teach, and the Science subject head (two roles, working as a
 * teacher) on one of her Science classes. Picked from a stable order.
 */
export function noteWriters(): Array<{
  writer: Writer;
  sectionId: string;
  label: string;
  content: string;
}> {
  const pick = (where: string) => {
    const row = sqlRows(`
      select u.id, u.email, ta.section_id, l.code || ' ' || s.name
        from teacher_assignments ta join auth.users u on u.id = ta.teacher_user_id
        join sections s on s.id = ta.section_id join levels l on l.id = s.level_id
       where ${where}
       order by u.email, l.code, s.name limit 1`)[0];
    if (!row) throw new Error(`classroom-notes: nobody fits ${where}`);
    return row;
  };
  const adviser = pick(
    `ta.role = 'form_adviser' and u.email = 'teacher02@local.test'`
  );
  const subject = pick(
    `ta.role = 'subject_teacher' and u.email = 'teacher11@local.test'`
  );
  const head = pick(
    `ta.role = 'subject_teacher' and u.email = 'coordinator@local.test'`
  );
  return [
    {
      writer: { id: adviser[0], email: adviser[1], role: 'teacher' },
      sectionId: adviser[2],
      label: adviser[3],
      content:
        '<p><strong>Seating:</strong> move the two by the window apart after the September parent meeting.</p><ul><li>Check reading logs every Monday.</li><li>Remind the class about the Science fair forms.</li></ul>',
    },
    {
      writer: { id: subject[0], email: subject[1], role: 'teacher' },
      sectionId: subject[2],
      label: subject[3],
      content:
        '<p>Lab session overran — finish the write-up next lesson. Three still owe the safety quiz.</p>',
    },
    {
      writer: { id: head[0], email: head[1], role: 'teacher' },
      sectionId: head[2],
      label: head[3],
      content:
        '<p>Moderation sample for Term 4: pick one high, one middle, one low script from the unit test.</p>',
    },
  ];
}

/** The route's PATCH, mirrored. Returns whether anything changed. */
async function saveNote(
  writer: Writer,
  sectionId: string,
  body: { content: string }
): Promise<boolean> {
  const sb = service();
  const { content } = ClassroomNoteSchema.parse(body);
  const { capability } = await loadClassroomAccess(
    writer.role,
    writer.id,
    sectionId
  );
  if (!capability)
    throw new Error(
      `classroom-notes: ${writer.email} has no capability (the route 404s)`
    );

  const [section] = await must(
    'classroom-notes: section',
    sb
      .from('sections')
      .select('id, name, level:levels(code, label)')
      .eq('id', sectionId)
  );
  const row = section as unknown as {
    name: string | null;
    level:
      | { code: string | null; label: string | null }
      | { code: string | null; label: string | null }[]
      | null;
  };
  const level = Array.isArray(row.level) ? row.level[0] : row.level;

  const existing = await must(
    'classroom-notes: existing',
    sb
      .from('classroom_notes')
      .select('content')
      .eq('section_id', sectionId)
      .eq('teacher_user_id', writer.id)
  );
  const previous =
    (existing[0] as { content: string } | undefined)?.content ?? '';
  const changed = previous !== content;

  const { error } = await sb.from('classroom_notes').upsert(
    {
      section_id: sectionId,
      teacher_user_id: writer.id,
      content,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'section_id,teacher_user_id' }
  );
  if (error) throw new Error(`classroom-notes: upsert: ${error.message}`);

  // A run that crashed between the upsert and the audit row left the note
  // saved with no trace: on the unchanged path, write the route's row if this
  // writer's save of this class has none.
  const audited =
    changed ||
    Number(
      sqlRows(`select count(*) from audit_log where action = 'classroom.note.save'
                and entity_id = '${sectionId}' and actor_id = '${writer.id}'`)[0][0]
    ) > 0;

  if (changed || !audited) {
    await logAction({
      service: sb,
      actor: { id: writer.id, email: writer.email, role: writer.role },
      action: 'classroom.note.save',
      entityType: 'classroom_note',
      entityId: sectionId,
      context: {
        section_id: sectionId,
        section_name: row.name ?? null,
        level_code: level?.code ?? null,
        level_label: level?.label ?? null,
        length: proseLength(content),
      },
    });
  }
  return changed || !audited;
}

export async function runClassroomNotes(): Promise<void> {
  const out: string[] = [];
  for (const n of noteWriters()) {
    const changed = await saveNote(n.writer, n.sectionId, {
      content: n.content,
    });
    out.push(
      `${n.writer.email} on ${n.label}: ${changed ? 'saved' : 'unchanged'}`
    );
  }
  console.log(`  ${out.join('; ')}`);
}
