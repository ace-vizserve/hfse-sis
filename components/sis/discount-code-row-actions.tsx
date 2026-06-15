'use client';

import { useMutation } from '@tanstack/react-query';
import { Clock, Pencil } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { EditDiscountCodeDialog } from '@/components/sis/edit-discount-code-dialog';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import { isExpired } from '@/components/ui/discount-code-status-badge';
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
import { RowActionsMenu } from '@/components/ui/data-table';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import type { DiscountCode } from '@/lib/sis/queries';
import type { DiscountCodeInput, DiscountEnroleeType } from '@/lib/schemas/sis';

type Props = {
  ayCode: string;
  code: DiscountCode;
};

function todayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function DiscountCodeRowActions({ ayCode, code }: Props) {
  const router = useRouter();
  const [expireOpen, setExpireOpen] = useState(false);

  const alreadyExpired = isExpired(code.endDate);

  // Seed the edit dialog. enroleeType may be an unexpected string in the DB;
  // fall back to 'New' rather than crashing the enum resolver.
  const initial: DiscountCodeInput = {
    discountCode: code.discountCode,
    enroleeType: (code.enroleeType ?? 'New') as DiscountEnroleeType,
    startDate: code.startDate,
    endDate: code.endDate,
    details: code.details,
  };

  // Tier-2: no local optimistic value — expire just mutates then
  // router.refresh() so the server re-renders the new end date. `isPending`
  // drives the disable; the route's `body.error` is preserved via
  // ApiError.message (fallback 'Failed to expire code' unchanged).
  const expireMutation = useMutation({
    mutationFn: () =>
      apiFetch(
        `/api/sis/discount-codes/${encodeURIComponent(String(code.id))}?ay=${encodeURIComponent(ayCode)}&op=expire`,
        jsonInit('PATCH', { endDate: todayISO() })
      ),
    onSuccess: () => {
      toast.success('Code expired');
      setExpireOpen(false);
      router.refresh();
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : 'Failed to expire code');
    },
  });

  const expiring = expireMutation.isPending;

  function handleExpire() {
    expireMutation.mutate();
  }

  return (
    <>
      <RowActionsMenu>
        <EditDiscountCodeDialog
          ayCode={ayCode}
          mode="edit"
          id={code.id}
          initial={initial}
        >
          <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
            <Pencil className="size-3.5" />
            Edit
          </DropdownMenuItem>
        </EditDiscountCodeDialog>
        {!alreadyExpired && (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setExpireOpen(true);
            }}
            className="text-destructive focus:text-destructive"
          >
            <Clock className="size-3.5" />
            Expire
          </DropdownMenuItem>
        )}
      </RowActionsMenu>

      <AlertDialog open={expireOpen} onOpenChange={setExpireOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="flex items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-destructive text-destructive-foreground shadow-brand-tile">
                <Clock className="size-4" />
              </div>
              <div className="space-y-1.5 text-left">
                <AlertDialogTitle>Expire this discount code?</AlertDialogTitle>
                <AlertDialogDescription>
                  Sets the end date to today. The code stops appearing in active
                  offers immediately. Expiring keeps the code in your records —
                  to bring it back, edit the end date to a future day.
                </AlertDialogDescription>
              </div>
            </div>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={expiring}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleExpire} disabled={expiring}>
              {expiring ? 'Expiring…' : 'Expire code'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
