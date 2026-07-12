import { AlertTriangle, CalendarDays } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { CalendarAdminClient } from '@/components/attendance/calendar/calendar-admin-client';
import { SisPageHeader } from '@/components/sis/sis-page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import {
  ensureTermSeeded,
  getCalendarEventsForAy,
  getSchoolCalendarForAy,
  weekdaysBetween,
} from '@/lib/attendance/calendar';
import { logAction } from '@/lib/audit/log-action';
import { AUDIENCE_VALUES, type Audience } from '@/lib/schemas/attendance';
import { createClient, getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

function parseAudience(raw: string | undefined): Audience {
  return AUDIENCE_VALUES.includes(raw as Audience) ? (raw as Audience) : 'all';
}

// Compact "Jul 23" headline date — mirrors calendar-cell.tsx's
// formatHumanDate local-date-safe parse pattern, without the weekday/year.
function formatShortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-SG', {
    month: 'short',
    day: 'numeric',
  });
}

export default async function SisCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ audience?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (
    sessionUser.role !== 'registrar' &&
    sessionUser.role !== 'school_admin' &&
    sessionUser.role !== 'superadmin'
  ) {
    redirect('/');
  }

  const sp = await searchParams;
  const audience = parseAudience(sp.audience);
  const supabase = await createClient();

  const { data: ay } = await supabase
    .from('academic_years')
    .select('id, ay_code, label')
    .eq('is_current', true)
    .single();

  const { data: termsRaw } = ay
    ? await supabase
        .from('terms')
        .select('id, label, term_number, start_date, end_date')
        .eq('academic_year_id', ay.id)
        .order('term_number', { ascending: true })
    : { data: [] };

  type TermRow = {
    id: string;
    label: string;
    term_number: number;
    start_date: string | null;
    end_date: string | null;
  };
  const terms = (termsRaw ?? []) as TermRow[];
  const dated = terms.filter((t) => !!t.start_date && !!t.end_date);

  // Auto-seed EVERY dated term: every weekday in a term is a school day by
  // default. ensureTermSeeded is idempotent — it inserts only the dates missing
  // from school_calendar, so existing overrides (public_holiday, hbl, etc.) are
  // preserved and partially-seeded terms get backfilled. Run before reading the
  // calendar so a freshly-set-up AY renders fully on first visit.
  let totalInserted = 0;
  if (dated.length > 0) {
    const insertedCounts = await Promise.all(
      dated.map((t) =>
        ensureTermSeeded(
          t.id,
          t.start_date as string,
          t.end_date as string,
          sessionUser.id
        )
      )
    );
    totalInserted = insertedCounts.reduce((a, b) => a + b, 0);
    if (totalInserted > 0) {
      await logAction({
        service: createServiceClient(),
        actor: { id: sessionUser.id, email: sessionUser.email ?? null },
        action: 'attendance.calendar.autoseed',
        entityType: 'school_calendar',
        entityId: ay?.id ?? null,
        context: { ayCode: ay?.ay_code ?? null, inserted: totalInserted },
      });
    }
  }

  // AY-wide calendar rows + overlay events — independent after seeding, fetch
  // in parallel.
  const [calendar, events] =
    ay && dated.length > 0
      ? await Promise.all([
          getSchoolCalendarForAy(ay.id, audience),
          getCalendarEventsForAy(ay.id, audience),
        ])
      : [[], []];

  // Mirrors the fail-closed gate in app/api/attendance/daily/route.ts's
  // isNonSchoolDay: a date inside a term that has ANY calendar rows, but no
  // row of its own, will be blocked. Surfaced here so a registrar sees it
  // before a teacher hits the 409.
  //
  // Weekday-scoped (via the same `weekdaysBetween` helper `ensureTermSeeded`
  // uses to auto-seed above): `isNonSchoolDay` itself has no day-of-week
  // check, but weekends structurally never carry a school_calendar row (only
  // weekdays get auto-seeded, and HFSE doesn't hold weekday-style classes on
  // Sat/Sun), so scanning every day of the term would flag every weekend as
  // "missing" — always non-empty, not actionable. Scoping to weekdays keeps
  // the panel honest for the gap it's meant to catch: a school day nobody
  // ever categorised.
  const datesWithRows = new Set(calendar.map((c) => c.date));
  const missingDates = dated.flatMap((t) => {
    const termHasAnyRows = calendar.some((c) => c.termId === t.id);
    if (!termHasAnyRows) return [];
    return weekdaysBetween(t.start_date as string, t.end_date as string).filter(
      (d) => !datesWithRows.has(d)
    );
  });

  return (
    <PageShell className="max-w-[1400px]">
      <SisPageHeader
        group="This year"
        title="School days & events."
        description="Mark school days, closures, and calendar events per term — the attendance grid follows this calendar."
        chips={
          ay && (
            <Badge
              variant="outline"
              className="h-7 border-border bg-card px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
            >
              {ay.ay_code}
            </Badge>
          )
        }
      />

      {terms.length === 0 ? (
        <Card className="items-center py-12 text-center">
          <CardContent className="flex flex-col items-center gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-b from-accent/20 to-accent/5 text-accent-foreground ring-1 ring-inset ring-accent/30">
              <CalendarDays className="size-5" aria-hidden />
            </span>
            <div className="font-serif text-lg font-semibold text-foreground">
              No terms configured
            </div>
            <p className="max-w-sm text-sm text-muted-foreground">
              Seed terms for the current academic year first, then come back
              here to mark school days and events.
            </p>
            <Button asChild size="sm" variant="outline">
              <Link href="/sis/ay-setup">Go to AY Setup</Link>
            </Button>
          </CardContent>
        </Card>
      ) : dated.length === 0 ? (
        <Card>
          <CardHeader>
            <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
              {ay?.ay_code ?? ''} · Term dates needed
            </CardDescription>
            <CardTitle className="font-serif text-[20px] font-semibold tracking-tight text-foreground">
              No term dates set yet
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-xl border border-brand-amber/40 bg-brand-amber-light/40 p-4 text-sm text-foreground">
              <p className="font-medium">
                The terms for {ay?.label ?? 'this academic year'} don&apos;t
                have start &amp; end dates yet.
              </p>
              <p className="mt-1 text-muted-foreground">
                The calendar can&apos;t render a month view without them. Set
                the dates in{' '}
                <Link
                  href="/sis/ay-setup"
                  className="font-medium text-primary underline underline-offset-2"
                >
                  AY Setup
                </Link>{' '}
                (superadmin), then come back here.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {missingDates.length > 0 && (
            <div className="flex items-start gap-4 rounded-xl border border-destructive/30 bg-destructive/5 p-5">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-destructive text-destructive-foreground shadow-brand-tile">
                <AlertTriangle className="size-4" />
              </div>
              <div className="flex-1 space-y-1.5">
                <p className="font-serif text-base font-semibold leading-tight text-foreground">
                  {formatShortDate(missingDates[0])} will block attendance entry
                  {missingDates.length > 1 &&
                    ` (+${missingDates.length - 1} more)`}
                </p>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  This term already has other days marked, so an unlisted date
                  reads as a holiday and teachers get blocked when they try to
                  mark it.
                </p>
              </div>
            </div>
          )}
          <CalendarAdminClient
            ayId={ay!.id}
            terms={dated.map((t) => ({
              id: t.id,
              label: t.label,
              termNumber: t.term_number,
              startDate: t.start_date as string,
              endDate: t.end_date as string,
            }))}
            level={audience}
            calendar={calendar}
            events={events}
            // Copy-from-prior-AY is per-term (single target term + year); it
            // doesn't map cleanly onto the AY-wide surface. Passed null for now —
            // to be re-wired as a follow-up once the target-term picker lands.
            copyFromPriorAyProps={null}
          />
        </>
      )}
    </PageShell>
  );
}
