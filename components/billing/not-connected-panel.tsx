import { Unplug } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';

// §9.4 status panel. Shown on every Billing page while QuickBooks is not
// connected; only a superadmin can connect it.
export function NotConnectedPanel({ canConnect }: { canConnect: boolean }) {
  return (
    <div className="flex items-start gap-4 rounded-xl border border-destructive/30 bg-destructive/5 p-5">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-destructive text-destructive-foreground shadow-brand-tile">
        <Unplug className="size-4" />
      </div>
      <div className="flex-1 space-y-1.5">
        <p className="font-serif text-base font-semibold text-foreground">
          QuickBooks is not connected
        </p>
        <p className="text-sm text-muted-foreground">
          Billing shows what QuickBooks holds, so there is nothing to show until
          it is connected.
          {canConnect ? '' : ' Ask a superadmin to connect it.'}
        </p>
        {canConnect && (
          <Button asChild variant="outline" size="sm" className="mt-2">
            <Link href="/billing/settings">Open QuickBooks connection</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
