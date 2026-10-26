import { notFound, redirect } from 'next/navigation';

import { SowPage } from '@/components/sow/sow-page';
import { PageShell } from '@/components/ui/page-shell';
import { loadSowView } from '@/lib/sow/read';
import { createServiceClient } from '@/lib/supabase/service';
import { getSessionUser } from '@/lib/supabase/server';

// One scheme of work. `loadSowView` decides what the caller may do and returns
// null when they may not read it at all, which is a 404 here — the same answer
// as a scheme that does not exist, so its existence is not confirmed.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function SchemeOfWorkPage({
  params,
}: {
  params: Promise<{ sowId: string }>;
}) {
  const { sowId } = await params;
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!UUID.test(sowId)) notFound();

  const view = await loadSowView(
    createServiceClient(),
    { id: user.id, email: user.email, role: user.role },
    sowId
  );
  if (!view) notFound();

  return (
    <PageShell className="space-y-6">
      <SowPage view={view} />
    </PageShell>
  );
}
