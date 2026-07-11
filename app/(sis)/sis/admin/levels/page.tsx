import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, Layers } from 'lucide-react';

import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import {
  getCurrentAcademicYear,
  getUpcomingAcademicYear,
} from '@/lib/academic-year';
import { PageShell } from '@/components/ui/page-shell';
import { Card, CardContent } from '@/components/ui/card';
import { SisPageHeader } from '@/components/sis/sis-page-header';
import { getLevelRows, getOfferedLevelIds } from '@/lib/sis/levels';
import {
  computeLevelDemand,
  type LevelDemandRow,
} from '@/lib/sis/level-demand';
import { fetchAllPages } from '@/lib/supabase/paginate';
import { LevelsManagerClient } from '@/components/sis/levels-manager-client';

// Grade Levels admin — Levels & Grade Progression, Phase 3 (migration 078).
// school_admin/superadmin manage the level catalog (core P1-S4 are
// permanent; volatile levels like YS tiers or CS1/CS2 can be offered or
// shelved per AY) + the `next_level_id` progression pointer, which only
// SUGGESTS what a returning student applies for next (Records/Admissions
// stay the source of truth for actually moving anyone).
export default async function GradeLevelsPage({
  searchParams,
}: {
  searchParams: Promise<{ ay?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (
    sessionUser.role !== 'superadmin' &&
    sessionUser.role !== 'school_admin'
  ) {
    redirect('/sis');
  }

  const sp = await searchParams;
  const service = createServiceClient();

  // Academic-year options + current selection — same idiom as
  // /sis/admin/subjects: a plain ?ay= query string keeps the page a server
  // component while still letting the registrar pick which AY's offerings
  // the volatile-level Switches read/write.
  const { data: ays } = await service
    .from('academic_years')
    .select('id, ay_code, label, is_current')
    .order('ay_code', { ascending: false });
  type AyRow = {
    id: string;
    ay_code: string;
    label: string;
    is_current: boolean;
  };
  const ayList = (ays ?? []) as AyRow[];
  const currentAy: AyRow | null =
    (sp.ay ? ayList.find((a) => a.ay_code === sp.ay) : undefined) ??
    ayList.find((a) => a.is_current) ??
    ayList[0] ??
    null;

  const ayOptions = ayList.map((a) => ({
    ayCode: a.ay_code,
    label: a.label,
    isCurrent: a.is_current,
  }));

  const levels = await getLevelRows(service);

  let offeredLevelIds: string[] = [];
  let demandRows: LevelDemandRow[] = [];
  let acceptingAyCode: string | null = null;

  if (currentAy) {
    const offeredSet = await getOfferedLevelIds(service, currentAy.id);
    offeredLevelIds = Array.from(offeredSet);

    // Demand is scoped to the AY prospective/returning applicants are
    // actually applying into: the upcoming early-bird AY if one is open
    // (KD #118), else the operationally current AY. These two AY calls use
    // a cookie-scoped server client (per their own module doc), so they run
    // here in the RSC body rather than inside any unstable_cache.
    const upcoming = await getUpcomingAcademicYear();
    const acceptingAy = upcoming ?? (await getCurrentAcademicYear());

    if (acceptingAy) {
      acceptingAyCode = acceptingAy.ay_code;
      const acceptingOfferedSet =
        acceptingAy.id === currentAy.id
          ? offeredSet
          : await getOfferedLevelIds(service, acceptingAy.id);

      const admissions = createAdmissionsClient();
      const prefix = `ay${acceptingAy.ay_code.replace(/^AY/i, '').toLowerCase()}`;
      type AppLevelRow = { levelApplied: string | null };
      // Cast required: Supabase can't infer row shapes for dynamic table
      // names (same pattern as lib/sis/cohorts.ts).
      type PageResult<T> = PromiseLike<{
        data: T[] | null;
        error: { message: string } | null;
      }>;
      try {
        const apps = await fetchAllPages<AppLevelRow>(
          (from, to) =>
            admissions
              .from(`${prefix}_enrolment_applications`)
              .select('levelApplied')
              .range(from, to) as unknown as PageResult<AppLevelRow>
        );
        demandRows = computeLevelDemand(apps, levels, acceptingOfferedSet);
      } catch (err) {
        console.warn(
          '[sis/admin/levels] demand fetch failed:',
          err instanceof Error ? err.message : err
        );
      }
    }
  }

  return (
    <PageShell>
      <Link
        href="/sis"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        SIS Admin
      </Link>

      <SisPageHeader
        group="Structure"
        title="Grade levels."
        description="Primary 1 to Secondary 4 are permanent. Other levels can be offered or shelved per school year. “Next level” only suggests what a returning student applies for — it never moves anyone."
      />

      {!currentAy ? (
        <Card className="items-center py-12 text-center">
          <CardContent className="flex flex-col items-center gap-3">
            <Layers className="size-6 text-muted-foreground" />
            <div className="font-serif text-lg font-semibold text-foreground">
              No academic years
            </div>
            <p className="text-sm text-muted-foreground">
              Create an AY first via AY Setup.
            </p>
          </CardContent>
        </Card>
      ) : (
        <LevelsManagerClient
          levels={levels}
          offeredLevelIds={offeredLevelIds}
          demandRows={demandRows}
          ayOptions={ayOptions}
          currentAyCode={currentAy.ay_code}
          currentAyId={currentAy.id}
          acceptingAyCode={acceptingAyCode}
        />
      )}
    </PageShell>
  );
}
