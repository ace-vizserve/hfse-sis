'use client';

import { Clock, MoreHorizontal, Pencil } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { EditDiscountCodeDialog } from '@/components/sis/edit-discount-code-dialog';
import { isExpired } from '@/components/sis/discount-code-status-badge';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  const [expiring, setExpiring] = useState(false);

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

  async function handleExpire() {
    setExpiring(true);
    try {
      const res = await fetch(
        `/api/sis/discount-codes/${encodeURIComponent(String(code.id))}?ay=${encodeURIComponent(ayCode)}&op=expire`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endDate: todayISO() }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Failed to expire code');
      toast.success('Code expired');
      setExpireOpen(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to expire code');
    } finally {
      setExpiring(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-7">
            <MoreHorizontal className="size-4" />
            <span className="sr-only">Actions</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <EditDiscountCodeDialog ayCode={ayCode} mode="edit" id={code.id} initial={initial}>
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
        </DropdownMenuContent>
      </DropdownMenu>

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
                  Sets the end date to today. The code stops appearing in active offers immediately.
                  Expiring keeps the code in your records — to bring it back, edit the end date to a future day.
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
