import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
  AlertTriangle,
  BookOpenCheck,
  ChevronDown,
  PlusCircle,
} from 'lucide-react';

import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { PageShell } from '@/components/ui/page-shell';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SisPageHeader } from '@/components/sis/sis-page-header';
import { getLevelRows, getOfferedLevelIds } from '@/lib/sis/levels';
import {
  listSubjects,
  listSubjectConfigsForAy,
  listSubjectLevelOfferings,
  listSubjectReportMap,
  listCatalogForLevelType,
  listSectionsWithSubjectsForLevelType,
} from '@/lib/sis/subjects/queries';
import {
  listTemplateSubjectConfigs,
  listTemplateSubjectLevelOfferings,
} from '@/lib/sis/template/queries';
import { computeSubjectConfigGaps } from '@/lib/sis/subject-config-gaps';
import { SubjectAySwitcher } from '@/components/sis/subject-ay-switcher';
import { SubjectCatalogCard } from '@/components/sis/subject-catalog-card';
import { SectionAssignCard } from '@/components/sis/section-assign-card';
import { SubjectTrackViewToggle } from '@/components/sis/subject-track-view-toggle';
import { AdvancedSubjectViewSheet } from '@/components/sis/advanced-subject-view-sheet';

// "Unified Subject Setup page" plan, Task 1 (docs:
// C:\Users\Ace\.claude\plans\my-bad-its-not-graceful-creek.md). Redesigns
// this page IN PLACE (same URL — existing deep-links, e.g. the AY
// Readiness checklist's "Subjects" step, keep working): a persistent
// header (AY chip + Level toggle + Secondary-only Track view-filter)
// above two real steps — ① Subjects (catalog + tune, Task 2) and
// ② Assign to sections (per-section checklist, Task 3) — with the
// pre-existing drag-and-drop level tree + monitoring table demoted to a
// second "Advanced" tab, unchanged.
//
// school_admin + superadmin only. Changing weights (still done from the
// Advanced tab today; Step ① takes over that job in Task 2) affects every
// grading sheet for that subject inside the selected AY.

type LevelType = 'primary' | 'secondary';

const LEVEL_TYPE_LABEL: Record<LevelType, string> = {
  primary: 'Primary',
  secondary: 'Secondary',
};

function resolveLevelType(raw: string | undefined): LevelType {
  return raw === 'secondary' ? 'secondary' : 'primary';
}

