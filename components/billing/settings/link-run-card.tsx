'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { LinkRunResult } from '@/lib/billing/link-run.server';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

// Link students: matches every unlinked student to their QuickBooks customer
// (typed invoice number, sibling, name). Counts first; nothing is linked
// until the count is confirmed.
export function LinkRunCard({ reviewCount }: { reviewCount: number }) {
  const run = useWriteAction();
  const [dry, setDry] = React.useState<LinkRunResult | null>(null);
  const go = useMutation({
    mutationFn: (dryRun: boolean) =>
      apiFetch<LinkRunResult>(
        '/api/billing/link',
        jsonInit('POST', { dryRun })
      ),
  });
  const total = dry
    ? dry.linked.invoice + dry.linked.sibling + dry.linked.name
    : 0;
  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Customers
        </CardDescription>
        <CardTitle className="font-serif text-lg font-semibold tracking-tight">
          Link students
        </CardTitle>
        <CardAction>
          <Button
            variant="outline"
            loading={go.isPending}
            loadingText="Counting…"
            onClick={() =>
              run(() => go.mutateAsync(true), {
                pending: 'Counting…',
                refresh: false,
                success: (d) => (setDry(d), null),
              })
            }
          >
            Link students
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Finds each unlinked student&rsquo;s QuickBooks customer by their typed
          invoice numbers, then by name. Anyone it can&rsquo;t place goes to To
          review ({reviewCount} there now). Links staff picked are kept.
        </p>
      </CardContent>
      <AlertDialog open={!!dry} onOpenChange={(o) => !o && setDry(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{total} students can be linked</AlertDialogTitle>
            <AlertDialogDescription>
              {dry
                ? `${dry.linked.invoice} by invoice number, ${dry.linked.sibling} by a sibling's number and name, ${dry.linked.name} by name. ${dry.review} go to To review. ${dry.alreadyLinked} are already linked and stay as they are. Each newly linked student's invoices and payments are read from QuickBooks, which takes a few minutes.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setDry(null);
                void run(() => go.mutateAsync(false), {
                  pending: 'Linking and reading invoices…',
                  success: (d) =>
                    `${d.newlyLinked.length} linked · ${d.review} to review${d.historyErrors.length ? ` · ${d.historyErrors.length} still loading — run it again` : ''}`,
                });
              }}
            >
              Link {total} students
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
