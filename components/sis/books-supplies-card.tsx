'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Package } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import { queryKeys } from '@/lib/query/keys';
import type {
  StudentSupplies,
  StudentSupplyGroup,
  StudentSupplyItem,
} from '@/lib/sis/supplies/types';
import { cn } from '@/lib/utils';

// Books & supplies tracker — the checklist INSIDE the Supplies stage tile
// (migration 199). Staff tick, per student, which books and supplies were
// handed over. The tile shows how far along it is and a button that opens the
// list in a side sheet; it is not a card of its own (Mr Ace, 2026-10-28: "we
// already have a supplies status").
//
// ⚠ TICKING NEVER CHANGES THE STAGE. The tile's badge is the stage's own
// `suppliesStatus`; this only writes handover rows
// (app/api/sis/students/[enroleeNumber]/supplies/route.ts).
//
// Ticks are optimistic: the row flips on click and rolls back, with the
// server's message as a toast, if the POST fails.

type Props = {
  ayCode: string;
  enroleeNumber: string;
  canEdit: boolean;
};

type TickVars = { itemIds: string[]; given: boolean };

const NO_CLASS_COPY =
  "Assign a class to see this student's books and supplies.";

const DAY_MONTH = new Intl.DateTimeFormat('en-SG', {
  day: 'numeric',
  month: 'short',
  timeZone: 'Asia/Singapore',
});

function givenLabel(given: NonNullable<StudentSupplyItem['given']>): string {
  const day = DAY_MONTH.format(new Date(given.at));
  return given.byName ? `Given ${day} · ${given.byName}` : `Given ${day}`;
}

function countGiven(items: StudentSupplyItem[]): number {
  return items.filter((i) => i.given).length;
}

/** The list as it will look once the tick lands — the optimistic copy. */
function applyTick(
  list: StudentSupplies,
  { itemIds, given }: TickVars
): StudentSupplies {
  if ('needsClass' in list) return list;
  const ids = new Set(itemIds);
  const now = new Date().toISOString();
  return {
    groups: list.groups.map((g) => ({
      ...g,
      items: g.items.map((i) =>
        !ids.has(i.id) || Boolean(i.given) === given
          ? i
          : { ...i, given: given ? { at: now, byName: null } : null }
      ),
    })),
  };
}

/**
 * The Supplies stage's Edit dialog asks the tile to open its checklist with
 * this event (detail: the enrolee number). The dialog closes first, so the
 * sheet never opens on top of it (no nested overlays).
 */
export const OPEN_SUPPLIES_CHECKLIST = 'sis:open-supplies-checklist';

export function openSuppliesChecklist(enroleeNumber: string) {
  window.dispatchEvent(
    new CustomEvent(OPEN_SUPPLIES_CHECKLIST, { detail: { enroleeNumber } })
  );
}

/** One student's list — shared by the tile and the stage dialog's summary. */
function useStudentSupplies(ayCode: string, enroleeNumber: string) {
  const key = queryKeys.studentSupplies(ayCode, enroleeNumber);
  const url = `/api/sis/students/${encodeURIComponent(enroleeNumber)}/supplies`;
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      apiFetch<StudentSupplies>(`${url}?ay=${encodeURIComponent(ayCode)}`, {
        signal,
      }),
  });
  const data = query.data;
  const groups = data && !('needsClass' in data) ? data.groups : null;
  return { key, url, query, groups };
}

function noListCopy(ayCode: string) {
  return `No book list has been loaded for ${ayCode} yet.`;
}

/**
 * The brief view inside the Supplies stage's Edit dialog: how many books and
 * supplies are given, and a button that opens the full checklist.
 */
