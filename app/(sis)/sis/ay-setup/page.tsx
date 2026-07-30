import { redirect } from 'next/navigation';
import { CalendarRange, CheckCircle2 } from 'lucide-react';

import { can } from '@/lib/auth/capabilities';
import { getCapabilitiesForRole } from '@/lib/auth/permission-map';
import { NewAyButton } from '@/components/sis/ay-setup-wizard';
import {
  AySetupDataTable,
  type AyTableRow,
} from '@/components/sis/ay-setup-data-table';
import { SisPageHeader } from '@/components/sis/sis-page-header';
import { YearSetupChecklist } from '@/components/sis/year-setup/year-setup-checklist';
import { Badge } from '@/components/ui/badge';
import { PageShell } from '@/components/ui/page-shell';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  checkAyEmpty,
  getAySetupPreview,
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
  // Gated on the capability rather than a role list, so a grant made in
  // /sis/admin/roles is enough to open this page — same shape as
  // /sis/admin/subjects. The capability alone is NOT sufficient: ROUTE_ACCESS
  // still has to admit the role, because the proxy runs first.
  if (!can(await getCapabilitiesForRole(role), 'academic_year.read')) {
    redirect('/');
  }

  const ays = await listAcademicYears();
  const termsByAy = await listTermsByAy();
  const activeAyCode = ays.find((a) => a.is_current)?.ay_code ?? null;

  // Preview for the "New AY" wizard. Uses a throwaway code so the query
  // just pulls the most-recent existing AY.
  const preview = await getAySetupPreview('__NEW__');

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
      <SisPageHeader
        group="This year"
        title="Year setup."
        description="See how ready an academic year is and configure it in one place — term dates, calendar, sections, grading sheets, and more."
        chips={
          selectedAy && (
            <>
              <Badge
                variant="outline"
                className="h-7 border-border bg-card px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
              >
                {selectedAy.ay_code}
              </Badge>
              {readiness && (
                <Badge
                  variant="outline"
                  className={
                    readiness.complete === readiness.total
                      ? 'h-7 gap-1 border-brand-mint bg-brand-mint/30 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink'
                      : 'h-7 border-border bg-card px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground'
                  }
                >
                  {readiness.complete === readiness.total && (
                    <CheckCircle2 className="size-3" />
                  )}
                  {readiness.complete}/{readiness.total} ready
                </Badge>
              )}
            </>
          )
        }
        actions={<NewAyButton preview={preview} variant="outline" />}
      />

      <Tabs defaultValue="setup" className="mt-8">
        <TabsList>
          <TabsTrigger value="setup">Year Setup</TabsTrigger>
          <TabsTrigger value="manage">Manage years</TabsTrigger>
        </TabsList>

        <TabsContent value="setup" className="mt-6">
          <YearSetupChecklist
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
              <CalendarRange className="size-3" /> Starting a new academic year
            </p>
            <ul className="ml-4 list-disc space-y-1">
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
              <li>
                <strong>Get it ready:</strong> work through the Year Setup tab
                for the new year — term dates, calendar, classes, grading
                sheets, and the rest.
              </li>
            </ul>
          </section>
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
