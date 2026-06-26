import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, CalendarRange } from 'lucide-react';

import { NewAyButton } from '@/components/sis/ay-setup-wizard';
import {
  AySetupDataTable,
  type AyTableRow,
} from '@/components/sis/ay-setup-data-table';
import { YearSetupControlCenter } from '@/components/sis/year-setup/year-setup-control-center';
import { PageShell } from '@/components/ui/page-shell';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  checkAyEmpty,
  getCopyForwardPreview,
  listAcademicYears,
  listTermsByAy,
} from '@/lib/sis/ay-setup/queries';
import { getAyReadiness } from '@/lib/sis/readiness';
import { getSessionUser } from '@/lib/supabase/server';
import { resolveSelectedAyCode } from '@/lib/sis/year-setup';

export default async function AySetupPage({
  searchParams,
}: {
  searchParams: Promise<{ ay?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');

  const role = sessionUser.role;
  if (role !== 'school_admin' && role !== 'superadmin') {
    redirect('/sis');
  }

  const ays = await listAcademicYears();
  const termsByAy = await listTermsByAy();
  const activeAyCode = ays.find((a) => a.is_current)?.ay_code ?? null;

  // Preview for the "New AY" wizard. Uses a throwaway code so the query
  // just pulls the most-recent existing AY.
  const preview = await getCopyForwardPreview('__NEW__');

  // Pre-compute blockers for each AY (only matters when superadmin sees
  // the Delete button — cheap enough to always fetch for HFSE's handful
  // of AYs).
  const blockersByAy: Record<string, string[]> = {};
  if (role === 'superadmin') {
    await Promise.all(
      ays.map(async (ay) => {
        const res = await checkAyEmpty(ay.ay_code);
        blockersByAy[ay.ay_code] = res.blockers;
      })
    );
  }

  // Build enriched rows for the client DataTable.
  const tableRows: AyTableRow[] = ays.map((ay) => ({
    ...ay,
    termsData: termsByAy[ay.id] ?? [],
    blockers: blockersByAy[ay.ay_code] ?? [],
    activeAyCode,
    otherAys: ays
      .filter((o) => o.ay_code !== ay.ay_code)
      .map((o) => ({ ayCode: o.ay_code, label: o.label })),
    role,
  }));

  const sp = await searchParams;
  const selectedAyCode = resolveSelectedAyCode(ays, sp.ay);
  const selectedAy = ays.find((a) => a.ay_code === selectedAyCode) ?? null;
  const selectedTerms = selectedAy ? (termsByAy[selectedAy.id] ?? []) : [];
  const readiness = selectedAyCode
    ? await getAyReadiness(selectedAyCode)
    : null;
  const pickerAys = ays.map((a) => ({
    ayCode: a.ay_code,
    label: a.label,
    isCurrent: a.is_current,
  }));

  return (
    <PageShell>
      <Link
        href="/sis"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Dashboard
      </Link>

      <header className="mt-4 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            SIS Admin · Year Setup
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            Year setup.
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            See how ready an academic year is and configure it in one place —
            term dates, calendar, sections, grading sheets, and more.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <NewAyButton preview={preview} />
        </div>
      </header>

      <Tabs defaultValue="setup" className="mt-8">
        <TabsList>
          <TabsTrigger value="setup">Year Setup</TabsTrigger>
          <TabsTrigger value="manage">Manage years</TabsTrigger>
        </TabsList>

        <TabsContent value="setup" className="mt-6">
          <YearSetupControlCenter
            ays={pickerAys}
            selectedAy={selectedAy}
            selectedTerms={selectedTerms}
            readiness={readiness}
          />
        </TabsContent>

        <TabsContent value="manage" className="mt-6 space-y-8">
          <AySetupDataTable rows={tableRows} />

          <section className="rounded-xl border border-hairline bg-card p-4 text-xs leading-relaxed text-muted-foreground">
            <p className="mb-2 flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-indigo-deep">
              <CalendarRange className="size-3" /> Rollover checklist
            </p>
            <ol className="ml-4 list-decimal space-y-1">
              <li>
                <strong>Create the new AY</strong> here — sets up terms,
                sections, subjects, and admissions data all at once. The new AY
                shows up in the switcher right away across every page. (school
                admin + superadmin)
              </li>
              <li>
                <strong>Verify the parent-portal team</strong> is ready to write
                to the new admissions tables. The canonical DDL is frozen in{' '}
                <code className="rounded bg-muted px-1 py-0.5">
                  docs/context/10-parent-portal.md
                </code>
                .
              </li>
              <li>
                <strong>Switch active</strong> on the new AY when ready. (school
                admin + superadmin)
              </li>
              <li>
                <strong>Optional:</strong> delete a mis-created AY if it&apos;s
                still empty. (superadmin only)
              </li>
            </ol>
          </section>
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
