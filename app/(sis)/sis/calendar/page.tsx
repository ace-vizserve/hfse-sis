import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, CalendarDays } from 'lucide-react';

import { createClient, getSessionUser } from '@/lib/supabase/server';
import { logAction } from '@/lib/audit/log-action';
import { createServiceClient } from '@/lib/supabase/service';
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
  getCalendarEventsForTerm,
  getSchoolCalendarForTerm,
  listPriorAyEntriesForCopy,
} from '@/lib/attendance/calendar';
import { CalendarAdminClient } from '@/components/attendance/calendar-admin-client';
import { AUDIENCE_VALUES, type Audience } from '@/lib/schemas/attendance';

function parseAudience(raw: string | undefined): Audience {
  return AUDIENCE_VALUES.includes(raw as Audience) ? (raw as Audience) : 'all';
}

export default async function SisCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ term_id?: string; audience?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (
    sessionUser.role !== 'registrar' &&
    sessionUser.role !== 'school_admin' &&
    sessionUser.role !== 'admin' &&
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
        .select('id, label, term_number, start_date, end_date, is_current')
        .eq('academic_year_id', ay.id)
        .order('term_number', { ascending: true })
    : { data: [] };

  type TermRow = {
    id: string;
    label: string;
    term_number: number;
    start_date: string | null;
    end_date: string | null;
    is_current: boolean;
  };
  const terms = (termsRaw ?? []) as TermRow[];
  const defaultTermId =
    sp.term_id ?? terms.find((t) => t.is_current)?.id ?? terms[0]?.id ?? '';

  const selectedTerm = terms.find((t) => t.id === defaultTermId) ?? null;
  const selectedTermHasDates =
    !!selectedTerm && !!selectedTerm.start_date && !!selectedTerm.end_date;
  let calendar = selectedTerm ? await getSchoolCalendarForTerm(selectedTerm.id, audience) : [];

  // Auto-seed: every weekday in the term is a school day by default. The
  // allowlist-model backend needs rows to exist, but the registrar never
  // sees the seeding step — it happens silently on first visit. Seeded
  // rows always land at audience='all'.
  if (selectedTerm && selectedTermHasDates && calendar.length === 0) {
    const inserted = await ensureTermSeeded(
      selectedTerm.id,
      selectedTerm.start_date as string,
      selectedTerm.end_date as string,
      sessionUser.id,
    );
    if (inserted > 0) {
      await logAction({
        service: createServiceClient(),
        actor: { id: sessionUser.id, email: sessionUser.email ?? null },
        action: 'attendance.calendar.autoseed',
        entityType: 'school_calendar',
        entityId: selectedTerm.id,
        context: {
          start: selectedTerm.start_date,
          end: selectedTerm.end_date,
          inserted,
        },
      });
      calendar = await getSchoolCalendarForTerm(selectedTerm.id, audience);
    }
  }

  const events = selectedTerm ? await getCalendarEventsForTerm(selectedTerm.id, audience) : [];

  // Prior-AY entries for the "Copy from prior AY" affordance. Returns both
  // school_calendar overrides AND calendar_events from the same term on the
  // most recent prior real AY.
  const priorEntries = ay && selectedTerm
    ? await listPriorAyEntriesForCopy(ay.id, selectedTerm.term_number)
    : { sourceAy: null, holidays: [], events: [] };
  const targetYear = selectedTerm?.start_date
    ? Number(selectedTerm.start_date.slice(0, 4))
    : new Date().getUTCFullYear();

  return (
    <PageShell className="max-w-[1400px]">
      <Link
        href="/sis"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        SIS Admin
      </Link>

      <header className="space-y-4">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          SIS Admin · School calendar
        </p>
        <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
          School days &amp; holidays.
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Configure which dates are school days, which are holidays (greyed out, not encodable),
          and overlay informational events. The attendance grid uses this to render only the days
          students can be marked. Filter by Primary or Secondary to manage level-specific overrides
          alongside the shared (All) baseline.
        </p>
      </header>

      {terms.length === 0 ? (
        <Card className="items-center py-12 text-center">
          <CardContent className="flex flex-col items-center gap-3">
            <CalendarDays className="size-6 text-muted-foreground" />
            <div className="font-serif text-lg font-semibold text-foreground">No terms configured</div>
            <p className="text-sm text-muted-foreground">
              Seed terms for the current academic year first (AY Setup).
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
              {ay?.ay_code ?? ''} · Configure a term
            </CardDescription>
            <CardTitle className="font-serif text-[20px] font-semibold tracking-tight text-foreground">
              {selectedTerm?.label ?? 'Select a term'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedTerm && !selectedTermHasDates && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-100">
                <p className="font-medium">
                  {selectedTerm.label} doesn&apos;t have start &amp; end dates set yet.
                </p>
                <p className="mt-1 text-amber-800/80 dark:text-amber-200/80">
                  The calendar grid can&apos;t render a month view without them. Set the dates in{' '}
                  <Link
                    href="/sis/ay-setup"
                    className="font-medium text-amber-900 underline underline-offset-2 dark:text-amber-100"
                  >
                    AY Setup
                  </Link>{' '}
                  (superadmin), then come back here.
                </p>
              </div>
            )}
            <CalendarAdminClient
              terms={terms
                .filter((t) => !!t.start_date && !!t.end_date)
                .map((t) => ({
                  id: t.id,
                  label: t.label,
                  startDate: t.start_date as string,
                  endDate: t.end_date as string,
                  isCurrent: t.is_current,
                }))}
              termId={selectedTermHasDates ? defaultTermId : ''}
              audience={audience}
              calendar={selectedTermHasDates ? calendar : []}
              events={selectedTermHasDates ? events : []}
              copyFromPriorAyProps={
                selectedTerm && selectedTermHasDates && priorEntries.sourceAy
                  ? {
                      targetTermId: selectedTerm.id,
                      targetTermLabel: selectedTerm.label,
                      targetYear,
                      sourceAyCode: priorEntries.sourceAy.ay_code,
                      sourceHolidays: priorEntries.holidays,
                      sourceEvents: priorEntries.events,
                    }
                  : null
              }
            />
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}
