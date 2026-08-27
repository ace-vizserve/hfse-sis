'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Activity, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
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

export function ActivityPanel({ onNavigate }: { onNavigate: () => void }) {
  const [tab, setTab] = useState<string>('general');

  const query = useInfiniteQuery({
    queryKey: queryKeys.activityFeed(tab),
    initialPageParam: null as { at: string; id: string } | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ tab, limit: '20' });
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

      <div className="border-b border-border px-6 py-5">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="flex-1">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
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
            <span className="flex size-14 items-center justify-center rounded-2xl border border-border bg-muted text-ink-5">
              <Activity className="size-6" aria-hidden />
            </span>
            <p className="mt-1.5 font-serif text-xl font-semibold text-foreground">
              Nothing yet.
            </p>
            <p className="max-w-[32ch] text-[14.5px] leading-relaxed text-muted-foreground">
              Approvals you&apos;re part of will appear here as they move —
              filed, approved, turned down.
            </p>
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
