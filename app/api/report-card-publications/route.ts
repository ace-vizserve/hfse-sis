import { NextResponse, type NextRequest } from 'next/server';
import { requireRole } from '@/lib/auth/require-role';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { logAction } from '@/lib/audit/log-action';
import { emailParentsPublication } from '@/lib/notifications/email-parents-publication';

// GET /api/report-card-publications?section_id=...
// Registrar+ only. Returns all publications for a section.
export async function GET(request: NextRequest) {
  const auth = await requireRole(['registrar', 'school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const sectionId = request.nextUrl.searchParams.get('section_id');
  const supabase = await createClient();

  let q = supabase
    .from('report_card_publications')
    .select('id, section_id, term_id, publish_from, publish_until, published_by, created_at, updated_at')
    .order('created_at', { ascending: false });
  if (sectionId) q = q.eq('section_id', sectionId);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ publications: data ?? [] });
}

// POST /api/report-card-publications
// Registrar+ only. Creates or updates (upserts on section_id Ã— term_id) a
// report card publication window. Parents whose children are enrolled in the
// section can view their child's report card within [publish_from, publish_until].
export async function POST(request: NextRequest) {
  const auth = await requireRole(['registrar', 'school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const body = (await request.json().catch(() => null)) as
    | {
        section_id?: string;
        term_id?: string;
        publish_from?: string;
        publish_until?: string;
      }
    | null;
  if (!body?.section_id || !body.term_id || !body.publish_from || !body.publish_until) {
    return NextResponse.json(
      { error: 'section_id, term_id, publish_from, publish_until are required' },
      { status: 400 },
    );
  }

  const from = new Date(body.publish_from);
  const until = new Date(body.publish_until);
  if (Number.isNaN(from.getTime()) || Number.isNaN(until.getTime())) {
    return NextResponse.json({ error: 'invalid date format' }, { status: 400 });
  }
  if (until <= from) {
    return NextResponse.json(
      { error: 'publish_until must be after publish_from' },
      { status: 400 },
    );
  }

  const service = createServiceClient();
  const publishedBy = auth.user.email ?? auth.user.id;

  const { data, error } = await service
    .from('report_card_publications')
    .upsert(
      {
        section_id: body.section_id,
        term_id: body.term_id,
        publish_from: from.toISOString(),
        publish_until: until.toISOString(),
        published_by: publishedBy,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'section_id,term_id' },
    )
    .select('id, section_id, term_id, publish_from, publish_until, notified_at')
    .single();
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'upsert failed' }, { status: 500 });
  }

  // Parent email notification â€” best-effort, idempotent via notified_at.
  // Only sends on first insert (or after a manual notified_at = NULL reset).
  let notification: { sent: number; failed: number; recipients: number } | null = null;
  if (data.notified_at == null) {
    notification = await emailParentsPublication({
      sectionId: data.section_id,
      termId: data.term_id,
      publishFrom: data.publish_from,
      publishUntil: data.publish_until,
    });
    if (notification.sent > 0) {
      await service
        .from('report_card_publications')
        .update({ notified_at: new Date().toISOString() })
        .eq('id', data.id);
    }
  }

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'publication.create',
    entityType: 'report_card_publication',
    entityId: data.id,
    context: {
      section_id: data.section_id,
      term_id: data.term_id,
      publish_from: data.publish_from,
      publish_until: data.publish_until,
      notification,
    },
  });

  return NextResponse.json({ publication: data, notification });
}
