import { ArrowLeft, CalendarDays, History } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { CalendarAdminClient } from '@/components/attendance/calendar/calendar-admin-client';
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
} from '@/lib/attendance/calendar';
import { logAction } from '@/lib/audit/log-action';
import { AUDIENCE_VALUES, type Audience } from '@/lib/schemas/attendance';
import { createClient, getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

function parseAudience(raw: string | undefined): Audience {
  return AUDIENCE_VALUES.includes(raw as Audience) ? (raw as Audience) : 'all';
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

  return (
    <PageShell className="max-w-[1400px]">
      <Link
        href="/sis"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        SIS Admin
      </Link>

      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            SIS Admin · School calendar
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            School days &amp; events.
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            Configure which dates are school days, which are closed (greyed out,
            not encodable), and overlay informational events. The attendance
            grid uses this to render only the days students can be marked. Pick
            a term, then view it by month or switch to List for a chronological
            view of every closure and event in that term. Filter by Primary or
            Secondary to manage level-specific overrides alongside the shared
            (All) baseline.
          </p>
        </div>
        <Link
          href="/sis/audit-log"
          className="inline-flex w-fit shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          <History className="h-3.5 w-3.5" />
          View change history
        </Link>
      </header>

      {terms.length === 0 ? (
        <Card className="items-center py-12 text-center">
          <CardContent className="flex flex-col items-center gap-3">
            <CalendarDays className="size-6 text-muted-foreground" />
            <div className="font-serif text-lg font-semibold text-foreground">
              No terms configured
            </div>
            <p className="text-sm text-muted-foreground">
              Seed terms for the current academic year first (AY Setup).
            </p>
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
      )}
    </PageShell>
  );
}
