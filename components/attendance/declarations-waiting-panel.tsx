import Link from 'next/link';
import { MailCheck } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

// "Declarations waiting" — the panel that tells an adviser something has
// arrived, on the page they land on anyway.
//
// ⚠ THIS IS THE NOTIFICATION, AND IT IS DELIBERATELY NOT THE BELL. The
// notification bell is hardwired to `grade_change_requests` at six separate
// layers — the count hook, the server seed count, the preview endpoint, the
// realtime publication from migration 010, `previewRowHref`, and the single
// `changeRequests` badge key — so making it carry a second source is its own
// piece of work. A server-rendered panel on the module index costs one query,
// needs no realtime plumbing, and answers the same question: is there anything
// for me. Modelled on `components/relief/upcoming-cover.tsx`, which does the
// same job for cover.
//
// ⚠ IT LINKS, unlike that one. The cover panel deliberately has no link
// because the classes it lists cannot be opened yet. Everything here can be
// opened right now — that is the entire point of it being here.
//
// Renders nothing when there is nothing waiting. A permanent box explaining an
// absence of news is worse than no box.

export function DeclarationsWaitingPanel({
  count,
  className = '',
}: {
  /** How many are waiting for THIS person to decide — not how many exist. */
  count: number;
  className?: string;
}) {
  if (count <= 0) return null;

  return (
    <section
      className={`rounded-xl border border-brand-indigo-soft bg-accent p-4 ${className}`}
      aria-labelledby="declarations-waiting-heading"
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <MailCheck className="size-4 shrink-0 text-brand-indigo-deep" />
        <h2
          id="declarations-waiting-heading"
          className="font-serif text-base font-semibold text-foreground"
        >
          Waiting for you
        </h2>
        <Badge variant="secondary" className="h-5 tabular-nums">
          {count}
        </Badge>
      </div>

      <p className="pt-1.5 text-sm text-muted-foreground">
        {count === 1
          ? 'A parent has told the school a child will be away, and it needs your decision.'
          : `Parents have told the school about ${count} absences, and they need your decision.`}
      </p>

      <Button asChild variant="outline" size="sm" className="mt-3">
        <Link href="/attendance/declarations">Read them</Link>
      </Button>
    </section>
  );
}
