import { redirect } from 'next/navigation';

import { BillingPageHeader } from '@/components/billing/billing-page-header';
import { NotConnectedPanel } from '@/components/billing/not-connected-panel';
import { RefreshButton } from '@/components/billing/refresh-button';
import { ReviewBoard } from '@/components/billing/review-board';
import { PageShell } from '@/components/ui/page-shell';
import { loadReviewList } from '@/lib/billing/review.server';
import { connectedRealmId } from '@/lib/qbo/client';
import { canInvoiceInQbo } from '@/lib/qbo/roles';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// Billing → To review. Students the SIS could not match to a QuickBooks
// customer by itself: pick a suggestion, pick another, or add them. No
// QuickBooks page matches it, so it takes the Billing header and
// QuickBooks' list conventions (underline tabs, an Action column of links).
export default async function BillingReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ student?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (!canInvoiceInQbo(sessionUser.role)) redirect('/');
  const service = createServiceClient();
  const [{ student }, realmId] = await Promise.all([
    searchParams,
    connectedRealmId(service).catch(() => null),
  ]);
  const list = realmId ? await loadReviewList(service) : null;

  return (
    <PageShell>
      <BillingPageHeader
        crumbs={[
          { label: 'Customers', href: '/billing' },
          { label: 'To review' },
        ]}
        title="To review"
        actions={list && <RefreshButton label="Refresh" />}
      >
        <p className="max-w-2xl text-sm text-muted-foreground">
          Students the SIS could not match to a QuickBooks customer by itself.
          Pick the right customer, or add the student to QuickBooks.
        </p>
      </BillingPageHeader>
      {!list ? (
        <NotConnectedPanel canConnect={sessionUser.role === 'superadmin'} />
      ) : (
        <ReviewBoard
          groups={list.groups}
          defaultKey={list.defaultKey}
          focus={student ?? null}
        />
      )}
    </PageShell>
  );
}
