'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
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
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { formatSgd } from '@/lib/qbo/format';
import type { QboStageKey } from '@/lib/qbo/stage-state';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

// The Create invoice and Link QB invoice drawers (spec "Screens"). Both start
// with the same customer step; QuickBooks is asked first and nothing is saved
// in the SIS unless it accepts. Pattern: components/sis/admission-option-sheet.tsx
// (pinned footer, KD #227).

type QbCustomer = { id: string; displayName: string };
type CustomersResponse = {
  linked: QbCustomer | null;
  exact: QbCustomer[];
  similar: QbCustomer[];
};
type Item = {
  id: string;
  name: string;
  description: string | null;
  unitPrice: number | null;
};
type OpenInvoice = {
  id: string;
  docNumber: string | null;
  txnDate: string | null;
  total: number;
  balance: number;
};
type SheetProps = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  ayCode: string;
  enroleeNumber: string;
  stage: QboStageKey;
};
type SaveResponse = { docNumber: string | null; stageWarning: string | null };

const STAGE_NAME: Record<QboStageKey, string> = {
  registration: 'Registration',
  fees: 'Fees',
};
/**
 * Saved in QuickBooks but the stage wasn't moved: that is a warning, not a
 * green success. Shows it as one and tells the caller to stay quiet.
 */
function warnedInstead(d: SaveResponse): boolean {
  if (!d.stageWarning) return false;
  toast.warning(d.stageWarning);
  return true;
}

const todayIso = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });

/** Which QuickBooks customer — the remembered one, the single exact match, or the person's pick. */
function useCustomerChoice(ayCode: string, enroleeNumber: string) {
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<QbCustomer | null>(null);
  const [overridden, setOverridden] = useState(false);
  const query = useQuery({
    // Once "Change" is clicked the remembered customer is skipped, so the
    // list shows real choices (matches by last name) instead of it again.
    queryKey: ['qbo-customers', ayCode, enroleeNumber, search, overridden],
    queryFn: () =>
      apiFetch<CustomersResponse>(
        `/api/quickbooks/customers?ay=${encodeURIComponent(ayCode)}&enrolee=${encodeURIComponent(enroleeNumber)}${search ? `&q=${encodeURIComponent(search)}` : ''}${overridden ? '&fresh=1' : ''}`
      ),
  });
  const data = query.data;
  const auto =
    data?.linked ??
    (data && !search && data.exact.length === 1 ? data.exact[0] : null);
  const customer = picked ?? (overridden ? null : auto);
  const matchedBy: 'auto' | 'staff' = picked ? 'staff' : 'auto';
  const choices = data ? [...data.exact, ...data.similar] : [];
  return {
    query,
    customer,
    matchedBy,
    choices,
    setPicked,
    change: () => {
      setPicked(null);
      setOverridden(true);
    },
    search,
    setSearch,
    remembered: !!data?.linked && !picked && !overridden,
  };
}

function CustomerField({ c }: { c: ReturnType<typeof useCustomerChoice> }) {
  const [typed, setTyped] = useState('');
  if (c.query.isLoading) {
    return (
      <p className="text-sm text-muted-foreground">
        Looking up the QuickBooks customer…
      </p>
    );
  }
  if (c.query.isError) {
    return <FieldError>{(c.query.error as Error).message}</FieldError>;
  }
  return (
    <Field>
      <FieldLabel>QuickBooks customer</FieldLabel>
      {c.customer && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
          <span className="text-sm font-medium text-foreground">
            {c.customer.displayName}
          </span>
          <Button type="button" size="sm" variant="ghost" onClick={c.change}>
            Change
          </Button>
        </div>
      )}
      {c.customer ? (
        <FieldDescription>
          {c.remembered
            ? 'Remembered from an earlier invoice.'
            : c.matchedBy === 'auto'
              ? 'Matched by the student’s full name.'
              : 'Picked by you. The SIS will remember it for this student.'}
        </FieldDescription>
      ) : (
        <>
          <FieldDescription>
            No customer has exactly this student’s name. Pick the right one, or
            search.
          </FieldDescription>
          <div className="flex gap-2">
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="Search QuickBooks customers"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  c.setSearch(typed.trim());
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => c.setSearch(typed.trim())}
            >
              Search
            </Button>
          </div>
          {c.choices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No customers found.</p>
          ) : (
            <RadioGroup
              value=""
              onValueChange={(id) =>
                c.setPicked(c.choices.find((x) => x.id === id) ?? null)
              }
              className="max-h-56 gap-1.5 overflow-y-auto"
            >
              {c.choices.map((x) => (
                <label
                  key={x.id}
                  className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground has-[[data-state=checked]]:border-brand-indigo has-[[data-state=checked]]:bg-brand-indigo/5"
                >
                  <RadioGroupItem value={x.id} />
                  {x.displayName}
                </label>
              ))}
            </RadioGroup>
          )}
        </>
      )}
    </Field>
  );
}