export function SuppliesSummary({
  ayCode,
  enroleeNumber,
  onOpen,
}: {
  ayCode: string;
  enroleeNumber: string;
  onOpen: () => void;
}) {
  const { query, groups } = useStudentSupplies(ayCode, enroleeNumber);
  const books = groups?.filter((g) => g.kind === 'book') ?? [];
  const supplies = groups?.filter((g) => g.kind === 'supply') ?? [];
  const tally = (gs: StudentSupplyGroup[]) => {
    const items = gs.flatMap((g) => g.items);
    return { given: countGiven(items), total: items.length };
  };
  const b = tally(books);
  const s = tally(supplies);

  return (
    <div className="space-y-2.5 rounded-lg border border-hairline p-4">
      <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Books &amp; supplies
      </p>
      {query.isPending ? (
        <Skeleton className="h-10 rounded-md" />
      ) : query.isError ? (
        <p className="text-sm text-muted-foreground">
          Books and supplies could not be loaded.
        </p>
      ) : !groups ? (
        <p className="text-sm text-muted-foreground">{NO_CLASS_COPY}</p>
      ) : b.total + s.total === 0 ? (
        <p className="text-sm text-muted-foreground">{noListCopy(ayCode)}</p>
      ) : (
        <>
          <p className="text-sm text-foreground">
            <span className="font-semibold tabular-nums">
              {b.given + s.given} of {b.total + s.total}
            </span>{' '}
            given
            <span className="text-muted-foreground">
              {' '}
              · books {b.given} of {b.total} · supplies {s.given} of {s.total}
            </span>
          </p>
          <Button type="button" variant="outline" size="sm" onClick={onOpen}>
            <Package className="size-3.5" aria-hidden />
            Open books &amp; supplies
          </Button>
        </>
      )}
    </div>
  );
}

