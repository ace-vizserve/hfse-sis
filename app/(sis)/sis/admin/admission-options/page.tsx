import { ListChecks } from 'lucide-react';

import { AySwitcher } from '@/components/admissions/ay-switcher';
import { AddAdmissionOptionButton } from '@/components/sis/admission-option-sheet';
import { AdmissionOptionsMatrix } from '@/components/sis/admission-options-matrix';
import { CopyAdmissionOptionsButton } from '@/components/sis/copy-admission-options-button';
import { SisEmptyState } from '@/components/sis/empty-state';
import { SisPageHeader } from '@/components/sis/sis-page-header';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { getCurrentAcademicYear, listAyCodes } from '@/lib/academic-year';
import {
  ayRelation,
  groupOptionsForAdmin,
  nameReachByLabel,
  type AyRelation,
} from '@/lib/admissions/options';
import { loadAdmissionOptionsUncached } from '@/lib/admissions/options-loader';
import { requirePageRoles } from '@/lib/auth/require-page-roles';
import { ENROLMENT_PLACEMENT_WRITERS } from '@/lib/auth/student-record';
import { getLevelRows } from '@/lib/sis/levels';
import { createServiceClient } from '@/lib/supabase/service';

// /sis/admin/admission-options — what parents can pick on the enrolment forms
// for one academic year (migration 174): level name, class type, session.
// Admissions closes a session here when it fills, and the portal stops
// offering it without a deploy (GET /api/parent/v2/admission-options).
//
// Modelled on /sis/admin/discount-codes: per-AY, owned by admissions, config
// in SIS Admin with a cross-link from the Admissions sidebar. Same role set as
// the write routes — ENROLMENT_PLACEMENT_WRITERS — and as its ROUTE_ACCESS row.
//
// Reads UNCACHED on purpose. A switch shows the server's state and only moves
// once the awaited refresh re-reads it; a cached read would hand back the row
// the write just changed. The endpoint parents hit is the cached one.

// The year badge: an upcoming year is the one taking applications, so it must
// not read as history (09a §9.3 — mint for current, accent for informational).
const YEAR_BADGE: Record<AyRelation, { label: string; className: string }> = {
  current: {
    label: 'Current',
    className: 'border-brand-mint bg-brand-mint/30 text-ink',
  },
  upcoming: {
    label: 'Upcoming',
    className: 'border-brand-indigo-soft bg-accent text-brand-indigo-deep',
  },
  past: {
    label: 'Past',
    className: 'border-border bg-card text-muted-foreground',
  },
};

export default async function AdmissionOptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ ay?: string }>;
}) {
  await requirePageRoles([...ENROLMENT_PLACEMENT_WRITERS]);

  const service = createServiceClient();
  const [currentAy, ayCodes, { ay: ayParam }] = await Promise.all([
    getCurrentAcademicYear(service),
    listAyCodes(service),
    searchParams,
  ]);
  if (!currentAy) {
    return (
      <PageShell>
        <div className="text-sm text-destructive">
          No current academic year configured.
        </div>
      </PageShell>
    );
  }

  const selectedAy =
    ayParam && ayCodes.includes(ayParam) ? ayParam : currentAy.ay_code;
  const relation = ayRelation(selectedAy, currentAy.ay_code);

  // `everyYear` is a thin read of every year's rows (a few hundred at most):
  // it tells the drawer how far a level name reaches when its "Counts as"
  // changes — that change moves the name in every year — and finds the year
  // an empty one can be copied from.
  const [rows, levelRows, everyYear] = await Promise.all([
    loadAdmissionOptionsUncached(service, selectedAy),
    getLevelRows(service),
    service
      .from('admission_options')
      .select('level_label, class_type_label, academic_years!inner(ay_code)'),
  ]);
  const allYearRows = (
    (everyYear.data ?? []) as unknown as Array<{
      level_label: string;
      class_type_label: string;
      academic_years: { ay_code: string } | { ay_code: string }[] | null;
    }>
  ).flatMap((r) => {
    const ay = Array.isArray(r.academic_years)
      ? r.academic_years[0]
      : r.academic_years;
    return ay
      ? [
          {
            ayCode: ay.ay_code,
            levelLabel: r.level_label,
            classTypeLabel: r.class_type_label,
          },
        ]
      : [];
  });
  const nameReach = nameReachByLabel(allYearRows);

  const groups = groupOptionsForAdmin(rows, levelRows);
  const levels = levelRows.map((l) => ({
    id: l.id,
    code: l.code,
    label: l.label,
  }));

  // An empty year offers a copy of the newest other year that has options.
  const withRows = new Set(allYearRows.map((r) => r.ayCode));
  const copySource =
    rows.length === 0
      ? (ayCodes.find(
          (c) => c !== selectedAy && !/^AY9/i.test(c) && withRows.has(c)
        ) ?? null)
      : null;

  return (
    <PageShell>
      <SisPageHeader
        group="This year"
        title="Enrolment form options."
        description="What parents can choose on the enrolment forms. Switch a session off when it's full — the forms stop offering it within a few minutes."
        actions={
          rows.length > 0 ? (
            <AddAdmissionOptionButton ayCode={selectedAy} levels={levels} />
          ) : undefined
        }
        chips={
          <div className="flex flex-col items-start gap-2 md:items-end">
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className="h-7 border-border bg-card px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
              >
                {selectedAy}
              </Badge>
              <Badge
                variant="outline"
                className={`h-7 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] ${YEAR_BADGE[relation].className}`}
              >
                {YEAR_BADGE[relation].label}
              </Badge>
            </div>
            <AySwitcher current={selectedAy} options={ayCodes} />
          </div>
        }
      />

      {rows.length === 0 ? (
        <Card className="py-0">
          <SisEmptyState
            className="border-0"
            icon={ListChecks}
            title={`No options for ${selectedAy} yet`}
            body={
              copySource
                ? `Copy ${copySource}'s options to start — every level name, class type and session comes across, open or closed as it is there. You can change any of it afterwards.`
                : 'Add the first level and class type parents can pick for this year.'
            }
            cta={
              <div className="flex flex-wrap items-center justify-center gap-2">
                {copySource && (
                  <CopyAdmissionOptionsButton
                    fromAy={copySource}
                    toAy={selectedAy}
                  />
                )}
                <AddAdmissionOptionButton
                  ayCode={selectedAy}
                  levels={levels}
                  variant={copySource ? 'outline' : 'default'}
                />
              </div>
            }
          />
        </Card>
      ) : (
        <AdmissionOptionsMatrix
          groups={groups}
          ayCode={selectedAy}
          levels={levels}
          nameReach={nameReach}
        />
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <ListChecks className="size-3" strokeWidth={2.25} />
        <span>{selectedAy}</span>
        <span className="text-border">·</span>
        <span>{rows.length.toLocaleString('en-SG')} sessions</span>
        <span className="text-border">·</span>
        <span>Every change is on the Admissions audit log</span>
      </div>
    </PageShell>
  );
}
