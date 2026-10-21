'use client';

import { UserSearch } from 'lucide-react';
import { useState } from 'react';

import { CustomerSearch } from '@/components/billing/customer-search';
import {
  NewCustomerFields,
  useNewCustomerForm,
} from '@/components/billing/new-customer-form';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';

// Create invoice from a Registration / Fees stage, for a student with no
// QuickBooks customer yet — step 1 (spec 2026-10-21 "Create invoice from a
// stage"): find and link their customer, or add them as a new one. Either way
// the page refreshes linked, with ?new=invoice&stage&ay still on the URL, so
// step 2 (Create invoice) opens by itself.
export function StageCustomerSheet({
  studentNumber,
  studentName,
  initialSearch,
}: {
  studentNumber: string;
  studentName: string;
  initialSearch: string;
}) {
  const [open, setOpen] = useState(true);
  const [existing, setExisting] = useState(true);
  // Restarted (search prefilled) when QuickBooks says the name is taken.
  const [search, setSearch] = useState({ key: 0, q: initialSearch });
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const f = useNewCustomerForm({
    studentNumber,
    enabled: open && !existing,
    onDuplicate: setDuplicate,
  });

  const close = (o: boolean) => {
    setOpen(o);
    if (o) return;
    // Closed without a customer: drop the request so a reload doesn't reopen.
    const u = new URL(window.location.href);
    for (const k of ['new', 'stage', 'ay']) u.searchParams.delete(k);
    window.history.replaceState(window.history.state, '', u);
  };

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!existing) void f.submit();
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <SheetHeader className="shrink-0 gap-1.5 border-b border-border px-6 pb-5 pt-6 pr-14">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Create invoice · Step 1 of 2
            </p>
            <SheetTitle className="font-serif text-[22px] leading-tight tracking-tight">
              Who is this invoice for in QuickBooks?
            </SheetTitle>
            <SheetDescription>
              {studentName} isn&rsquo;t linked to a QuickBooks customer yet.
            </SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 space-y-8 overflow-y-auto px-6 py-6">
            <div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-muted/30 px-4 py-3.5">
              <div className="space-y-0.5">
                <Label
                  htmlFor="stage-existing"
                  className="text-sm font-medium text-foreground"
                >
                  Already a customer in QuickBooks
                </Label>
                <p className="text-xs text-muted-foreground">
                  Turn on to find and link them. Off adds them as a new
                  customer.
                </p>
              </div>
              <Switch
                id="stage-existing"
                checked={existing}
                onCheckedChange={(on) => {
                  setExisting(on);
                  if (!on) setDuplicate(null);
                }}
              />
            </div>

            {existing ? (
              <CustomerSearch
                key={search.key}
                studentNumber={studentNumber}
                studentName={studentName}
                initialSearch={search.q}
              />
            ) : (
              <>
                {duplicate && (
                  <div className="flex items-start gap-4 rounded-xl border border-brand-indigo-soft bg-accent p-4">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                      <UserSearch className="size-4" />
                    </div>
                    <div className="flex-1 space-y-2">
                      <p className="font-serif text-base font-semibold text-foreground">
                        QuickBooks already has &ldquo;{duplicate}&rdquo;
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Link that customer instead of adding a second one.
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSearch((s) => ({ key: s.key + 1, q: duplicate }));
                          setDuplicate(null);
                          setExisting(true);
                        }}
                      >
                        Find and link it
                      </Button>
                    </div>
                  </div>
                )}
                <p className="text-sm text-muted-foreground">
                  Filled in from the application. Check it, then add.
                </p>
                <NewCustomerFields f={f} />
                <p className="text-[12px] text-muted-foreground">
                  If QuickBooks already has a customer with this name,
                  you&rsquo;ll be asked to link that one instead.
                </p>
              </>
            )}
          </div>

          <SheetFooter className="shrink-0 flex-row justify-end gap-2 border-t border-border bg-background px-6 py-4">
            <SheetClose asChild>
              <Button type="button" variant="outline" disabled={f.saving}>
                Cancel
              </Button>
            </SheetClose>
            {!existing && (
              <Button
                type="submit"
                loading={f.saving}
                loadingText="Adding…"
                disabled={f.saving || !f.form}
              >
                Add to QuickBooks and continue
              </Button>
            )}
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