export function SuppliesChecklist({ ayCode, enroleeNumber, canEdit }: Props) {
  const queryClient = useQueryClient();
  const { key, url, query, groups } = useStudentSupplies(ayCode, enroleeNumber);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Opened from the stage's Edit dialog (see OPEN_SUPPLIES_CHECKLIST).
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ enroleeNumber: string }>).detail;
      if (detail?.enroleeNumber === enroleeNumber) setSheetOpen(true);
    };
    window.addEventListener(OPEN_SUPPLIES_CHECKLIST, onOpen);
    return () => window.removeEventListener(OPEN_SUPPLIES_CHECKLIST, onOpen);
  }, [enroleeNumber]);

  const tick = useMutation({
    mutationKey: [...key, 'tick'],
    mutationFn: (vars: TickVars) =>
      apiFetch<StudentSupplies>(url, jsonInit('POST', { ay: ayCode, ...vars })),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<StudentSupplies>(key);
      if (prev) queryClient.setQueryData(key, applyTick(prev, vars));
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(key, ctx.prev);
    },
    onSuccess: (fresh) => {
      // With ticks still in flight, a fresh list from an earlier POST would
      // wipe their optimistic rows — the last one to land writes the list.
      if (queryClient.isMutating({ mutationKey: [...key, 'tick'] }) <= 1) {
        queryClient.setQueryData(key, fresh);
      }
    },
  });

  const run = useWriteAction();
  const send = (vars: TickVars) =>
    run(() => tick.mutateAsync(vars), {
      // The row flips on click, so a toast for success would be noise; a
      // failure still toasts (the route's own message) after the rollback.
      pending: false,
      success: () => null,
      refresh: false,
    });

  const allItems = groups?.flatMap((g) => g.items) ?? [];
  const total = allItems.length;
  const givenCount = countGiven(allItems);
  const pct = total ? Math.round((givenCount / total) * 100) : 0;

  const progress = (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="font-semibold tabular-nums text-foreground">
          {givenCount} of {total} given
        </span>
        <span className="tabular-nums text-muted-foreground">
          {givenCount === total ? 'All given' : `${total - givenCount} to go`}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Books and supplies given"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={givenCount}
        className="h-1.5 overflow-hidden rounded-full bg-hairline"
      >
        <div
          className="h-full rounded-full bg-brand-mint transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );

  // On the tile: how far along, and the button that opens the list.
  if (query.isPending) return <Skeleton className="ml-1 h-9 rounded-md" />;
  if (query.isError) {
    return (
      <div className="flex flex-wrap items-center gap-2 pl-1 text-xs text-muted-foreground">
        Books and supplies could not be loaded.
        <Button variant="outline" size="sm" onClick={() => query.refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  if (!groups) {
    return (
      <p className="pl-1 text-xs text-muted-foreground">{NO_CLASS_COPY}</p>
    );
  }
  if (total === 0) {
    return (
      <p className="pl-1 text-xs text-muted-foreground">{noListCopy(ayCode)}</p>
    );
  }

  return (
    <div className="flex flex-col gap-2.5 pl-1">
      {progress}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetTrigger asChild>
          <Button variant="outline" size="sm" className="self-start">
            <Package className="size-3.5" aria-hidden />
            Books &amp; supplies
          </Button>
        </SheetTrigger>
        <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
          <SheetHeader className="shrink-0 space-y-3 border-b border-border p-6">
            <SheetTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
              Books &amp; supplies
            </SheetTitle>
            <SheetDescription className="text-sm text-muted-foreground">
              {canEdit
                ? 'Tick each item as it is handed over.'
                : 'What this student has been given.'}
            </SheetDescription>
            {progress}
          </SheetHeader>
          {/* A block, not a flex column: in a flex column the groups shrink
              to fit the sheet and cut their rows off instead of scrolling. */}
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6">
            {groups.map((g) => (
              <SupplyGroup
                key={`${g.kind}:${g.name}`}
                group={g}
                canEdit={canEdit}
                onTick={send}
              />
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function SupplyGroup({
  group,
  canEdit,
  onTick,
}: {
  group: StudentSupplyGroup;
  canEdit: boolean;
  onTick: (vars: TickVars) => void;
}) {
  const done = countGiven(group.items);
  const ungiven = group.items.filter((i) => !i.given).map((i) => i.id);
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className="overflow-hidden rounded-lg border border-hairline"
    >
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-hairline bg-muted/40 px-4 py-2">
        <div className="flex items-baseline gap-2">
          <h3
            id={headingId}
            className="text-[13px] font-semibold text-foreground"
          >
            {group.name}
          </h3>
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {done} of {group.items.length}
          </span>
        </div>
        {canEdit && ungiven.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            aria-label={`Tick all ${group.name}`}
            onClick={() => onTick({ itemIds: ungiven, given: true })}
          >
            Tick all
          </Button>
        )}
      </div>
      <ul className="divide-y divide-hairline">
        {group.items.map((item) => (
          <SupplyRow
            key={item.id}
            item={item}
            canEdit={canEdit}
            onTick={onTick}
          />
        ))}
      </ul>
    </section>
  );
}

function SupplyRow({
  item,
  canEdit,
  onTick,
}: {
  item: StudentSupplyItem;
  canEdit: boolean;
  onTick: (vars: TickVars) => void;
}) {
  const id = useId();
  const given = Boolean(item.given);

  return (
    <li
      className={cn(
        'transition-colors',
        given && 'bg-brand-mint/[0.07]',
        canEdit && 'hover:bg-muted/60'
      )}
    >
      <label
        htmlFor={id}
        className={cn(
          'flex min-h-11 items-start gap-3 px-4 py-2.5',
          canEdit ? 'cursor-pointer' : 'cursor-default'
        )}
      >
        <Checkbox
          id={id}
          checked={given}
          disabled={!canEdit}
          onCheckedChange={(v) =>
            onTick({ itemIds: [item.id], given: v === true })
          }
          className="mt-0.5"
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm font-medium leading-snug text-foreground">
            {item.title}
          </span>
          {item.meta && (
            <span className="text-xs tabular-nums text-muted-foreground">
              {item.meta}
            </span>
          )}
          {item.given && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-ink-3">
              <CheckCircle2
                className="size-3.5 shrink-0 text-brand-mint"
                aria-hidden
              />
              {givenLabel(item.given)}
            </span>
          )}
        </span>
      </label>
    </li>
  );
}
