'use client';

import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { apiFetch, jsonInit } from '@/lib/query/fetcher';

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

export function MyRequestsCancelButton({ requestId }: { requestId: string }) {
  const router = useRouter();

  // Tier-2 mutation. ApiError.message already resolves to the body's `error`
  // field, so the original `body.error ?? 'failed to cancel'` copy is preserved
  // via e.message; the generic fallback covers non-ApiError failures.
  const cancelMutation = useMutation({
    mutationFn: () =>
      apiFetch(
        `/api/change-requests/${requestId}`,
        jsonInit('PATCH', { action: 'cancel' })
      ),
    onSuccess: () => {
      toast.success('Request cancelled');
      router.refresh();
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : 'Failed to cancel');
    },
  });

  const busy = cancelMutation.isPending;

  function cancel() {
    cancelMutation.mutate();
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
        >
          Cancel
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel this request?</AlertDialogTitle>
          <AlertDialogDescription>
            This will withdraw the request from your school admin&apos;s review
            queue. You can file a new one if you change your mind.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep request</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => void cancel()}
            disabled={busy}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Cancel request
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
