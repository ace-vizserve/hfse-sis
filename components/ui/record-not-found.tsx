import { FileQuestion, Home } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';

// What a 404 looks like in the SIS.
//
// 🔴 UNTIL 2026-09-20 IT LOOKED LIKE NOTHING. The app had no `not-found.tsx`
// anywhere, so all 22 dynamic pages that call `notFound()` — every student,
// section, grading sheet, staff and application route — rendered a BLANK
// SCREEN. Mr Ace hit it and reported it as a dead link, which is exactly what
// it looks like from the outside.
//
// ⚠ WHAT A 404 ACTUALLY MEANS HERE, and it is why the copy does not say "page
// not found". Nobody mistypes these URLs — they are reached by clicking. So a
// miss almost always means the RECORD is not there: a child who moved year, a
// sheet that was deleted, a section from an academic year you are not in, or a
// link saved months ago. The page says that, because "page not found" would
// send a registrar looking for a broken menu instead of a moved record.
//
// Design: §7.6 of docs/context/09-design-system.md — "Empty states are never
// blank. A Card with a centered muted icon, one-line serif title, a sentence of
// guidance, and an optional primary CTA. Anything less reads as broken." A 404
// is the strongest empty state in the app, so it uses that recipe exactly
// rather than inventing a second vocabulary for the same job.
export function RecordNotFound({
  /** Where "back to safety" goes. Each module passes its own hub. */
  homeHref = '/',
  homeLabel = 'Go to the dashboard',
  /** The module name, so the eyebrow says where you are. */
  scope,
}: {
  homeHref?: string;
  homeLabel?: string;
  scope?: string;
}) {
  return (
    <PageShell>
      <Card className="mx-auto w-full max-w-xl">
        <CardContent className="flex flex-col items-center gap-5 px-6 py-12 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <FileQuestion className="size-5" strokeWidth={1.75} />
          </div>

          <div className="space-y-2.5">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {scope ? `${scope} · Not found` : 'Not found'}
            </p>
            <h1 className="font-serif text-[28px] font-semibold leading-tight tracking-tight text-foreground">
              We couldn&rsquo;t find that record.
            </h1>
            <p className="mx-auto max-w-md text-[15px] leading-relaxed text-muted-foreground">
              It may have been removed, or it belongs to an academic year you
              aren&rsquo;t viewing. If you followed a saved link, the record it
              pointed to has probably moved.
            </p>
          </div>

          <Button asChild>
            <Link href={homeHref}>
              <Home className="size-4" />
              {homeLabel}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </PageShell>
  );
}
