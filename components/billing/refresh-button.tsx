'use client';

import { RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { Button } from '@/components/ui/button';

// Every Billing page reads QuickBooks when it loads, so refreshing is simply
// loading the page again.
export function RefreshButton({ label = 'Refresh' }: { label?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      loading={pending}
      loadingText="Reading QuickBooks…"
      onClick={() => start(() => router.refresh())}
    >
      <RefreshCw className="size-4" />
      {label}
    </Button>
  );
}
