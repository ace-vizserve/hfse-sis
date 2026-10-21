'use client';

import { useMutation } from '@tanstack/react-query';
import { Link2, Search } from 'lucide-react';
import { useState } from 'react';

import { StageStatusBadge } from '@/components/sis/status-badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  STAGE_LINK_NAME,
  type StageLinkPreview,
} from '@/lib/billing/stage-link';
import { formatDay } from '@/lib/billing/view';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import { formatSgd } from '@/lib/qbo/format';

// Link an invoice on a Registration / Fees stage card: type the QuickBooks
// invoice number, Find shows it, Link ties it to the stage. Every rule (and
// its sentence) is the server's — lib/billing/stage-link.ts.
export function LinkStageInvoice({
  studentNumber,
  stage,
  ayCode,
}: {
  studentNumber: string;
  stage: 'registration' | 'fees';
  ayCode: string;
}) {
  const run = useWriteAction();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [found, setFound] = useState<StageLinkPreview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmCustomer, setConfirmCustomer] = useState(false);
  const url = `/api/billing/students/${encodeURIComponent(studentNumber)}/stage-link`;
  const body = (extra: Record<string, unknown>) =>
    jsonInit('POST', { stage, ayCode, docNumber: typed.trim(), ...extra });

  const find = useMutation({
    mutationFn: () => apiFetch<StageLinkPreview>(url, body({ preview: true })),
  });
  const link = useMutation({
    mutationFn: () =>
      apiFetch<{ docNumber: string; warnings: string[] }>(
        url,
        body({ linkCustomer: confirmCustomer })
      ),
  });
  const busy = find.isPending || link.isPending;

  function reset() {
    setTyped('');
    setFound(null);
    setProblem(null);
    setConfirmCustomer(false);
  }

  async function onFind(e: React.FormEvent) {
    e.preventDefault();
    if (!typed.trim() || busy) return;
    setFound(null);
    setProblem(null);
    setConfirmCustomer(false);
    try {
      setFound(await find.mutateAsync());
    } catch (err) {
      setProblem(
        err instanceof Error && err.message
          ? err.message
          : "The SIS couldn't look that number up. Try again."
      );
    }
  }

  async function onLink() {
    if (!found) return;
    await run(() => link.mutateAsync(), {
      pending: 'Linking the invoice…',
      success: (d) =>
        d.warnings.length
          ? { title: `${d.docNumber} linked`, description: d.warnings[0] }
          : `${d.docNumber} linked to ${STAGE_LINK_NAME[stage]}`,
      onResolved: () => {
        setOpen(false);
        reset();
      },
    });
  }

  const stageName = STAGE_LINK_NAME[stage];
  const canLink =
    !!found &&
    !found.alreadyLinked &&
    (!found.linksCustomer || confirmCustomer) &&
    !busy;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Link2 className="size-3.5" />
          Link an invoice
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg!">
        <DialogHeader>
          <DialogTitle className="font-serif">
            Link an invoice to {stageName} · {ayCode}
          </DialogTitle>
          <DialogDescription>
            For an invoice already made in QuickBooks. Once linked, the stage
            follows it.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onFind} className="space-y-1.5">
          <Field>
            <FieldLabel htmlFor="link-invoice-number">
              Invoice number
            </FieldLabel>
            <div className="flex gap-2">
              <Input
                id="link-invoice-number"
                value={typed}
                onChange={(e) => {
                  setTyped(e.target.value);
                  setFound(null);
                  setProblem(null);
                }}
                placeholder="HFSE069012"
                autoComplete="off"
                autoFocus
                disabled={link.isPending}
                aria-invalid={!!problem}
                aria-describedby={
                  problem ? 'link-invoice-problem' : 'link-invoice-hint'
                }
                className="tabular-nums"
              />
              <Button
                type="submit"
                variant="outline"
                disabled={!typed.trim() || busy}
              >
                <Search className="size-3.5" />
                {find.isPending ? 'Finding…' : 'Find'}
              </Button>
            </div>
            {problem ? (
              <p
                id="link-invoice-problem"
                role="alert"
                className="text-sm text-destructive"
              >
                {problem}
              </p>
            ) : (
              <FieldDescription id="link-invoice-hint">
                The number on the invoice in QuickBooks.
              </FieldDescription>
            )}
          </Field>
        </form>

        {found && (
          <section
            aria-label="Invoice found"
            className="space-y-3 rounded-lg border border-hairline bg-muted/40 px-4 py-3.5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold tabular-nums text-foreground">
                {found.docNumber}
              </p>
              <StageStatusBadge status={found.status} stage={stage} />
            </div>
            <dl className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-0.5">
                <dt className="text-xs text-muted-foreground">Customer</dt>
                <dd className="text-sm font-semibold text-foreground">
                  {found.customer}
                </dd>
              </div>
              <div className="space-y-0.5">
                <dt className="text-xs text-muted-foreground">Invoice date</dt>
                <dd className="text-sm font-semibold tabular-nums text-foreground">
                  {formatDay(found.txnDate)}
                </dd>
              </div>
              <div className="space-y-0.5">
                <dt className="text-xs text-muted-foreground">Total</dt>
                <dd className="text-sm font-semibold tabular-nums text-foreground">
                  {formatSgd(found.total)}
                </dd>
              </div>
              <div className="space-y-0.5">
                <dt className="text-xs text-muted-foreground">Balance</dt>
                <dd className="text-sm font-semibold tabular-nums text-foreground">
                  {formatSgd(found.balance)}
                </dd>
              </div>
              {found.dueDate && (
                <div className="space-y-0.5">
                  <dt className="text-xs text-muted-foreground">Due</dt>
                  <dd className="text-sm font-semibold tabular-nums text-foreground">
                    {formatDay(found.dueDate)}
                  </dd>
                </div>
              )}
              <div className="col-span-2 space-y-0.5">
                <dt className="text-xs text-muted-foreground">Products</dt>
                <dd className="text-sm text-foreground">
                  {found.products.length
                    ? found.products.join(', ')
                    : 'No products on it'}
                </dd>
              </div>
            </dl>
            {found.alreadyLinked && (
              <p className="text-xs text-ink-3">
                Already linked to this stage.
              </p>
            )}
            {found.linksCustomer && (
              <label className="flex items-start gap-2.5 rounded-md border border-brand-amber/40 bg-brand-amber/10 px-3 py-2.5 text-sm text-ink">
                <Checkbox
                  checked={confirmCustomer}
                  onCheckedChange={(v) => setConfirmCustomer(v === true)}
                  disabled={link.isPending}
                  className="mt-0.5"
                />
                <span>
                  This also links {found.customer} to {found.studentName} in
                  QuickBooks.
                </span>
              </label>
            )}
          </section>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            disabled={link.isPending}
            onClick={() => {
              setOpen(false);
              reset();
            }}
          >
            Cancel
          </Button>
          <Button onClick={onLink} disabled={!canLink}>
            <Link2 className="size-3.5" />
            {link.isPending ? 'Linking…' : 'Link'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
