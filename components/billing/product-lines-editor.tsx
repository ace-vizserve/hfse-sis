'use client';

import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatSgd } from '@/lib/qbo/format';
import { apiFetch } from '@/lib/query/fetcher';

// QuickBooks' product / service lines — #, Product or service (with its
// description), Qty, Rate, Amount, delete; Add line, Clear all — shared by
// Create invoice, Refund receipt and Credit memo, as QuickBooks shares them.

export type ProductItem = {
  id: string;
  name: string;
  description: string | null;
  unitPrice: number | null;
  accountId: string | null;
  accountName: string | null;
};

export type ProductLine = {
  key: number;
  /** QuickBooks' line Id, for a line the invoice already has (Edit). */
  lineId?: string;
  itemId: string;
  description: string;
  qty: string;
  unitPrice: string;
};

export const emptyProductLine = (key: number): ProductLine => ({
  key,
  itemId: '',
  description: '',
  qty: '1',
  unitPrice: '',
});

/** QuickBooks' products and services, read when a form opens. */
export function useProductItems(enabled: boolean) {
  return useQuery({
    queryKey: ['qbo-items'],
    queryFn: () => apiFetch<{ items: ProductItem[] }>('/api/quickbooks/items'),
    staleTime: 5 * 60 * 1000,
    enabled,
  });
}

const lineReady = (l: ProductLine) =>
  l.qty.trim() !== '' &&
  Number(l.qty) > 0 &&
  l.unitPrice.trim() !== '' &&
  Number(l.unitPrice) >= 0;

export const lineAmount = (l: ProductLine) =>
  lineReady(l)
    ? Math.round(Number(l.qty) * Number(l.unitPrice) * 100) / 100
    : 0;

export const productLinesValid = (lines: ProductLine[]) =>
  lines.every((l) => l.itemId && lineReady(l));

export const productLinesTotal = (lines: ProductLine[]) =>
  Math.round(lines.reduce((s, l) => s + lineAmount(l), 0) * 100) / 100;

/** The lines as the routes take them. */
export const productLinesBody = (lines: ProductLine[]) =>
  lines.map((l) => ({
    ...(l.lineId ? { lineId: l.lineId } : {}),
    itemId: l.itemId,
    ...(l.description.trim() ? { description: l.description.trim() } : {}),
    qty: Number(l.qty),
    unitPrice: Number(l.unitPrice),
  }));

export function ProductLinesEditor({
  lines,
  onChange,
  items,
  loading,
  error,
  knownNames,
  actions,
  showErrors,
}: {
  lines: ProductLine[];
  onChange: (next: ProductLine[]) => void;
  items: ProductItem[];
  loading: boolean;
  error: string | null;
  /** Names of products a line already has (Edit, a copy), for when the list
   *  is loading or the product is inactive in QuickBooks. */
  knownNames?: Map<string, string>;
  /** Buttons before Add line (e.g. Same items as last time). */
  actions?: ReactNode;
  showErrors: boolean;
}) {
  const setLine = (key: number, patch: Partial<ProductLine>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const nextKey = () => Math.max(0, ...lines.map((x) => x.key)) + 1;

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {error && <FieldError className="px-4 pt-3">{error}</FieldError>}
        <div className="overflow-x-auto">
          <Table className="[&_td]:px-3 [&_th]:px-3">
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="w-8">#</TableHead>
                <TableHead className="w-full">
                  Product or service <span className="text-destructive">*</span>
                </TableHead>
                <TableHead className="w-20 text-right">
                  Qty <span className="text-destructive">*</span>
                </TableHead>
                <TableHead className="w-28 text-right">Rate</TableHead>
                <TableHead className="w-28 text-right">Amount</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">Delete</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l, i) => (
                <TableRow key={l.key} className="align-top">
                  <TableCell className="pt-4 tabular-nums text-muted-foreground">
                    {i + 1}
                  </TableCell>
                  <TableCell className="min-w-56 space-y-2 whitespace-normal">
                    <Select
                      value={l.itemId}
                      onValueChange={(id) => {
                        const it = items.find((x) => x.id === id);
                        const prev = items.find((x) => x.id === l.itemId);
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
                      <SelectTrigger
                        className="w-full"
                        aria-label={`Product or service, line ${i + 1}`}
                      >
                        <SelectValue
                          placeholder={
                            loading
                              ? 'Loading products…'
                              : 'Choose a product or service'
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {items.map((it) => (
                          <SelectItem key={it.id} value={it.id}>
                            {it.name}
                          </SelectItem>
                        ))}
                        {l.itemId &&
                          knownNames?.get(l.itemId) &&
                          !items.some((x) => x.id === l.itemId) && (
                            <SelectItem value={l.itemId}>
                              {knownNames.get(l.itemId)}
                            </SelectItem>
                          )}
                      </SelectContent>
                    </Select>
                    <Input
                      value={l.description}
                      onChange={(e) =>
                        setLine(l.key, { description: e.target.value })
                      }
                      placeholder="Description"
                      aria-label={`Description, line ${i + 1}`}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      inputMode="decimal"
                      value={l.qty}
                      onChange={(e) => setLine(l.key, { qty: e.target.value })}
                      aria-label={`Qty, line ${i + 1}`}
                      className="ml-auto w-16 text-right tabular-nums"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      inputMode="decimal"
                      value={l.unitPrice}
                      onChange={(e) =>
                        setLine(l.key, { unitPrice: e.target.value })
                      }
                      aria-label={`Rate, line ${i + 1}`}
                      className="ml-auto w-28 text-right tabular-nums"
                    />
                  </TableCell>
                  <TableCell className="pt-4 text-right tabular-nums text-foreground">
                    {lineReady(l) ? formatSgd(lineAmount(l)) : ''}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="size-8"
                      aria-label={`Delete line ${i + 1}`}
                      disabled={lines.length === 1}
                      onClick={() =>
                        onChange(lines.filter((x) => x.key !== l.key))
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
          {actions}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onChange([...lines, emptyProductLine(nextKey())])}
          >
            <Plus className="size-3.5" />
            Add line
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onChange([emptyProductLine(nextKey())])}
          >
            Clear all
          </Button>
        </div>
      </div>
      {showErrors && !productLinesValid(lines) && (
        <FieldError>
          Each line needs a product or service, a quantity above 0 and a rate.
        </FieldError>
      )}
    </>
  );
}
