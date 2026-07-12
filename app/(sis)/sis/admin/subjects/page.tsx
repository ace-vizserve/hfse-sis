import { redirect } from 'next/navigation';
import { AlertTriangle, BookOpenCheck, ShieldAlert } from 'lucide-react';

import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { PageShell } from '@/components/ui/page-shell';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SisPageHeader } from '@/components/sis/sis-page-header';
import {
  listLevels,
  listSubjects,
  listSubjectConfigsForAy,
} from '@/lib/sis/subjects/queries';
import { computeSubjectConfigGaps } from '@/lib/sis/subject-config-gaps';
import { SubjectConfigMatrix } from '@/components/sis/subject-config-matrix';
import { SubjectAySwitcher } from '@/components/sis/subject-ay-switcher';

// Subject weights + max-slots matrix. school_admin + superadmin. Changing here
// affects every grading sheet for the (subject × level) inside the selected AY.
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

  const [subjects, levels, configs] = currentAy
    ? await Promise.all([
        listSubjects(),
        listLevels(),
        listSubjectConfigsForAy(currentAy.id),
      ])
    : [[], [], []];

  // Structure Defaults is the "what SHOULD be configured" reference — a
  // level missing one of its template subjects silently drops that subject
  // from grading-sheet creation AND the report card, with no error visible
  // anywhere. Compare against it here so the gap is visible where it's fixed.
  //
  // Full rows now (not just level/subject ids) so the inline "Structure
  // Defaults" tab (SubjectConfigMatrix) can render actual weight/slot
  // values, not just a presence gap. computeSubjectConfigGaps only reads
  // {level_id, subject_id} off each row, so the wider select is a strict
  // superset and leaves that presence-only check unaffected.
  const { data: templateConfigs } = currentAy
    ? await service
        .from('template_subject_configs')
        .select(
          'subject_id, level_id, ww_weight, pt_weight, qa_weight, ww_max_slots, pt_max_slots, qa_max'
        )
    : { data: [] };
  const subjectConfigGaps = currentAy
    ? computeSubjectConfigGaps(levels, subjects, templateConfigs ?? [], configs)
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
        description="WW / PT / QA weights and max slot counts per subject, level, and academic year."
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

      {currentAy && (
        <div className="flex items-start gap-4 rounded-xl border border-brand-indigo-soft/40 bg-accent p-5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-indigo text-white shadow-brand-tile">
            <ShieldAlert className="size-4" />
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
              for that subject and level in {currentAy.ay_code} — handle with
              care.
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
                  — add them below or they won&apos;t appear on the report card.
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
        <SubjectConfigMatrix
          subjects={subjects}
          levels={levels}
          configs={configs}
          templateConfigs={templateConfigs ?? []}
          ayCode={currentAy.ay_code}
        />
      )}
    </PageShell>
  );
}
