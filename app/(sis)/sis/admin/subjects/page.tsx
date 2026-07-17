import { AlertTriangle, BookOpenCheck } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { SisPageHeader } from '@/components/sis/sis-page-header';
import { SubjectAySwitcher } from '@/components/sis/subject-ay-switcher';
import { SubjectCatalogCard } from '@/components/sis/subject-catalog-card';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getLevelRows } from '@/lib/sis/levels';
import { computeSubjectConfigGaps } from '@/lib/sis/subject-config-gaps';
import {
  listCatalogForLevelType,
  listSectionsForLevelType,
  listSubjectLevelOfferings,
  listSubjects,
} from '@/lib/sis/subjects/queries';
import { listTemplateSubjectLevelOfferings } from '@/lib/sis/template/queries';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// Subject Setup — one screen, fully manual. Rebuilt after a live review of
// the prior "catalog + tune + per-section checklist" design (the "Unified
// Subject Setup page" plan, docs:
// C:\Users\Ace\.claude\plans\my-bad-its-not-graceful-creek.md) was
// rejected as overengineered: too much chrome (a "Needs attention" badge
// system, a Global/Standard track-flagging step + "Unflagged" badge, an
// Advanced-view escape hatch) for what's actually a simple job. The
// header (AY chip + Level toggle) stays — a persistent header
// (AY chip + Level toggle) above ONE card: the subject catalog table.
// Check subjects, click Attach to section, pick section(s) in a confirm
// modal — that's the whole flow. Attaching is fully manual; there is no
// track/bundle auto-suggestion anywhere on this page.
//
// school_admin + superadmin only. Changing weights (via the catalog
// table's pencil/"Set weights") affects every grading sheet for that
// subject inside the selected AY.

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
    offerings,
    templateOfferings,
    catalogForLevel,
    primarySections,
    secondarySections,
  ] = currentAy
    ? await Promise.all([
        listSubjects(),
        getLevelRows(service),
        listSubjectLevelOfferings(currentAy.id),
        listTemplateSubjectLevelOfferings(),
        listCatalogForLevelType(service, currentAy.id, levelType),
        listSectionsForLevelType(service, currentAy.id, 'primary'),
        listSectionsForLevelType(service, currentAy.id, 'secondary'),
      ])
    : [[], [], [], [], [], [], []];

  // Both level types' sections, not just the currently-viewed catalog's —
  // the Attach-to-section modal picks its own level internally (level
  // first, then that level's sections), independent of which catalog tab
  // is active on the page.
  const allSections = [...primarySections, ...secondarySections];

  // Every level is core and always relevant (migration 086 removed the
  // volatile-level / per-AY-offering concept, KD #153) — the gap banner
  // scopes to the full catalog, no offered-filtering needed.
  const levels = allLevels;

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
            ? `${levelLabel}'s subject catalog for ${currentAy.label}.`
            : `${levelLabel}'s subject catalog.`
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
          Every subject offered at {levelLabel} in {currentAy.ay_code}. Check
          the ones you want, then attach them to a section. Weight changes apply
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

      <Tabs value={levelType}>
        <TabsList aria-label="Level">
          <TabsTrigger value="primary" asChild>
            <Link href={levelHref('primary')}>Primary</Link>
          </TabsTrigger>
          <TabsTrigger value="secondary" asChild>
            <Link href={levelHref('secondary')}>Secondary</Link>
          </TabsTrigger>
        </TabsList>
      </Tabs>

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
        <SubjectCatalogCard
          catalog={catalogForLevel}
          levelLabel={levelLabel}
          ayCode={currentAy.ay_code}
          ayId={currentAy.id}
          sections={allSections}
          defaultSectionLevelType={levelType}
        />
      )}
    </PageShell>
  );
}
