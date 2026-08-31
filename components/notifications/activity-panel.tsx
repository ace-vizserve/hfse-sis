'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Activity, CalendarIcon, ChevronRight, Search, X } from 'lucide-react';
import type { DateRange as DayPickerRange } from 'react-day-picker';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
  formatRangeLabel,
  parseLocalDate,
  toISODate,
  type DateRange,
} from '@/lib/dashboard/range';
import { apiFetch } from '@/lib/query/fetcher';
import { queryKeys } from '@/lib/query/keys';
import type { ActivityEvent } from '@/lib/activity/events';
import { ActivityRow } from '@/components/notifications/activity-row';

type WaitingItem = {
  id: string;
  requestId: string;
  title: string;
  subtitle: string;
  href: string;
  initials: string;
};

type Page = {
  events: ActivityEvent[];
  nextCursor: { at: string; id: string } | null;
  waiting: WaitingItem[];
  partial: boolean;
  truncated: boolean;
};

const TABS = [
  { value: 'general', label: 'General' },
  { value: 'grade_change', label: 'Mark changes' },
  { value: 'student_declaration', label: 'Declarations' },
] as const;

/**
 * Hold a value back until it stops changing. Local to this panel — the one
 * consumer — rather than a shared hook nothing else has asked for yet.
 */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}

/** The empty range — both ends blank, which the picker renders as placeholders. */
const NO_RANGE: DateRange = { from: '', to: '' };

