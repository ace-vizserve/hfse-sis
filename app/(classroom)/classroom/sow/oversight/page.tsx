import {
  BookCheck,
  CalendarCheck,
  Eye,
  Hourglass,
  ShieldOff,
} from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { MetricCard } from '@/components/dashboard/metric-card';
import { ChecksGrid } from '@/components/sow/checks-grid';
import { OversightSowsTable } from '@/components/sow/oversight-sows-table';
import { Card } from '@/components/ui/card';
import { NoCurrentAyCard } from '@/components/ui/no-current-ay-card';
import { PageShell } from '@/components/ui/page-shell';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getCurrentAcademicYear } from '@/lib/academic-year';
import { getTermsForAy } from '@/lib/classroom/queries';
import { sgToday } from '@/lib/dates';
import { resolveCurrentTermId } from '@/lib/sis/current-term';
import { loadOversight, resolveOversightScope } from '@/lib/sow/oversight';
import { createServiceClient } from '@/lib/supabase/service';
import { getSessionUser } from '@/lib/supabase/server';

// Scheme of work oversight (spec §5.3, boards 9–10). Two URL tabs — "SOWs"
// (every scheme of the term with its state) and "Weekly checks" (the grid,
// "Needs a look", and the drawer that signs a week) — for one term of the
// current year, `?term=N` to pick another.
//
// ⚠ THE PAGE IS ITS OWN GATE. The route admits every teacher (it sits under
// `/classroom/sow`), because who oversees is data: a subject head, or someone
// on a named step of the SOW flow. `resolveOversightScope` decides, and
// somebody with no scope gets the "no access" card — a 403 page, not a
// bounce. What they see inside is limited to their scope by `loadOversight`.
//
// Read through the service client after the session check, as every SOW
// screen is: the SOW tables have no staff read policy of their own.

type View = 'sows' | 'checks';

export default async function SowOversightPage({
  searchParams,
}: {
  searchParams: Promise<{ term?: string; view?: string }>;
}) {
  const { term: termParam, view: viewParam } = await searchParams;
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const service = createServiceClient();
  const scope = await resolveOversightScope(service, user.id, user.role);
  if (!scope) {
    return (
      <PageShell>
        <Card className="mx-auto mt-10 max-w-lg items-center gap-3 px-8 py-12 text-center">
          <ShieldOff className="size-7 text-muted-foreground" aria-hidden />
          <h1 className="font-serif text-xl font-semibold tracking-tight text-foreground">
            You don&rsquo;t have access to this page.
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Scheme of work oversight is for subject heads, the people who
            approve schemes of work, and the office. Ask the office if you
            should be one of them.
          </p>
        </Card>
      </PageShell>
    );
  }

  const ay = await getCurrentAcademicYear();
  if (!ay) {
    return (
      <PageShell>
        <NoCurrentAyCard />
      </PageShell>
    );
  }
  const terms = await getTermsForAy(ay.id);
  const picked = terms.find((t) => String(t.term_number) === termParam);
  const term =
    picked ??
    terms.find((t) => t.id === resolveCurrentTermId(terms, sgToday())) ??
    terms[0] ??
    null;
  const view: View = viewParam === 'checks' ? 'checks' : 'sows';

  const data = term
    ? await loadOversight(service, {
        scope,
        viewer: { id: user.id, role: user.role },
        termId: term.id,
        academicYearId: ay.id,
      })
    : null;

  const href = (v: View, termNumber = term?.term_number) =>
    `/classroom/sow/oversight?term=${termNumber ?? ''}${v === 'checks' ? '&view=checks' : ''}`;
  const tiles = data?.tiles;

  return (
    <PageShell>
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Classroom · {ay.ay_code}
            {term ? ` · Term ${term.term_number}` : ''}
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            Scheme of work.
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            {scope.all
              ? 'Every scheme of work this term, and how each class’s weeks are going.'
              : 'The schemes of work you oversee this term, and how each class’s weeks are going.'}{' '}
            Subject heads sign each class&rsquo;s week once they have read it.
          </p>
        </div>
        {terms.length > 1 && (
          <Tabs value={term?.id}>
            <TabsList>
              {terms.map((t) => (
                <TabsTrigger key={t.id} value={t.id} asChild>
                  <Link href={href(view, t.term_number)}>
                    Term {t.term_number}
                  </Link>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}
      </header>

      {tiles && data && (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {view === 'sows' ? (
            <>
              <MetricCard
                label="Waiting on you"
                value={tiles.waitingOnYou}
                icon={Hourglass}
                intent={tiles.waitingOnYou > 0 ? 'warning' : 'default'}
                subtext="Schemes at a step you are on"
              />
              <MetricCard
                label="Approved"
                value={`${tiles.approved} of ${tiles.total}`}
                icon={BookCheck}
                subtext="Schemes of work this term"
              />
              <MetricCard
                label="No SOW yet"
                value={tiles.notStarted}
                icon={Eye}
                intent={tiles.notStarted > 0 ? 'bad' : 'default'}
                subtext="Subjects taught with no scheme started"
              />
            </>
          ) : (
            <>
              <MetricCard
                label="Approved SOWs"
                value={`${tiles.approved} of ${tiles.total}`}
                icon={BookCheck}
                subtext="Schemes of work this term"
              />
              <MetricCard
                label={
                  data.currentWeek
                    ? `Week ${data.currentWeek} checked`
                    : 'This week checked'
                }
                value={
                  tiles.checkedThisWeek
                    ? `${tiles.checkedThisWeek.checked} of ${tiles.checkedThisWeek.of}`
                    : '—'
                }
                icon={CalendarCheck}
                subtext={
                  tiles.checkedThisWeek
                    ? 'Classes whose teachers have all checked'
                    : 'No teaching week today'
                }
              />
              <MetricCard
                label="Needs a look"
                value={data.needsALook.length}
                icon={Eye}
                intent={data.needsALook.length > 0 ? 'warning' : 'default'}
                subtext="Notes, missed checks, two weeks off plan"
              />
            </>
          )}
        </section>
      )}

      <Tabs value={view}>
        <TabsList>
          <TabsTrigger value="sows" asChild>
            <Link href={href('sows')}>
              SOWs
              {data && (
                <span className="ml-1.5 tabular-nums text-muted-foreground">
                  {data.sows.length}
                </span>
              )}
            </Link>
          </TabsTrigger>
          <TabsTrigger value="checks" asChild>
            <Link href={href('checks')}>Weekly checks</Link>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {!data ? (
        <Card className="items-center gap-2 px-6 py-12 text-center">
          <p className="font-serif text-lg font-semibold text-foreground">
            This year has no terms set up yet.
          </p>
        </Card>
      ) : view === 'sows' ? (
        <OversightSowsTable rows={data.sows} />
      ) : (
        <ChecksGrid
          rows={data.grid}
          weekCount={data.weekCount}
          currentWeek={data.currentWeek}
          needsALook={data.needsALook}
        />
      )}
    </PageShell>
  );
}
