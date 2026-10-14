import 'server-only';

import { qboEnv } from '@/lib/qbo/env';
import { createServiceClient } from '@/lib/supabase/service';

export async function getQboStatus() {
  const configured = !!qboEnv();
  const service = createServiceClient();
  const [conn, runs, errors] = await Promise.all([
    service
      .from('qbo_connection')
      .select('company_name, environment, connected_at, connected_by_email')
      .eq('id', 1)
      .maybeSingle(),
    service
      .from('qbo_sync_runs')
      .select('source, started_at, finished_at, invoices_updated, error')
      .order('started_at', { ascending: false })
      .limit(1),
    service
      .from('qbo_sync_runs')
      .select('source, started_at, error')
      .not('error', 'is', null)
      .order('started_at', { ascending: false })
      .limit(5),
  ]);
  const last = runs.data?.[0];
  return {
    configured,
    connected: !!conn.data,
    companyName: conn.data?.company_name ?? null,
    environment: conn.data?.environment ?? null,
    connectedAt: conn.data?.connected_at ?? null,
    connectedByEmail: conn.data?.connected_by_email ?? null,
    lastRun: last
      ? {
          source: last.source as string,
          startedAt: last.started_at as string,
          finishedAt: (last.finished_at as string | null) ?? null,
          invoicesUpdated: Number(last.invoices_updated),
          error: (last.error as string | null) ?? null,
        }
      : null,
    recentErrors: (errors.data ?? []).map((r) => ({
      source: r.source as string,
      startedAt: r.started_at as string,
      error: r.error as string,
    })),
  };
}
