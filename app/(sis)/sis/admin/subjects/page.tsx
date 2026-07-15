import { redirect } from 'next/navigation';
import { AlertTriangle, BookOpenCheck, Info } from 'lucide-react';

import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { PageShell } from '@/components/ui/page-shell';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SisPageHeader } from '@/components/sis/sis-page-header';
import { getLevelRows, getOfferedLevelIds } from '@/lib/sis/levels';
import {
  listSubjects,
  listSubjectConfigsForAy,
  listSubjectLevelOfferings,
  listSubjectReportMap,
} from '@/lib/sis/subjects/queries';
import {
  listTemplateSubjectConfigs,
  listTemplateSubjectLevelOfferings,
} from '@/lib/sis/template/queries';
import { computeSubjectConfigGaps } from '@/lib/sis/subject-config-gaps';
import { SubjectLevelTree } from '@/components/sis/subject-level-tree';
import { SubjectAySwitcher } from '@/components/sis/subject-ay-switcher';

// Subject weights + slots + level attachment tree. school_admin + superadmin.
// Changing weights here affects every grading sheet for that subject inside
// the selected AY, at every level it's attached to.
export default async function SubjectConfigPage({
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

  // Academic-year options + current selection.
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

  const [
    subjects,
    allLevels,
    configs,
    offerings,
    reportMap,
    offeredLevelIds,
    templateOfferings,
    templateConfigs,
  ] = currentAy
    ? await Promise.all([
        listSubjects(),
        getLevelRows(service),
        listSubjectConfigsForAy(currentAy.id),
        listSubjectLevelOfferings(currentAy.id),
        listSubjectReportMap(),
        getOfferedLevelIds(service, currentAy.id),
        listTemplateSubjectLevelOfferings(),
        listTemplateSubjectConfigs(),
      ])
    : [[], [], [], [], [], new Set<string>(), [], []];

  // Tree + gap banner both scope to levels genuinely OFFERED this AY (core
  // + any volatile level with an ay_level_offerings row) — a level with no
  // offering row this year has no operational meaning here (nothing to
  // attach subjects to), so excluding it also keeps the gap banner from
  // flagging every template subject as "missing" at a level nobody's
  // running classes at this year.
  const levels = allLevels.filter((l) => l.isCore || offeredLevelIds.has(l.id));

  // Structure Defaults is the "what SHOULD be configured" reference — a
  // level missing one of its template subjects silently drops that subject
  // from grading-sheet creation AND the report card, with no error visible
  // anywhere. Compare against it here so the gap is visible where it's fixed.
  const subjectConfigGaps = currentAy
    ? computeSubjectConfigGaps(
        levels.map((l) => ({ id: l.id, label: l.label })),
        subjects,
        templateOfferings,
        offerings
      )
    : [];

  const ayOptions = ayList.map((a) => ({
    ayCode: a.ay_code,
    label: a.label,
    isCurrent: a.is_current,
  }));

  return (
    <PageShell>
      <SisPageHeader
        group="Structure"
        title="Subject weights & slots."
        description="WW / PT / QA weights and max slot counts per subject and academic year. Which levels a subject teaches at is managed here too — drag a subject onto a level to attach it."
        chips={
          <>
            {currentAy && (
              <Badge
                variant="outline"
                className="h-7 border-border bg-card px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
              >
                {currentAy.ay_code}
              </Badge>
            )}
            <SubjectAySwitcher
              current={currentAy?.ay_code ?? ''}
              options={ayOptions}
            />
          </>
        }
      />

      {/* Always-on boilerplate reminder — recolored indigo/informational
          (Phase-0.4 convention) so it doesn't dilute the actionable amber
          gap banner below when both render together. This one has no
          specific detected problem to act on; the gap banner does. */}
      {currentAy && (
        <div className="flex items-start gap-4 rounded-xl border border-brand-indigo/30 bg-brand-indigo/5 p-5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Info className="size-4" />
          </div>
          <div className="flex-1 space-y-1.5">
            <p className="font-serif text-base font-semibold text-foreground">
              Changes here reach every grading sheet
            </p>
            <p className="text-sm text-muted-foreground">
              Editing a subject&apos;s weights or slot count applies to{' '}
              <strong className="font-semibold text-foreground">
                every grading sheet
              </strong>{' '}
              for that subject in {currentAy.ay_code} — handle with care.
            </p>
          </div>
        </div>
      )}

      {subjectConfigGaps.length > 0 &&
        (() => {
          const totalMissing = subjectConfigGaps.reduce(
            (n, g) => n + g.missingSubjectCodes.length,
            0
          );
          return (
            <div className="flex items-start gap-4 rounded-xl border border-brand-amber/30 bg-brand-amber-light p-5">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-amber text-ink shadow-brand-tile-amber">
                <AlertTriangle className="size-4" />
              </div>
              <div className="flex-1 space-y-1.5">
                <p className="font-serif text-base font-semibold text-foreground">
                  {totalMissing} subject{totalMissing === 1 ? '' : 's'} missing
                  from Structure Defaults
                </p>
                <p className="text-sm text-muted-foreground">
                  {subjectConfigGaps
                    .map(
                      (g) =>
                        `${g.levelLabel}: ${g.missingSubjectCodes.join(', ')}`
                    )
                    .join(' · ')}{' '}
                  — attach them below or they won&apos;t appear on the report
                  card.
                </p>
              </div>
            </div>
          );
        })()}

      {!currentAy ? (
        <Card className="items-center py-12 text-center">
          <CardContent className="flex flex-col items-center gap-3">
            <BookOpenCheck className="size-6 text-muted-foreground" />
            <div className="font-serif text-lg font-semibold text-foreground">
              No academic years
            </div>
            <p className="text-sm text-muted-foreground">
              Create an AY first via AY Setup.
            </p>
          </CardContent>
        </Card>
      ) : (
        <SubjectLevelTree
          subjects={subjects}
          levels={levels}
          configs={configs}
          offerings={offerings}
          reportMap={reportMap}
          templateConfigs={templateConfigs}
          ayCode={currentAy.ay_code}
          ayId={currentAy.id}
        />
      )}
    </PageShell>
  );
}
