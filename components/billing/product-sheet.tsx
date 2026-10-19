'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  EMPTY_PRODUCT_FORM,
  parsePrice,
  type ProductForm,
} from '@/lib/billing/product-form';
import type { ProductFormOptions } from '@/lib/billing/products.server';
import { shouldRenewRequestId } from '@/lib/billing/request-id';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

// Products & services → New product/service → Service, and Edit on a service:
// QuickBooks' Service form (Name, SKU, Category, Sales description, Sales
// price/rate, Income account, Taxable), saved straight to QuickBooks.

const NONE = '__none__';

export function ProductSheet({
  open,
  onOpenChange,
  itemId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** null = New service. */
  itemId: string | null;
}) {
  const run = useWriteAction();
  const options = useQuery({
    queryKey: ['billing-product-options'],
    queryFn: () => apiFetch<ProductFormOptions>('/api/billing/products'),
    enabled: open,
    staleTime: 60_000,
  });
  const itemUrl = itemId
    ? `/api/billing/products/${encodeURIComponent(itemId)}`
    : null;
  const read = useQuery({
    queryKey: ['billing-product-form', itemId],
    queryFn: () => apiFetch<{ form: ProductForm }>(itemUrl!),
    enabled: open && !!itemUrl,
    staleTime: 0,
    gcTime: 0,
  });
  const [form, setForm] = useState<ProductForm | null>(null);
  const current: ProductForm | null =
    form ?? (itemId ? (read.data?.form ?? null) : EMPTY_PRODUCT_FORM);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof ProductForm>(k: K, v: ProductForm[K]) =>
    setForm((f) => ({ ...(f ?? current!), [k]: v }));

  const nameMissing = !!current && current.name.trim() === '';
  const accountMissing = !!current && !current.incomeAccountId;
  const priceBad = !!current && parsePrice(current.price) === 'invalid';

  const save = useMutation({
    mutationFn: async (body: ProductForm) => {
      try {
        return await apiFetch<{ name: string; changed?: string[] }>(
          itemUrl ?? '/api/billing/products',
          jsonInit(itemUrl ? 'PATCH' : 'POST', { ...body, requestId })
        );
      } catch (err) {
        if (shouldRenewRequestId(err)) setRequestId(crypto.randomUUID());
        throw err;
      }
    },
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!current) return;
    if (nameMissing || accountMissing || priceBad) {
      setShowErrors(true);
      return;
    }
    setSaving(true);
    await run(() => save.mutateAsync(current), {
      pending: 'Saving to QuickBooks…',
      success: (d) =>
        !itemId
          ? `${d.name} added to QuickBooks`
          : d.changed?.length
            ? `Saved in QuickBooks: ${d.changed.join(', ')}`
            : 'Nothing changed',
      onResolved: () => onOpenChange(false),
    });
    setSaving(false);
  }

  const loadError = options.error ?? read.error;
  const ready = !!current && !!options.data;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-xl"
      >
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <SheetHeader className="shrink-0 border-b border-border p-5">
            <SheetTitle className="font-serif text-[22px] leading-tight tracking-tight">
              {itemId ? 'Edit service' : 'New service'}
            </SheetTitle>
            <SheetDescription>
              Services you sell, like a fee or a class. Saved straight to
              QuickBooks.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {loadError ? (
              <p className="text-sm text-destructive">
                {loadError instanceof Error
                  ? loadError.message
                  : 'QuickBooks couldn’t be read.'}{' '}
                Close and try again.
              </p>
            ) : !ready ? (
              <div className="space-y-3">
                {Array.from({ length: 6 }, (_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : (
              <FieldGroup className="gap-5">
                <Field>
                  <FieldLabel htmlFor="item-name">Name *</FieldLabel>
                  <Input
                    id="item-name"
                    value={current.name}
                    onChange={(e) => set('name', e.target.value)}
                    aria-invalid={showErrors && nameMissing}
                    maxLength={100}
                  />
                  {showErrors && nameMissing && (
                    <FieldError>Name is required.</FieldError>
                  )}
                </Field>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="item-sku">SKU</FieldLabel>
                    <Input
                      id="item-sku"
                      value={current.sku}
                      onChange={(e) => set('sku', e.target.value)}
                      className="font-mono"
                      maxLength={100}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="item-category">Category</FieldLabel>
                    <Select
                      value={current.categoryId || NONE}
                      onValueChange={(v) =>
                        set('categoryId', v === NONE ? '' : v)
                      }
                    >
                      <SelectTrigger id="item-category" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>Uncategorized</SelectItem>
                        {options.data.categories.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor="item-description">
                    Sales description
                  </FieldLabel>
                  <Textarea
                    id="item-description"
                    value={current.description}
                    onChange={(e) => set('description', e.target.value)}
                    rows={3}
                    maxLength={4000}
                  />
                  <FieldDescription>
                    Printed on invoices under the service&rsquo;s name.
                  </FieldDescription>
                </Field>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="item-price">
                      Sales price/rate
                    </FieldLabel>
                    <Input
                      id="item-price"
                      inputMode="decimal"
                      value={current.price}
                      onChange={(e) => set('price', e.target.value)}
                      className="tabular-nums"
                      aria-invalid={showErrors && priceBad}
                    />
                    {showErrors && priceBad && (
                      <FieldError>That is not a price.</FieldError>
                    )}
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="item-income">
                      Income account *
                    </FieldLabel>
                    <Select
                      value={current.incomeAccountId || undefined}
                      onValueChange={(v) => set('incomeAccountId', v)}
                    >
                      <SelectTrigger
                        id="item-income"
                        className="w-full"
                        aria-invalid={showErrors && accountMissing}
                      >
                        <SelectValue placeholder="Choose an account" />
                      </SelectTrigger>
                      <SelectContent>
                        {options.data.incomeAccounts.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {showErrors && accountMissing && (
                      <FieldError>
                        Pick the income account it posts to.
                      </FieldError>
                    )}
                  </Field>
                </div>
                <Field orientation="horizontal">
                  <Checkbox
                    id="item-taxable"
                    checked={current.taxable}
                    onCheckedChange={(v) => set('taxable', v === true)}
                  />
                  <FieldLabel htmlFor="item-taxable" className="font-normal">
                    Taxable
                  </FieldLabel>
                </Field>
              </FieldGroup>
            )}
          </div>
          <SheetFooter className="shrink-0 flex-row justify-between gap-2 border-t border-border bg-background p-5">
            <SheetClose asChild>
              <Button type="button" variant="ghost" disabled={saving}>
                Cancel
              </Button>
            </SheetClose>
            <Button
              type="submit"
              loading={saving}
              loadingText="Saving…"
              disabled={saving || !ready}
            >
              Save and close
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
