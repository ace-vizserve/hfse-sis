import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

export async function startRun(
  service: SupabaseClient,
  source: 'webhook' | 'hourly' | 'manual'
): Promise<string | null> {
  const { data } = await service
    .from('qbo_sync_runs')
    .insert({ source })
    .select('id')
    .single();
  return (data as { id: string } | null)?.id ?? null;
}

export async function finishRun(
  service: SupabaseClient,
  id: string | null,
  result: { invoicesUpdated: number; error: string | null }
): Promise<void> {
  if (!id) return;
  await service
    .from('qbo_sync_runs')
    .update({
      finished_at: new Date().toISOString(),
      invoices_updated: result.invoicesUpdated,
      error: result.error,
    })
    .eq('id', id);
}
