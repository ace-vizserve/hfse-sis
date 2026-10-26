import Link from 'next/link';
import { redirect } from 'next/navigation';

import { MySowsTable, type MySowListRow } from '@/components/sow/my-sows-table';
import { NoCurrentAyCard } from '@/components/ui/no-current-ay-card';
import { PageShell } from '@/components/ui/page-shell';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getCurrentAcademicYear } from '@/lib/academic-year';
import { getTermsForAy } from '@/lib/classroom/queries';
import { sgToday } from '@/lib/dates';
import { resolveCurrentTermId } from '@/lib/sis/current-term';
import { listMySowRows } from '@/lib/sow/access';
import { findLastYearSow } from '@/lib/sow/create';
import { loadSowStepLabels } from '@/lib/sow/review';
import { createServiceClient } from '@/lib/supabase/service';
import { getSessionUser } from '@/lib/supabase/server';

// My schemes of work (board 1). One tab per term of the current year, always
// one set — the current term by default, `?term=N` to pick another. There is
// no "all terms" view: a scheme belongs to one term.
//
// Reads go through the service client after the session check: the rows are
// derived from the caller's own assignments (`listMySowRows`), which is the
// scoping, and the SOW tables have no staff read policy of their own.

export default async function MySchemesOfWorkPage({
  searchParams,
}: {
  searchParams: Promise<{ term?: string }>;
}) {
  const { term: termParam } = await searchParams;
  const view = await getSessionUser();
  if (!view) redirect('/login');

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
  const termId =
    picked?.id ??
    resolveCurrentTermId(terms, sgToday()) ??
    terms[0]?.id ??
    null;
  const term = terms.find((t) => t.id === termId) ?? null;

  const service = createServiceClient();
  const base = term ? await listMySowRows(service, view.id, term.id) : [];

  // The drawer's checkboxes: every class of the row's level and track this
  // year, not only the teacher's own (a scheme can cover a colleague's class).
  const levelIds = [...new Set(base.map((r) => r.levelId))];
  const { data: sectionRows } =
    levelIds.length > 0
      ? await service
          .from('sections')
          .select('id, name, level_id, class_type')
          .eq('academic_year_id', ay.id)
          .in('level_id', levelIds)
      : { data: [] };
  const sections = (sectionRows ?? []) as {
    id: string;
    name: string;
    level_id: string;
    class_type: string | null;
  }[];

  // The step each sent scheme waits on, or that returned it — one ladder read
  // for the whole list.
  const stepLabels = await loadSowStepLabels(
    service,
    base.flatMap((r) =>
      r.sow &&
      (r.sow.state === 'in_review' || r.sow.state === 'returned') &&
      r.sow.currentSubmissionId
        ? [r.sow.currentSubmissionId]
        : []
    )
  );

  const rows: MySowListRow[] = await Promise.all(
    base.map(async (r) => ({
      ...r,
      stepLabel: r.sow?.currentSubmissionId
        ? (stepLabels.get(r.sow.currentSubmissionId) ?? null)
        : null,
      lastYear: r.sow
        ? null
        : await findLastYearSow(service, {
            termId: r.termId,
            subjectId: r.subjectId,
            levelId: r.levelId,
            track: r.track,
          }),
      groupSections: sections
        .filter(
          (s) =>
            s.level_id === r.levelId &&
            (s.class_type === 'Global' ? 'Global' : 'Standard') === r.track
        )
        .map((s) => ({ sectionId: s.id, name: s.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }))
  );

  const termLabel = term ? `Term ${term.term_number}` : '';

  return (
    <PageShell>
      <header className="space-y-4">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Classroom · {ay.ay_code}
        </p>
        <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
          My schemes of work.
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          One per subject, level and track each term. Start from last
          year&rsquo;s, change what&rsquo;s different, then send it for review.
        </p>
      </header>

      <MySowsTable
        rows={rows}
        termLabel={termLabel}
        ayCode={ay.ay_code}
        termTabs={
          terms.length > 0 && (
            <Tabs value={termId ?? undefined}>
              <TabsList>
                {terms.map((t) => (
                  <TabsTrigger key={t.id} value={t.id} asChild>
                    <Link href={`/classroom/sow?term=${t.term_number}`}>
                      Term {t.term_number}
                    </Link>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )
        }
      />
    </PageShell>
  );
}
