import { NextResponse } from 'next/server';
import { z } from 'zod';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { ENROLMENT_PLACEMENT_WRITERS } from '@/lib/auth/student-record';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/sis/events/[id]/close → { closedAt }
// Closes registration now, ahead of its scheduled close.
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
  const closedAt = new Date().toISOString();
  const { data, error } = await service
    .from('parent_events')
    .update({ closed_early_at: closedAt })
    .eq('id', id)
    .select('id')
    .maybeSingle();
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
    action: 'parent_event.close',
    entityType: 'parent_event',
    entityId: id,
    context: {},
  });

  return NextResponse.json({ closedAt });
}
