import { NextResponse } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { revokeToken } from '@/lib/qbo/client';
import { QBO_ADMIN_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/quickbooks/disconnect — superadmin. Revokes the key at Intuit and
// forgets it. Linked invoices and customer matches are KEPT, so reconnecting
// the same company carries on where it left off.
export async function POST() {
  const auth = await requireRole([...QBO_ADMIN_ROLES]);
  if ('error' in auth) return auth.error;
  const service = createServiceClient();
  const { data } = await service
    .from('qbo_connection')
    .select('realm_id, company_name, environment, refresh_token')
    .eq('id', 1)
    .maybeSingle();
  if (!data) return NextResponse.json({ ok: true });
  let revoked = true;
  await revokeToken(data.refresh_token).catch((e) => {
    revoked = false;
    console.warn('[qbo disconnect] revoke failed, forgetting anyway:', e);
  });
  const { error } = await service.from('qbo_connection').delete().eq('id', 1);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
    action: 'qbo.connection.disconnect',
    entityType: 'qbo_connection',
    entityId: data.realm_id,
    context: {
      company_name: data.company_name,
      environment: data.environment,
      revoked,
    },
  });
  return NextResponse.json({ ok: true });
}
