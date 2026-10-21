'use client';

import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { Link2, Search } from 'lucide-react';
import { useEffect, useState } from 'react';

import { SheetSection } from '@/components/billing/sheet-section';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

type Found = {
  id: string;
  displayName: string;
  active: boolean;
  linkedTo: string | null;
};

// Search every QuickBooks customer and link one to the student — the body of
// To review → Pick another and of Create invoice's "Who is this invoice for"
// step. A customer another student holds is listed but can't be linked; nor
// can an inactive one (QuickBooks won't invoice it).
export function CustomerSearch({
  studentNumber,
  studentName,
  initialSearch,
  onLinked,
  onBusyChange,
  emptyNote,
}: {
  studentNumber: string;
  studentName: string;
  initialSearch: string;
  /** After the link is saved, before the page refreshes. */
  onLinked?: () => void;
  /** A Link is in flight (true) or done (false) — the sheet holds Cancel. */
  onBusyChange?: (busy: boolean) => void;
  /** Shown instead of "No customer has …" when the search is exactly `q`. */
  emptyNote?: { q: string; text: string } | null;
}) {
  const run = useWriteAction();
  const [typed, setTyped] = useState(initialSearch);
  const [q, setQ] = useState(initialSearch.trim());
  const [linking, setLinkingState] = useState<string | null>(null);
  const setLinking = (id: string | null) => {
    setLinkingState(id);
    onBusyChange?.(id !== null);
  };
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
    mutationFn: (customerId: string) =>
      apiFetch<{ displayName: string; historyErrors: string[] }>(
        `/api/billing/students/${encodeURIComponent(studentNumber)}/link`,
        jsonInit('POST', { customerId })
      ),
  });
  const list = found.data?.customers ?? [];

  async function linkTo(customerId: string) {
    setLinking(customerId);
    await run(() => link.mutateAsync(customerId), {
      pending: 'Linking and reading their invoices…',
      success: (d) => `${studentName} linked to ${d.displayName}`,
      onResolved: () => onLinked?.(),
    });
    setLinking(null);
  }

  return (
    <>
      <SheetSection title="Search QuickBooks customers">
        <Field>
          <FieldLabel htmlFor="pick-q" className="sr-only">
            Customer name
          </FieldLabel>
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
          <FieldDescription>
            Any part of the name, at least two letters.
          </FieldDescription>
        </Field>
      </SheetSection>
      {q.length < 2 ? null : (
        <SheetSection
          title="Customers found"
          aside={
            !found.isLoading && !found.isPlaceholderData && !found.isError ? (
              <p className="text-[12px] text-muted-foreground">
                {list.length === 1 ? '1 customer' : `${list.length} customers`}
              </p>
            ) : null
          }
        >
          {found.isError ? (
            <p className="text-sm text-destructive">
              {(found.error as Error).message}
            </p>
          ) : found.isLoading || found.isPlaceholderData ? (
            <p className="text-sm text-muted-foreground">Searching…</p>
          ) : list.length === 0 ? (
            emptyNote && emptyNote.q.trim() === q ? (
              <p className="rounded-lg border border-brand-amber/40 bg-brand-amber/10 px-3 py-2.5 text-sm text-ink">
                {emptyNote.text}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                No QuickBooks customer has “{q}” in their name.
              </p>
            )
          ) : (
            <ul className="space-y-1.5">
              {list.map((c) => {
                const held = !!c.linkedTo && c.linkedTo !== studentNumber;
                const inactive = !c.active;
                return (
                  <li
                    key={c.id}
                    className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {c.displayName}
                      </p>
                      <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
                        {inactive
                          ? held
                            ? `Inactive in QuickBooks · linked to ${c.linkedTo}`
                            : 'Inactive in QuickBooks'
                          : held
                            ? `Linked to ${c.linkedTo}`
                            : 'Not linked'}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={held || inactive || !!linking}
                      loading={linking === c.id}
                      loadingText="Linking…"
                      onClick={() => void linkTo(c.id)}
                    >
                      {held ? (
                        'Linked to another student'
                      ) : inactive ? (
                        'Make it active in QuickBooks first'
                      ) : (
                        <>
                          {linking !== c.id && <Link2 className="size-3.5" />}
                          Link
                        </>
                      )}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-[12px] text-muted-foreground">
            A customer already linked to another student shows here but
            can&rsquo;t be linked again. An inactive customer can be linked once
            it&rsquo;s made active in QuickBooks.
          </p>
        </SheetSection>
      )}
    </>
  );
}