function SheetFrame({
  open,
  onOpenChange,
  stage,
  title,
  description,
  onSubmit,
  saving,
  submitLabel,
  submitDisabled,
  children,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  stage: QboStageKey;
  title: string;
  description: string;
  onSubmit: (e: React.FormEvent) => void;
  saving: boolean;
  submitLabel: string;
  submitDisabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-lg"
      >
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <SheetHeader className="shrink-0 gap-1.5 border-b border-border p-5">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              QuickBooks · {STAGE_NAME[stage]}
            </p>
            <SheetTitle className="font-serif text-[22px] leading-tight tracking-tight">
              {title}
            </SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <FieldGroup>{children}</FieldGroup>
          </div>
          <SheetFooter className="shrink-0 gap-2 border-t border-border bg-background p-5">
            <SheetClose asChild>
              <Button type="button" variant="outline" disabled={saving}>
                Cancel
              </Button>
            </SheetClose>
            <Button
              type="submit"
              loading={saving}
              loadingText="Saving in QuickBooks…"
              disabled={submitDisabled}
            >
              {submitLabel}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

type Line = {
  key: number;
  itemId: string;
  description: string;
  qty: string;
  unitPrice: string;
};

export function CreateInvoiceSheet({
  open,
  onOpenChange,
  ayCode,
  enroleeNumber,
  stage,
}: SheetProps) {
  const c = useCustomerChoice(ayCode, enroleeNumber);
  const items = useQuery({
    queryKey: ['qbo-items'],
    queryFn: () => apiFetch<{ items: Item[] }>('/api/quickbooks/items'),
    staleTime: 5 * 60 * 1000,
  });
  const [lines, setLines] = useState<Line[]>([
    { key: 1, itemId: '', description: '', qty: '1', unitPrice: '' },
  ]);
  const [txnDate, setTxnDate] = useState(todayIso);
  const [dueDate, setDueDate] = useState('');
  const [memo, setMemo] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const run = useWriteAction();

  const parsed = lines.map((l) => ({
    ...l,
    q: Number(l.qty),
    p: Number(l.unitPrice),
  }));
  const linesValid = parsed.every(
    (l) =>
      l.itemId &&
      l.qty.trim() !== '' &&
      l.q > 0 &&
      l.unitPrice.trim() !== '' &&
      l.p >= 0
  );
  const total = parsed.reduce(
    (s, l) =>
      s +
      (l.qty.trim() !== '' && l.unitPrice.trim() !== '' && l.q > 0 && l.p >= 0
        ? Math.round(l.q * l.p * 100) / 100
        : 0),
    0
  );
  const valid =
    !!c.customer && linesValid && /^\d{4}-\d{2}-\d{2}$/.test(txnDate);

  const save = useMutation({
    mutationFn: () =>
      apiFetch<SaveResponse>(
        `/api/sis/students/${encodeURIComponent(enroleeNumber)}/stage/${stage}/invoice`,
        jsonInit('POST', {
          mode: 'create',
          ayCode,
          customerId: c.customer!.id,
          customerName: c.customer!.displayName,
          matchedBy: c.matchedBy,
          lines: parsed.map((l) => ({
            itemId: l.itemId,
            ...(l.description.trim()
              ? { description: l.description.trim() }
              : {}),
            qty: l.q,
            unitPrice: l.p,
          })),
          txnDate,
          dueDate: dueDate || null,
          ...(memo.trim() ? { memo: memo.trim() } : {}),
        })
      ),
  });

  const setLine = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) {
      setShowErrors(true);
      return;
    }
    setSaving(true);
    await run(() => save.mutateAsync(), {
      pending: 'Creating the invoice in QuickBooks…',
      success: (d) =>
        warnedInstead(d)
          ? null
          : d.docNumber
            ? `Invoice ${d.docNumber} created in QuickBooks`
            : 'Invoice created in QuickBooks',
      onResolved: () => onOpenChange(false),
    });
    setSaving(false);
  }

  return (
    <SheetFrame
      open={open}
      onOpenChange={onOpenChange}
      stage={stage}
      title="Create invoice"
      description="QuickBooks numbers it and the stage updates by itself. Payments recorded in QuickBooks come back here."
      onSubmit={submit}
      saving={saving}
      submitLabel="Create in QuickBooks"
      submitDisabled={saving}
    >
      <CustomerField c={c} />
      {showErrors && !c.customer && (
        <FieldError>Choose the QuickBooks customer.</FieldError>
      )}

      <Field>
        <FieldLabel>Lines</FieldLabel>
        {items.isError && (
          <FieldError>{(items.error as Error).message}</FieldError>
        )}
        <div className="space-y-3">
          {lines.map((l) => (
            <div
              key={l.key}
              className="space-y-2 rounded-md border border-border p-3"
            >
              <div className="flex items-start gap-2">
                <Select
                  value={l.itemId}
                  onValueChange={(id) => {
                    const it = items.data?.items.find((x) => x.id === id);
                    const prev = items.data?.items.find(
                      (x) => x.id === l.itemId
                    );
                    const untouched =
                      !l.description ||
                      l.description === (prev?.description ?? '');
                    setLine(l.key, {
                      itemId: id,
                      unitPrice:
                        it?.unitPrice != null ? String(it.unitPrice) : '',
                      description: untouched
                        ? (it?.description ?? '')
                        : l.description,
                    });
                  }}
                >
                  <SelectTrigger className="w-full" aria-label="Item">
                    <SelectValue
                      placeholder={
                        items.isLoading ? 'Loading items…' : 'Choose an item'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {(items.data?.items ?? []).map((it) => (
                      <SelectItem key={it.id} value={it.id}>
                        {it.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {lines.length > 1 && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label="Remove line"
                    onClick={() =>
                      setLines((ls) => ls.filter((x) => x.key !== l.key))
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
              <Input
                value={l.description}
                onChange={(e) =>
                  setLine(l.key, { description: e.target.value })
                }
                placeholder="Description (optional)"
                aria-label="Description"
              />
              <div className="grid grid-cols-[5rem_1fr_auto] items-center gap-2">
                <Input
                  inputMode="decimal"
                  value={l.qty}
                  onChange={(e) => setLine(l.key, { qty: e.target.value })}
                  aria-label="Quantity"
                  className="tabular-nums"
                />
                <Input
                  inputMode="decimal"
                  value={l.unitPrice}
                  onChange={(e) =>
                    setLine(l.key, { unitPrice: e.target.value })
                  }
                  placeholder="Price"
                  aria-label="Price"
                  className="tabular-nums"
                />
                <span className="min-w-24 text-right text-sm tabular-nums text-foreground">
                  {l.qty.trim() !== '' &&
                  Number(l.qty) > 0 &&
                  Number(l.unitPrice) >= 0 &&
                  l.unitPrice.trim() !== ''
                    ? formatSgd(
                        Math.round(Number(l.qty) * Number(l.unitPrice) * 100) /
                          100
                      )
                    : '—'}
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between pt-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              setLines((ls) => [
                ...ls,
                {
                  key: Math.max(...ls.map((x) => x.key)) + 1,
                  itemId: '',
                  description: '',
                  qty: '1',
                  unitPrice: '',
                },
              ])
            }
          >
            <Plus className="size-3.5" />
            Add line
          </Button>
          <p className="text-sm text-foreground">
            Total{' '}
            <span className="font-semibold tabular-nums">
              {formatSgd(total)}
            </span>
          </p>
        </div>
        {showErrors && !linesValid && (
          <FieldError>
            Each line needs an item, a quantity above 0 and a price.
          </FieldError>
        )}
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="qbo-txn-date">Invoice date</FieldLabel>
          <Input
            id="qbo-txn-date"
            type="date"
            value={txnDate}
            onChange={(e) => setTxnDate(e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="qbo-due-date">Due date</FieldLabel>
          <Input
            id="qbo-due-date"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
          <FieldDescription>
            Leave blank to use QuickBooks’ usual terms.
          </FieldDescription>
        </Field>
      </div>

      <Field>
        <FieldLabel htmlFor="qbo-memo">Message to the parent</FieldLabel>
        <Input
          id="qbo-memo"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
        />
        <FieldDescription>Shown on the invoice.</FieldDescription>
      </Field>
    </SheetFrame>
  );
}

export function LinkInvoiceSheet({
  open,
  onOpenChange,
  ayCode,
  enroleeNumber,
  stage,
}: SheetProps) {
  const c = useCustomerChoice(ayCode, enroleeNumber);
  const [invoiceId, setInvoiceId] = useState('');
  const [saving, setSaving] = useState(false);
  const run = useWriteAction();
  // Pick a different customer and the old invoice choice no longer applies.
  const customerId = c.customer?.id ?? null;
  const [lastCustomerId, setLastCustomerId] = useState(customerId);
  if (lastCustomerId !== customerId) {
    setLastCustomerId(customerId);
    setInvoiceId('');
  }
  const invoices = useQuery({
    queryKey: ['qbo-open-invoices', c.customer?.id],
    enabled: !!c.customer,
    queryFn: () =>
      apiFetch<{ invoices: OpenInvoice[] }>(
        `/api/quickbooks/customers/${encodeURIComponent(c.customer!.id)}/invoices`
      ),
  });
  const save = useMutation({
    mutationFn: () =>
      apiFetch<SaveResponse>(
        `/api/sis/students/${encodeURIComponent(enroleeNumber)}/stage/${stage}/invoice`,
        jsonInit('POST', {
          mode: 'link',
          ayCode,
          customerId: c.customer!.id,
          customerName: c.customer!.displayName,
          matchedBy: c.matchedBy,
          qboInvoiceId: invoiceId,
        })
      ),
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!c.customer || !invoiceId) return;
    setSaving(true);
    await run(() => save.mutateAsync(), {
      pending: 'Linking the invoice…',
      success: (d) =>
        warnedInstead(d)
          ? null
          : d.docNumber
            ? `Invoice ${d.docNumber} linked`
            : 'Invoice linked',
      onResolved: () => onOpenChange(false),
    });
    setSaving(false);
  }

  const list = invoices.data?.invoices ?? [];
  return (
    <SheetFrame
      open={open}
      onOpenChange={onOpenChange}
      stage={stage}
      title="Link QB invoice"
      description="For an invoice already made in QuickBooks. The stage takes its number and follows its payments from now on."
      onSubmit={submit}
      saving={saving}
      submitLabel="Link invoice"
      submitDisabled={saving || !c.customer || !invoiceId}
    >
      <CustomerField c={c} />
      {c.customer && (
        <Field>
          <FieldLabel>Open invoices</FieldLabel>
          {invoices.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading invoices…</p>
          ) : invoices.isError ? (
            <FieldError>{(invoices.error as Error).message}</FieldError>
          ) : list.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This customer has no open invoices that aren’t already linked. Use
              Create invoice instead.
            </p>
          ) : (
            <RadioGroup
              value={invoiceId}
              onValueChange={setInvoiceId}
              className="gap-1.5"
            >
              {list.map((inv) => (
                <label
                  key={inv.id}
                  className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-md border border-border px-3 py-2.5 text-sm text-foreground has-[[data-state=checked]]:border-brand-indigo has-[[data-state=checked]]:bg-brand-indigo/5"
                >
                  <RadioGroupItem value={inv.id} />
                  <span>
                    <span className="font-mono font-semibold tabular-nums">
                      {inv.docNumber ?? inv.id}
                    </span>
                    {inv.txnDate && (
                      <span className="ml-2 text-muted-foreground">
                        {new Date(
                          `${inv.txnDate.slice(0, 10)}T00:00:00`
                        ).toLocaleDateString('en-SG', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </span>
                    )}
                  </span>
                  <span className="text-right tabular-nums">
                    {formatSgd(inv.total)}
                    <span className="block text-[11px] text-muted-foreground">
                      Balance {formatSgd(inv.balance)}
                    </span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          )}
        </Field>
      )}
    </SheetFrame>
  );
}
