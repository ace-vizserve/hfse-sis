import { NextResponse, type NextRequest } from 'next/server';
import { requireRole } from '@/lib/auth/require-role';
import { createServiceClient } from '@/lib/supabase/service';
import { logAction } from '@/lib/audit/log-action';

// DELETE /api/report-card-publications/[id] — registrar+ only.
// Revokes a publication window. Parents immediately lose access to the
// corresponding report card on their next page load.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(['registrar', 'school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const service = createServiceClient();

  const { data: existing } = await service
    .from('report_card_publications')
    .select('id, section_id, term_id, publish_from, publish_until')
    .eq('id', id)
    .maybeSingle();

  const { error } = await service.from('report_card_publications').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'publication.delete',
    entityType: 'report_card_publication',
    entityId: id,
    context: existing
      ? {
          section_id: existing.section_id,
          term_id: existing.term_id,
          publish_from: existing.publish_from,
          publish_until: existing.publish_until,
        }
      : {},
  });

  return NextResponse.json({ ok: true });
}
