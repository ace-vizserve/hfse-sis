import { NextResponse } from 'next/server';
import { z } from 'zod';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { ENROLMENT_PLACEMENT_WRITERS } from '@/lib/auth/student-record';
import { cleanEventSlug, EventDetailsSchema } from '@/lib/events/event';
import { EventFormSchema } from '@/lib/events/form';
import { createServiceClient } from '@/lib/supabase/service';

const PatchSchema = z
  .object({
    details: EventDetailsSchema.optional(),
    form: EventFormSchema.optional(),
    slug: z.string().max(200).optional(),
  })
  .refine(
    (v) =>
      v.details !== undefined || v.form !== undefined || v.slug !== undefined,
    { message: 'Nothing to save.' }
  );

// PATCH /api/sis/events/[id]
// Body: { details?: EventDetails; form?: EventForm; slug?: string }
//   → { savedAt, slug? }
//
// Any part may be sent alone. A slug is cleaned to lowercase letters, numbers
// and hyphens; 409 when another event already uses it. Changing it after
// publishing means links already shared stop working (the builder says so).
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole([...ENROLMENT_PLACEMENT_WRITERS]);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Event not found.' }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { details, form } = parsed.data;
  const service = createServiceClient();

  const update: Record<string, unknown> = {};
  let slug: string | undefined;
  if (parsed.data.slug !== undefined) {
    slug = cleanEventSlug(parsed.data.slug);
    if (!slug) {
      return NextResponse.json(
        { error: 'Type a link using letters and numbers.' },
        { status: 400 }
      );
    }
    const { data: clash, error: clashErr } = await service
      .from('parent_events')
      .select('id')
      .eq('slug', slug)
      .neq('id', id)
      .limit(1);
    if (clashErr) {
      return NextResponse.json({ error: clashErr.message }, { status: 500 });
    }
    if (clash?.length) {
      return NextResponse.json(
        { error: 'Another event already uses this link.' },
        { status: 409 }
      );
    }
    update.slug = slug;
  }
  if (details) {
    update.title = details.title;
    update.description = details.description;
    update.starts_on = details.startsOn;
    update.ends_on = details.endsOn ?? null;
    update.time_label = details.timeLabel;
    update.venue = details.venue;
    update.audience = details.scope.audience;
    update.levels = details.scope.levels;
    update.section_ids = details.scope.sectionIds;
    update.answer_mode = details.answerMode;
    update.opens_at = new Date(details.opensAt).toISOString();
    update.closes_at = new Date(details.closesAt).toISOString();
  }
  if (form) update.form = form;

  const { data, error } = await service
    .from('parent_events')
    .update(update)
    .eq('id', id)
    .select('id, updated_at')
    .maybeSingle();
  // Another save took the same slug between the check and the write.
  if (error?.code === '23505') {
    return NextResponse.json(
      { error: 'Another event already uses this link.' },
      { status: 409 }
    );
  }
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'Event not found.' }, { status: 404 });
  }

  await logAction({
    service,
    actor: {
      id: auth.user.id,
      email: auth.user.email ?? null,
      role: auth.role,
    },
    action: 'parent_event.update',
    entityType: 'parent_event',
    entityId: id,
    context: { details: !!details, form: !!form, ...(slug ? { slug } : {}) },
  });

  return NextResponse.json({
    savedAt:
      (data as { updated_at?: string }).updated_at ?? new Date().toISOString(),
    ...(slug ? { slug } : {}),
  });
}
