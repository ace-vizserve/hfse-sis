import { randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { ENROLMENT_PLACEMENT_WRITERS } from '@/lib/auth/student-record';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/sis/events/[id]/image (multipart, field "file") → { url }
//
// A picture for a question on the event form. Lands in the public
// `parent-portal` bucket under events/<eventId>/, the same bucket the other
// parent-facing files use.
const BUCKET = 'parent-portal';
const MAX_FILE_SIZE = 5 * 1024 * 1024;

// ⚠ The extension comes from the VERIFIED MIME type, never from `file.name` —
// the bucket serves its contents publicly.
const ACCEPTED: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole([...ENROLMENT_PLACEMENT_WRITERS]);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Event not found.' }, { status: 404 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: 'Choose a picture to add.' },
      { status: 400 }
    );
  }
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json(
      { error: 'Choose a picture to add.' },
      { status: 400 }
    );
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: 'That picture is larger than 5 MB. Please use a smaller one.' },
      { status: 400 }
    );
  }
  const ext = ACCEPTED[file.type];
  if (!ext) {
    return NextResponse.json(
      { error: 'Add a picture as a JPG, PNG or WEBP.' },
      { status: 400 }
    );
  }

  const service = createServiceClient();
  const { data: event, error: eventErr } = await service
    .from('parent_events')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (eventErr) {
    return NextResponse.json({ error: eventErr.message }, { status: 500 });
  }
  if (!event) {
    return NextResponse.json({ error: 'Event not found.' }, { status: 404 });
  }

  const path = `events/${id}/${randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: uploadError } = await service.storage
    .from(BUCKET)
    .upload(path, buffer, { upsert: false, contentType: file.type });
  if (uploadError) {
    console.error('[events] image upload failed:', uploadError.message);
    return NextResponse.json(
      { error: 'Could not upload that picture. Please try again.' },
      { status: 500 }
    );
  }

  const { data: pub } = service.storage.from(BUCKET).getPublicUrl(path);
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
    context: { details: false, form: false, image_added: pub.publicUrl },
  });
  return NextResponse.json({ url: pub.publicUrl });
}
