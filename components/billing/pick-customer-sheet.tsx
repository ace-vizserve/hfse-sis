'use client';

import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

type Found = { id: string; displayName: string; linkedTo: string | null };

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
  const run = useWriteAction();
  const [typed, setTyped] = useState(initialSearch);
  const [q, setQ] = useState(initialSearch);
  const [picked, setPicked] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(typed.trim()), 300);
    return () => clearTimeout(t);
  }, [typed]);
  const found = useQuery({
    queryKey: ['billing-customers', q],
    enabled: q.length >= 2,
    queryFn: () =>
      apiFetch<{ customers: Found[] }>(
        `/api/billing/customers?q=${encodeURIComponent(q)}`
      ),
    placeholderData: keepPreviousData,
  });
  const link = useMutation({
    mutationFn: () =>
      apiFetch<{ displayName: string; historyErrors: string[] }>(
        `/api/billing/students/${encodeURIComponent(studentNumber)}/link`,
        jsonInit('POST', { customerId: picked })
      ),
  });
  const list = found.data?.customers ?? [];
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-lg"
      >
        <SheetHeader className="shrink-0 gap-1.5 border-b border-border p-5">
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
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <Field>
            <FieldLabel htmlFor="pick-q">QuickBooks customer</FieldLabel>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="pick-q"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="e.g. OBIAS"
                className="pl-8"
              />
            </div>
            <FieldDescription>At least two letters.</FieldDescription>
          </Field>
          {found.isError ? (
            <p className="text-sm text-destructive">
              {(found.error as Error).message}
            </p>
          ) : q.length < 2 ? null : found.isLoading ||
            found.isPlaceholderData ? (
            <p className="text-sm text-muted-foreground">Searching…</p>
          ) : list.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No QuickBooks customer has “{q}” in their name.
            </p>
          ) : (
            <RadioGroup
              value={picked}
              onValueChange={setPicked}
              className="gap-1.5"
            >
              {list.map((c) => (
                <label
                  key={c.id}
                  className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground has-[[data-state=checked]]:border-brand-indigo has-[[data-state=checked]]:bg-brand-indigo/5 has-[[data-disabled]]:opacity-60"
                >
                  <RadioGroupItem
                    value={c.id}
                    disabled={!!c.linkedTo && c.linkedTo !== studentNumber}
                  />
                  <span className="flex-1">{c.displayName}</span>
                  {c.linkedTo && c.linkedTo !== studentNumber && (
                    <Badge variant="secondary" className="h-5">
                      Linked to {c.linkedTo}
                    </Badge>
                  )}
                </label>
              ))}
            </RadioGroup>
          )}
        </div>
        <SheetFooter className="shrink-0 gap-2 border-t border-border bg-background p-5">
          <SheetClose asChild>
            <Button type="button" variant="outline" disabled={link.isPending}>
              Cancel
            </Button>
          </SheetClose>
          <Button
            disabled={!picked || link.isPending}
            loading={link.isPending}
            loadingText="Linking…"
            onClick={() =>
              run(() => link.mutateAsync(), {
                pending: 'Linking and reading their invoices…',
                success: (d) => `${studentName} linked to ${d.displayName}`,
                onResolved: () => onOpenChange(false),
              })
            }
          >
            Link customer
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
