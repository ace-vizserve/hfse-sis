'use client';

import { useMutation } from '@tanstack/react-query';
import { Link2, Unplug } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

export function QboConnectionActions({ connected }: { connected: boolean }) {
  const run = useWriteAction();
  const disconnect = useMutation({
    mutationFn: () => apiFetch('/api/quickbooks/disconnect', jsonInit('POST')),
  });
  if (!connected) {
    return (
      <Button asChild>
        {/* A full navigation: Intuit's approval page is outside the app. */}
        <a href="/api/quickbooks/connect">
          <Link2 className="size-4" />
          Connect QuickBooks
        </a>
      </Button>
    );
  }
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline">
          <Unplug className="size-4" />
          Disconnect
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Disconnect QuickBooks?</AlertDialogTitle>
          <AlertDialogDescription>
            Invoices stop syncing and the invoice buttons disappear until
            someone connects again. Invoices already linked stay linked.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() =>
              run(() => disconnect.mutateAsync(), {
                pending: 'Disconnecting…',
                success: 'QuickBooks disconnected',
              })
            }
          >
            Disconnect
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
