'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, X } from 'lucide-react';

import { apiFetch, jsonInit, ApiError } from '@/lib/query/fetcher';
import { Button } from '@/components/ui/button';

export function TodoCrActions({ requestId }: { requestId: string }) {
  const router = useRouter();

  // Approve fires immediately, no dialog — decide.ts's approve path needs
  // no note (KD #123's email one-click Approve behaves the same way).
  // Reject stays a Link, not a mutation — rejecting requires a reason
  // (KD #88), which doesn't fit a one-line to-do row.
  const approveMutation = useMutation({
    mutationFn: () =>
      apiFetch(
        `/api/change-requests/${requestId}`,
        jsonInit('PATCH', { action: 'approve' })
      ),
    onSuccess: () => {
      toast.success('Change request approved');
      router.refresh();
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : 'Failed to approve');
    },
    retry: 0,
  });

  return (
    <div className="flex shrink-0 gap-1.5">
      <Button
        variant="success"
        size="sm"
        onClick={() => approveMutation.mutate()}
        disabled={approveMutation.isPending}
      >
        <Check /> Approve
      </Button>
      <Button variant="destructive" size="sm" asChild>
        <Link href={`/markbook/change-requests?req=${requestId}&action=reject`}>
          <X /> Reject
        </Link>
      </Button>
    </div>
  );
}
