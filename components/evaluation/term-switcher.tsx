'use client';

import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition, type MouseEvent } from 'react';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

type TermOption = {
  id: string;
  label: string;
  term_number: number;
  is_current: boolean;
};

// Tabs, not a dropdown (Phase 10) — every T1–T3 term is visible + one click
// away, matching the pattern app/(attendance)/attendance/[sectionId] already
// uses for its own term switcher. Each trigger wraps a next/link (asChild)
// that sets ?term_id= and keeps every other query param; the click is
// intercepted so the navigation still runs through useTransition, keeping
// the same "pending" affordance the old Select had while the RSC re-fetches
// the roster for the new term.
export function TermSwitcher({
  current,
  options,
}: {
  current: string;
  options: readonly TermOption[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function hrefFor(termId: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.set('term_id', termId);
    return `?${next.toString()}`;
  }

  function onSelect(e: MouseEvent<HTMLAnchorElement>, termId: string) {
    e.preventDefault();
    const href = hrefFor(termId);
    startTransition(() => {
      router.push(href, { scroll: false });
      router.refresh();
    });
  }

  if (options.length === 0) {
    return <span className="text-sm text-muted-foreground">No terms</span>;
  }

  return (
    <div className="flex items-center gap-2">
      <Tabs value={current} aria-label="Term">
        <TabsList>
          {options.map((t) => (
            <TabsTrigger key={t.id} value={t.id} asChild>
              <Link
                href={hrefFor(t.id)}
                scroll={false}
                onClick={(e) => onSelect(e, t.id)}
              >
                {t.label}
                {t.is_current && (
                  <span className="ml-1 opacity-70">(current)</span>
                )}
              </Link>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {pending && (
        <Loader2
          className="size-4 animate-spin text-muted-foreground"
          aria-hidden
        />
      )}
    </div>
  );
}
