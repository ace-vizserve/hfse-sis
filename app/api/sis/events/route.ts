import { NextResponse } from 'next/server';
import { z } from 'zod';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { ENROLMENT_PLACEMENT_WRITERS } from '@/lib/auth/student-record';
import { newEventDefaults } from '@/lib/events/defaults';
import { slugifyEventTitle } from '@/lib/events/event';
import { EventFormSchema } from '@/lib/events/form';
import { createServiceClient } from '@/lib/supabase/service';

const CreateSchema = z.object({
  title: z.string().trim().min(1, 'Give the event a title').max(120),
});

// GET /api/sis/events?exclude=<id> → { events: { id, title, form }[] }
//
// The events of one academic year, for the builder's "Copy from another event".
// The year is the excluded event's own year (the current year without one);
// the excluded event itself is left out. Newest first.
export async function GET(request: Request) {
  const auth = await requireRole([...ENROLMENT_PLACEMENT_WRITERS]);
  if ('error' in auth) return auth.error;

  const exclude = new URL(request.url).searchParams.get('exclude');
  if (exclude && !z.string().uuid().safeParse(exclude).success) {
    return NextResponse.json({ error: 'Event not found.' }, { status: 404 });
  }

  const service = createServiceClient();

  let ayId: string | null = null;
  if (exclude) {
    const { data, error } = await service
      .from('parent_events')
      .select('academic_year_id')
      .eq('id', exclude)
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Event not found.' }, { status: 404 });
    }
    ayId = (data as { academic_year_id: string }).academic_year_id;
  } else {
    const { data, error } = await service
      .from('academic_years')
      .select('id')
      .eq('is_current', true)
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) return NextResponse.json({ events: [] });
    ayId = (data as { id: string }).id;
  }

  let query = service
    .from('parent_events')
    .select('id, title, form')
    .eq('academic_year_id', ayId);
  if (exclude) query = query.neq('id', exclude);
  const { data, error } = await query.order('created_at', {
    ascending: false,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const events = (
    (data ?? []) as { id: string; title: string; form: unknown }[]
  ).flatMap((row) => {
    const form = EventFormSchema.safeParse(row.form);
    return form.success
      ? [{ id: row.id, title: row.title, form: form.data }]
      : [];
  });
  return NextResponse.json({ events });
}

// POST /api/sis/events
// Body: { title }
//
// Starts a draft event for the current academic year with sensible dates
// (lib/events/defaults.ts) and an empty form. The short-link slug comes from the
// title; a unique-violation race on it retries once with the next suffix.
export async function POST(request: Request) {
  const auth = await requireRole([...ENROLMENT_PLACEMENT_WRITERS]);
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { title } = parsed.data;

  const service = createServiceClient();

  const { data: ay, error: ayErr } = await service
    .from('academic_years')
    .select('id')
    .eq('is_current', true)
    .maybeSingle();
  if (ayErr) {
    return NextResponse.json({ error: ayErr.message }, { status: 500 });
  }
  if (!ay) {
    return NextResponse.json(
      { error: 'There is no current academic year to attach the event to.' },
      { status: 409 }
    );
  }

  const { data: existing, error: slugErr } = await service
    .from('parent_events')
    .select('slug');
  if (slugErr) {
    return NextResponse.json({ error: slugErr.message }, { status: 500 });
  }
  const taken = new Set(
    ((existing ?? []) as { slug: string }[]).map((r) => r.slug)
  );

  const defaults = newEventDefaults(new Date());

  let slug = slugifyEventTitle(title, taken);
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await service
      .from('parent_events')
      .insert({
        academic_year_id: (ay as { id: string }).id,
        slug,
        title,
        starts_on: defaults.startsOn,
        opens_at: defaults.opensAt,
        closes_at: defaults.closesAt,
        audience: 'all',
        answer_mode: 'consent',
        form: { sections: [] },
        created_by: auth.user.id,
      })
      .select('id')
      .single();

    if (!error && data) {
      const id = (data as { id: string }).id;
      await logAction({
        service,
        actor: {
          id: auth.user.id,
          email: auth.user.email ?? null,
          role: auth.role,
        },
        action: 'parent_event.create',
        entityType: 'parent_event',
        entityId: id,
        context: { title, slug },
      });
      return NextResponse.json({ id, slug }, { status: 201 });
    }

    if (error?.code === '23505' && attempt === 0) {
      taken.add(slug);
      slug = slugifyEventTitle(title, taken);
      continue;
    }
    return NextResponse.json(
      { error: error?.message ?? 'Could not create the event.' },
      { status: 500 }
    );
  }
  return NextResponse.json(
    { error: 'Could not create the event.' },
    { status: 500 }
  );
}
