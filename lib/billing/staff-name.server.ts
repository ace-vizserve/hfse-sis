import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The name written into a QuickBooks private note ("Created from SIS by …",
 * "Recorded from SIS by …"): the staff account's full name, else its email.
 */
export async function staffDisplayName(
  service: SupabaseClient,
  actor: { id: string; email: string | null }
): Promise<string> {
  const { data: who } = await service.auth.admin.getUserById(actor.id);
  return (
    (who?.user?.user_metadata?.full_name as string | undefined) ??
    actor.email ??
    'staff'
  );
}
