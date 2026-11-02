import { NextResponse } from 'next/server';
import { z } from 'zod';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { ENROLMENT_PLACEMENT_WRITERS } from '@/lib/auth/student-record';
import { EventFormSchema } from '@/lib/events/form';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/sis/events/[id]/publish → { publishedAt }
//
// Publishing an already-published event is a no-op that returns the original
// time. The built-in "Who's joining" section is not part of the stored form, so
// "empty" means the form holds no questions at all.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole([...ENROLMENT_PLACEMENT_WRITERS]);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Event not found.' }, { status: 404 });
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from('parent_events')
    .select('id, form, published_at')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'Event not found.' }, { status: 404 });
  }
  const row = data as { form: unknown; published_at: string | null };

  if (row.published_at) {
    return NextResponse.json({ publishedAt: row.published_at });
  }

  const form = EventFormSchema.safeParse(row.form);
  const questionCount = form.success
    ? form.data.sections.reduce((n, s) => n + s.questions.length, 0)
    : 0;
  if (questionCount === 0) {
    return NextResponse.json(
      { error: 'Add at least one question or info text before publishing.' },
      { status: 400 }
    );
  }

  const publishedAt = new Date().toISOString();
  const { error: updErr } = await service
    .from('parent_events')
    .update({ published_at: publishedAt })
    .eq('id', id);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  await logAction({
    service,
    actor: {
      id: auth.user.id,
      email: auth.user.email ?? null,
      role: auth.role,
    },
    action: 'parent_event.publish',
    entityType: 'parent_event',
    entityId: id,
    context: { questions: questionCount },
  });

  return NextResponse.json({ publishedAt });
}
