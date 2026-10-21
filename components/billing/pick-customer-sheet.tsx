'use client';

import { CustomerSearch } from '@/components/billing/customer-search';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

// To review → Pick another: search every QuickBooks customer and link one.
export function PickCustomerSheet({
  open,
  onOpenChange,
  studentNumber,
  studentName,
  initialSearch,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  studentNumber: string;
  studentName: string;
  initialSearch: string;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-lg"
      >
        <SheetHeader className="shrink-0 gap-1.5 border-b border-border px-6 pb-5 pt-6 pr-14">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {studentName}
          </p>
          <SheetTitle className="font-serif text-[22px] leading-tight tracking-tight">
            Pick their customer
          </SheetTitle>
          <SheetDescription>
            Search QuickBooks by any part of the name. Linking loads every
            invoice and payment of that customer.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-8 overflow-y-auto px-6 py-6">
          <CustomerSearch
            studentNumber={studentNumber}
            studentName={studentName}
            initialSearch={initialSearch}
            onLinked={() => onOpenChange(false)}
          />
        </div>
        <SheetFooter className="shrink-0 flex-row justify-end gap-2 border-t border-border bg-background px-6 py-4">
          <SheetClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