// NOT the shared `DateRangePicker`. That one is a dashboard toolbar control —
// two typed YYYY-MM-DD fields beside a preset rail and two months of calendar,
// close to 700px — which in a 552px side sheet opens across the page
// underneath it, and puts a date format in front of someone who just wants
// last week. Here the trigger is one button reading "Any dates" or "31 Aug –
// 4 Sep", and the calendar lives behind it.
function DateRangeButton({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (next: DateRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const from = parseLocalDate(value.from);
  const to = parseLocalDate(value.to);
  const isSet = Boolean(from && to);

  // ⚠ THE HALF-PICKED RANGE LIVES HERE, NOT IN `value`. Committing the first
  // click as `{from: d, to: d}` makes the calendar's selection COMPLETE, and a
  // complete range means the next click starts a fresh one — so no second date
  // could ever be added and every click just moved a one-day range. The range
  // is only handed up once both ends exist.
  const [pending, setPending] = useState<DayPickerRange | undefined>(undefined);

  // Reopening starts from whatever is committed, so an existing range can be
  // adjusted rather than re-picked from scratch.
  useEffect(() => {
    if (open) setPending(from && to ? { from, to } : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            'h-10 shrink-0 justify-start gap-2 px-3 font-normal',
            !isSet && 'text-muted-foreground'
          )}
        >
          <CalendarIcon className="size-3.5 shrink-0 opacity-70" aria-hidden />
          <span className="text-[13px]">
            {isSet ? formatRangeLabel(value) : 'Any dates'}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <Calendar
          mode="range"
          numberOfMonths={1}
          defaultMonth={from ?? undefined}
          selected={pending}
          // ⚠ NOTHING IS COMMITTED FROM HERE. In this version of the calendar
          // the FIRST click already returns `to` set to the same day as `from`,
          // so "both ends are set" is true after one click and cannot be used
          // to detect a finished range — that is what made every second click
          // start over on a one-day range. The reader says when they are done,
          // with Apply.
          onSelect={setPending}
        />
        <div className="flex items-center justify-between gap-2 border-t border-border p-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs"
            disabled={!isSet && !pending?.from}
            onClick={() => {
              setPending(undefined);
              onChange(NO_RANGE);
              setOpen(false);
            }}
          >
            Clear dates
          </Button>
          <Button
            size="sm"
            className="text-xs"
            disabled={!pending?.from}
            onClick={() => {
              if (!pending?.from) return;
              onChange({
                from: toISODate(pending.from),
                to: toISODate(pending.to ?? pending.from),
              });
              setOpen(false);
            }}
          >
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * A `yyyy-MM-dd` date turned into an instant, in the READER's timezone.
 * Resolving these on the server would anchor them to UTC — 8am in Singapore —
 * so a range ending "today" would drop everything after 8am on its last day.
 * `endOfDay` pushes to the last millisecond so the end date is inclusive.
 */
function toInstant(date: string, endOfDay = false): string | undefined {
  const parsed = parseLocalDate(date);
  if (!parsed) return undefined;
  if (endOfDay) parsed.setHours(23, 59, 59, 999);
  else parsed.setHours(0, 0, 0, 0);
  return parsed.toISOString();
}

export function ActivityPanel({ onNavigate }: { onNavigate: () => void }) {
  const [tab, setTab] = useState<string>('general');
  const [range, setRange] = useState<DateRange>(NO_RANGE);
  const [search, setSearch] = useState('');
  // Typing must not fire a request per keystroke — the feed is derived on the
  // server and each call rebuilds both sources.
  const debouncedSearch = useDebouncedValue(search, 300);

  const since = toInstant(range.from);
  const until = toInstant(range.to, true);
  const hasFilters = Boolean(since || until || debouncedSearch.trim());

  const query = useInfiniteQuery({
    queryKey: queryKeys.activityFeed(
      tab,
      `${range.from}|${range.to}|${debouncedSearch.trim()}`
    ),
    initialPageParam: null as { at: string; id: string } | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ tab, limit: '20' });
      if (since) params.set('since', since);
      if (until) params.set('until', until);
      if (debouncedSearch.trim()) params.set('q', debouncedSearch.trim());
      if (pageParam) params.set('cursor', `${pageParam.at}|${pageParam.id}`);
      return apiFetch<Page>(`/api/activity?${params.toString()}`, {
        credentials: 'include',
        signal,
      });
    },
    getNextPageParam: (last) => last.nextCursor,
    // The panel mounts only while the sheet is open, so this is never a wasted
    // background fetch — and a fresh read on open keeps the list from
    // disagreeing with the live badge beside it.
    staleTime: 0,
  });

  const pages = query.data?.pages ?? [];
  const events = pages.flatMap((p) => p.events);
  // The waiting list is the same on every page; take the first.
  const waiting = pages[0]?.waiting ?? [];
  const partial = pages.some((p) => p.partial);
  // ⚠ F5 — computed since Task 3, plumbed onto `Page`, and never rendered
  // until now. A source hitting SOURCE_CAP makes its tail unreachable, and
  // `nextCursor` eventually reads `null` — indistinguishable from "you have
  // reached the end" without this line.
  const truncated = pages.some((p) => p.truncated);

  return (
    // ⚠ This wrapper is what makes the log scroll. SheetContent is a plain
    // block with h-full, so a flex column has to be declared here.
    <div className="flex h-full min-h-0 flex-col">
      {waiting.length > 0 && (
        <div className="border-b border-border bg-accent/60">
          <div className="flex items-center gap-2.5 px-6 pb-3 pt-5">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-accent-foreground">
              Waiting for you
            </span>
            <span className="rounded-full bg-primary px-2 py-0.5 font-mono text-[10px] font-semibold tabular-nums text-primary-foreground">
              {waiting.length}
            </span>
          </div>
          <ul className="flex flex-col gap-2 px-3.5 pb-4">
            {waiting.map((item) => (
              <li key={item.id}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  className="flex items-center gap-3.5 rounded-xl border border-brand-indigo-soft/40 bg-card px-4 py-3.5 transition-all hover:-translate-y-px hover:border-brand-indigo-soft hover:shadow-md"
                >
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-indigo to-brand-navy text-[13px] font-semibold text-white shadow-brand-tile">
                    {item.initials}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium text-foreground">
                      {item.title}
                    </span>
                    <span className="mt-1 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {item.subtitle}
                    </span>
                  </span>
                  <ChevronRight
                    className="size-4 shrink-0 text-ink-5"
                    aria-hidden
                  />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-3 border-b border-border px-6 py-5">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="flex-1">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {/* One row. The sheet is 552px wide, so after the 48px of padding the
            range picker's fixed ~284px (icon + two date fields + arrow) leaves
            the search box a workable ~210px — both at h-10 so they sit on one
            baseline. */}
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-ink-4"
              aria-hidden
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, action or note…"
              aria-label="Search activity"
              className="h-10 pl-9 pr-9 text-[13px]"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-ink-4 transition hover:bg-accent hover:text-accent-foreground"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            )}
          </div>

          <DateRangeButton value={range} onChange={setRange} />
        </div>

        {hasFilters && (
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Filtered
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => {
                setSearch('');
                setRange(NO_RANGE);
              }}
            >
              <X className="mr-1 size-3" aria-hidden />
              Clear filters
            </Button>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {query.isLoading ? (
          <div className="space-y-3 p-6">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : query.isError ? (
          // ⚠ F3 — the route swallows a server-side failure into a 200 with
          // `partial: true`, but an expired session, a 401, or a dropped
          // network makes `apiFetch` itself throw, which the empty-state
          // branch below would silently read as "nothing has happened".
          <div className="flex flex-col items-center justify-center gap-2 px-10 py-14 text-center">
            <p className="text-[14.5px] leading-relaxed text-muted-foreground">
              Some activity couldn&apos;t be loaded right now.
            </p>
          </div>
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3.5 px-10 py-14 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl border border-border bg-defe text-ink-5">
              <Activity className="size-6" aria-hidden />
            </span>
            {/* An active filter makes "Nothing yet" untrue — there may be
                plenty, just not in the range or matching the words the reader
                chose. Say which it is, and give them the way back. */}
            <p className="mt-1.5 font-serif text-xl font-semibold text-foreground">
              {hasFilters ? 'No matches.' : 'Nothing yet.'}
            </p>
            <p className="max-w-[32ch] text-[14.5px] leading-relaxed text-muted-foreground">
              {hasFilters
                ? 'Nothing here matches those filters. Widen the dates, or search for something else.'
                : 'Approvals you’re part of will appear here as they move — filed, approved, turned down.'}
            </p>
            {hasFilters && (
              <Button
                size="sm"
                className="mt-1"
                onClick={() => {
                  setSearch('');
                  setRange(NO_RANGE);
                }}
              >
                Clear filters
              </Button>
            )}
          </div>
        ) : (
          <>
            <ul>
              {events.map((event) => (
                <ActivityRow
                  key={event.id}
                  event={event}
                  onNavigate={onNavigate}
                />
              ))}
            </ul>
            {query.hasNextPage && (
              <div className="flex justify-center border-t border-border px-4 py-6">
                <Button
                  variant="ghost"
                  size="sm"
                  loading={query.isFetchingNextPage}
                  loadingText="Loading…"
                  onClick={() => void query.fetchNextPage()}
                >
                  Show older activity
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ⚠ F5 — deliberately OUTSIDE the overflow-y-auto container above. A
          long list used to push these below the fold, where the person they
          most need to reach — someone scrolled deep into a truncated or
          partial log — would never see them. */}
      {partial && (
        <p className="border-t border-border px-6 py-3 text-center text-[13px] text-muted-foreground">
          Some activity couldn&apos;t be loaded. This list may be short.
        </p>
      )}
      {truncated && (
        <p className="border-t border-border px-6 py-3 text-center text-[13px] text-muted-foreground">
          Only the most recent activity is available here.
        </p>
      )}

      <p className="border-t border-border bg-muted px-6 py-4 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-ink-5">
        Showing only approvals you are part of
      </p>
    </div>
  );
}