export default async function SubjectConfigPage({
  searchParams,
}: {
  searchParams: Promise<{ ay?: string; level?: string }>;
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
  const levelType = resolveLevelType(sp.level);
  const levelLabel = LEVEL_TYPE_LABEL[levelType];

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
    catalogForLevel,
    sectionsForLevel,
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
        listCatalogForLevelType(service, currentAy.id, levelType),
        listSectionsWithSubjectsForLevelType(service, currentAy.id, levelType),
      ])
    : [[], [], [], [], [], new Set<string>(), [], [], [], []];

  // Advanced tab (SubjectLevelTree) + the gap banner both scope to levels
  // genuinely OFFERED this AY (core + any volatile level with an
  // ay_level_offerings row) — a level with no offering row this year has
  // no operational meaning here (nothing to attach subjects to), so
  // excluding it also keeps the gap banner from flagging every template
  // subject as "missing" at a level nobody's running classes at this
  // year. Unchanged from before this task — the Advanced tab is AY-wide,
  // not level-TYPE-scoped like the new Step ①/② cards above it.
  const levels = allLevels.filter((l) => l.isCore || offeredLevelIds.has(l.id));

  // Structure Defaults is the "what SHOULD be configured" reference — a
  // level missing one of its template subjects silently drops that
  // subject from grading-sheet creation AND the report card, with no
  // error visible anywhere. Compare against it here so the gap is visible
  // where it's fixed.
  const subjectConfigGaps = currentAy
    ? computeSubjectConfigGaps(
        levels.map((l) => ({ id: l.id, label: l.label })),
        subjects,
        templateOfferings,
        offerings
      )
    : [];

  const needsAttentionCount = catalogForLevel.filter(
    (c) => c.needsAttention
  ).length;
  // When most/all of the catalog needs attention, that's "this year hasn't
  // been set up yet" (fix: Apply template, once, from Structure Defaults —
  // see the gap banner below), not a list of individual gaps worth
  // reviewing one at a time. Auto-expanding into a wall of amber rows in
  // that case doesn't help anyone; only open automatically when there's a
  // genuinely small, reviewable number of real exceptions.
  const catalogNeedsWholesaleSetup =
    catalogForLevel.length > 0 &&
    needsAttentionCount / catalogForLevel.length > 0.5;

  const ayOptions = ayList.map((a) => ({
    ayCode: a.ay_code,
    label: a.label,
    isCurrent: a.is_current,
  }));

  // Level toggle — a plain server-rendered Link pair styled as a segmented
  // Tabs control (same pattern as /sis/audit-log's Overview|Log toggle:
  // Tabs value={...} with TabsTrigger asChild wrapping a Link, no client
  // component, no onValueChange). Refresh-safe + shareable because it's a
  // real navigation, not client state — preserves ?ay= so switching level
  // never drops the current AY selection.
  function levelHref(target: LevelType): string {
    const params = new URLSearchParams();
    params.set('level', target);
    if (sp.ay) params.set('ay', sp.ay);
    return `/sis/admin/subjects?${params.toString()}`;
  }

  return (
    <PageShell>
      <SisPageHeader
        group="Subject Setup"
        title="Subject Setup."
        description={
          currentAy
            ? `${levelLabel}'s catalog and section assignments for ${currentAy.label}.`
            : `${levelLabel}'s catalog and section assignments.`
        }
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
              levelType={levelType}
            />
            <Tabs value={levelType}>
              <TabsList variant="segmented" aria-label="Level">
                <TabsTrigger value="primary" asChild>
                  <Link href={levelHref('primary')}>Primary</Link>
                </TabsTrigger>
                <TabsTrigger value="secondary" asChild>
                  <Link href={levelHref('secondary')}>Secondary</Link>
                </TabsTrigger>
              </TabsList>
            </Tabs>
            {levelType === 'secondary' && <SubjectTrackViewToggle />}
          </>
        }
      />

      {/* Purpose line — the single sentence answering "what is this page
          for," ahead of any control chrome. Weight-change caution folds in
          here as a plain clause instead of its own boxed banner (the
          warning matters, but it doesn't need to outweigh the page's own
          explanation of itself). */}
      {currentAy && (
        <p className="text-sm text-muted-foreground">
          The subject list for {levelLabel} in {currentAy.ay_code} — set it up
          below, then hand it to the sections that need it. Weight changes apply
          to every grading sheet already using that subject, so double-check
          before saving.
        </p>
      )}

      {subjectConfigGaps.length > 0 &&
        (() => {
          const totalMissing = subjectConfigGaps.reduce(
            (n, g) => n + g.missingSubjectCodes.length,
            0
          );
          // A handful of named gaps is worth reading; a wall of nearly
          // every subject at every level isn't a checklist anymore, it's a
          // sign the AY hasn't been attached to Structure Defaults at all
          // — say that plainly instead of listing dozens of codes nobody
          // can actually scan.
          const wholesale = totalMissing > 20;
          const MAX_CODES_PER_LEVEL = 6;
          const MAX_LEVELS_SHOWN = 5;
          const shownGaps = subjectConfigGaps.slice(0, MAX_LEVELS_SHOWN);
          const hiddenLevelCount = subjectConfigGaps.length - shownGaps.length;

          return (
            <div className="flex items-start gap-4 rounded-xl border border-brand-amber/30 bg-brand-amber-light p-5">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-amber text-ink shadow-brand-tile-amber">
                <AlertTriangle className="size-4" />
              </div>
              <div className="flex-1 space-y-2">
                <p className="font-serif text-base font-semibold text-foreground">
                  {wholesale
                    ? `${currentAy.ay_code} hasn't been set up yet`
                    : `${totalMissing} subject${totalMissing === 1 ? '' : 's'} missing from Structure Defaults`}
                </p>
                {wholesale ? (
                  <p className="text-sm text-muted-foreground">
                    This is a one-time step, not {totalMissing} separate ones —
                    go to{' '}
                    <Link
                      href="/sis/admin/template"
                      className="font-medium text-foreground underline underline-offset-2"
                    >
                      Structure Defaults
                    </Link>{' '}
                    and click <strong>Apply template</strong> to bring every
                    subject&apos;s weights in at once, then come back here to
                    attach them to sections.
                  </p>
                ) : (
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {shownGaps.map((g) => {
                      const shown = g.missingSubjectCodes.slice(
                        0,
                        MAX_CODES_PER_LEVEL
                      );
                      const hiddenCount =
                        g.missingSubjectCodes.length - shown.length;
                      return (
                        <li key={g.levelId}>
                          <span className="font-medium text-foreground">
                            {g.levelLabel}:
                          </span>{' '}
                          {shown.join(', ')}
                          {hiddenCount > 0 && ` +${hiddenCount} more`}
                        </li>
                      );
                    })}
                    {hiddenLevelCount > 0 && (
                      <li>+{hiddenLevelCount} more levels</li>
                    )}
                  </ul>
                )}
                {!wholesale && (
                  <p className="text-sm text-muted-foreground">
                    Attach them below or they won&apos;t appear on the report
                    card.
                  </p>
                )}
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
        <div className="space-y-5">
          {/* Catalog is secondary now — the core action is attaching
              subjects to sections below. Collapsed by default so it
              doesn't compete with that; auto-opens when there's a small,
              genuinely reviewable number of real exceptions, but NOT when
              the whole level needs setup (that's the gap banner's job, via
              Apply template — expanding a wall of amber rows here doesn't
              help that case). */}
          <Collapsible
            defaultOpen={needsAttentionCount > 0 && !catalogNeedsWholesaleSetup}
          >
            <Card className="gap-0 overflow-hidden py-0">
              <CollapsibleTrigger className="group flex w-full items-center gap-3 px-5 py-4 text-left">
                <div className="min-w-0 flex-1 leading-tight">
                  <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Subject catalog
                  </p>
                  <p className="truncate font-serif text-[15px] font-semibold text-foreground">
                    {catalogForLevel.length} subject
                    {catalogForLevel.length === 1 ? '' : 's'} for {levelLabel}
                    {needsAttentionCount > 0 &&
                      ` — ${needsAttentionCount} need${needsAttentionCount === 1 ? 's' : ''} attention`}
                  </p>
                </div>
                {needsAttentionCount > 0 && (
                  <Badge variant="warning" className="shrink-0 gap-1">
                    <AlertTriangle className="size-3" />
                    {needsAttentionCount}
                  </Badge>
                )}
                <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent className="border-t border-border">
                <SubjectCatalogCard
                  catalog={catalogForLevel}
                  levelLabel={levelLabel}
                  ayCode={currentAy.ay_code}
                  ayId={currentAy.id}
                  levelsOfType={levels
                    .filter((l) => l.levelType === levelType)
                    .map((l) => ({ id: l.id, code: l.code, label: l.label }))}
                  bare
                />
              </CollapsibleContent>
            </Card>
          </Collapsible>

          {sectionsForLevel.length === 0 ? (
            <Card className="items-center py-12 text-center">
              <CardContent className="flex flex-col items-center gap-3">
                <PlusCircle className="size-6 text-muted-foreground" />
                <div className="font-serif text-lg font-semibold text-foreground">
                  No {levelLabel} sections yet
                </div>
                <p className="max-w-sm text-sm text-muted-foreground">
                  Subjects can&apos;t be attached until a section exists to
                  attach them to.
                </p>
                <Button asChild size="sm" className="mt-1">
                  <Link href="/sis/sections">Create a section</Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <SectionAssignCard
              sections={sectionsForLevel}
              levelLabel={levelLabel}
            />
          )}

          <AdvancedSubjectViewSheet
            subjects={subjects}
            levels={levels}
            configs={configs}
            offerings={offerings}
            reportMap={reportMap}
            templateConfigs={templateConfigs}
            ayCode={currentAy.ay_code}
            ayId={currentAy.id}
          />
        </div>
      )}
    </PageShell>
  );
}
