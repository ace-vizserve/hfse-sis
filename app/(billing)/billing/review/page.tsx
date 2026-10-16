import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { NotConnectedPanel } from '@/components/billing/not-connected-panel';
import { ReviewBoard } from '@/components/billing/review-board';
import { PageShell } from '@/components/ui/page-shell';
import { loadReviewList } from '@/lib/billing/review.server';
import { connectedRealmId } from '@/lib/qbo/client';
import { canInvoiceInQbo } from '@/lib/qbo/roles';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// Billing → To review. Students the SIS could not match to a QuickBooks
// customer by itself: pick a suggestion, pick another, or add them.
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
      <Link
        href="/billing"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Customers
      </Link>
      <header className="space-y-4">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Billing · QuickBooks
        </p>
        <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
          To review.
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Students the SIS could not match to a QuickBooks customer by itself.
          Pick the right customer, or add the student to QuickBooks.
        </p>
      </header>
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
