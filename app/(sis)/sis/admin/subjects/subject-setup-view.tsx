import { AlertTriangle, BookOpenCheck } from 'lucide-react';

import { PageTabNav } from '@/components/sis/page-tab-nav';
import { SisPageHeader } from '@/components/sis/sis-page-header';
import { SubjectAySwitcher } from '@/components/sis/subject-ay-switcher';
import { SubjectCatalogCard } from '@/components/sis/subject-catalog-card';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { getLevelRows } from '@/lib/sis/levels';
import { findEmptyLevels } from '@/lib/sis/subject-config-gaps';
import {
  listCatalogForLevelType,
  listSectionsForLevelType,
  listSubjectLevelOfferings,
} from '@/lib/sis/subjects/queries';
import { getSheetImpactByConfig } from '@/lib/sis/subjects/sheet-impact';
import { createServiceClient } from '@/lib/supabase/service';

export type LevelType = 'primary' | 'secondary';

const LEVEL_TYPE_LABEL: Record<LevelType, string> = {
  primary: 'Primary',
  secondary: 'Secondary',
};

// Subject Setup — one screen, fully manual. Rebuilt after a live review of the
// prior "catalog + tune + per-section checklist" design rejected it as
// overengineered: too much chrome for what is a simple job. A persistent header
// (AY chip + Level switcher) above ONE card: the subject catalog table. Check
// subjects, click Attach to section, pick section(s) in a confirm modal — that
// is the whole flow. Attaching is fully manual; there is no track/bundle
// auto-suggestion anywhere on this page.
//
// Shared by both level routes rather than split into a layout: the header
// description, the purpose line and the gap banner all depend on which level is
// being viewed, and a Next layout never sees the route's own params.
//
// Changing weights (via the catalog table's "Set weights") affects every
// grading sheet for that subject inside the selected AY.
export async function SubjectSetupView({
  levelType,
  ay,
}: {
  levelType: LevelType;
  ay: string | undefined;
}) {
  const service = createServiceClient();
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
    (ay ? ayList.find((a) => a.ay_code === ay) : undefined) ??
    ayList.find((a) => a.is_current) ??
    ayList[0] ??
    null;

  const [
    allLevels,
    offerings,
    catalogForLevel,
    primarySections,
    secondarySections,
  ] = currentAy
    ? await Promise.all([
        getLevelRows(service),
        listSubjectLevelOfferings(currentAy.id),
        listCatalogForLevelType(service, currentAy.id, levelType),
        listSectionsForLevelType(service, currentAy.id, 'primary'),
        listSectionsForLevelType(service, currentAy.id, 'secondary'),
      ])
    : [[], [], [], [], []];

  // Both level types' sections, not just the currently-viewed catalog's — the
  // Attach-to-section modal picks its own level internally, independent of
  // which catalog is on screen.
  const allSections = [...primarySections, ...secondarySections];

  // How many open grading sheets a subject-settings save would reach. One
  // config covers the whole subject for the year, so that is every unlocked
  // sheet across every section and level.
  const sheetImpactByConfigId = currentAy
    ? Object.fromEntries(await getSheetImpactByConfig(service, currentAy.id))
    : {};

  // Every level is core and always relevant (migration 086 removed the
  // volatile-level / per-AY-offering concept, KD #153).
  const levels = allLevels;

  // A level with no subjects attached silently drops out of grading-sheet
  // creation AND the report card, with no error visible anywhere. Flag it here,
  // where it is fixed.
  const subjectConfigGaps = currentAy
    ? findEmptyLevels(
        levels.map((l) => ({ id: l.id, label: l.label })),
        offerings
      )
    : [];

  const ayOptions = ayList.map((a) => ({
    ayCode: a.ay_code,
    label: a.label,
    isCurrent: a.is_current,
  }));

  // Level switch preserves the chosen AY, so changing level never silently
  // drops you back to the current year.
  const ayQuery = ay ? `?ay=${encodeURIComponent(ay)}` : '';

  return (
    <>
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

      {/* Purpose line — the single sentence answering "what is this page for",
          ahead of any control chrome. The weight-change caution folds in as a
          plain clause rather than its own boxed banner: it matters, but it does
          not need to outweigh the page's own explanation of itself. */}
      {currentAy && (
        <p className="text-sm text-muted-foreground">
          Every subject offered at {levelLabel} in {currentAy.ay_code}. Check
          the ones you want, then attach them to a section. Weight changes apply
          to every grading sheet already using that subject, so double-check
          before saving.
        </p>
      )}

      {subjectConfigGaps.length > 0 && (
        <div className="flex items-start gap-4 rounded-xl border border-brand-amber/30 bg-brand-amber-light p-5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-amber text-ink shadow-brand-tile-amber">
            <AlertTriangle className="size-4" />
          </div>
          <div className="flex-1 space-y-2">
            <p className="font-serif text-base font-semibold text-foreground">
              {subjectConfigGaps.length === 1
                ? '1 level with no subjects configured'
                : `${subjectConfigGaps.length} levels with no subjects configured`}
            </p>
            <p className="text-sm text-muted-foreground">
              {subjectConfigGaps.map((g) => g.levelLabel).join(', ')} — nothing
              will appear on the report card for{' '}
              {subjectConfigGaps.length === 1 ? 'it' : 'them'} until you check a
              subject in the catalog below and attach it to a section.
            </p>
          </div>
        </div>
      )}

      <PageTabNav
        tabs={[
          { href: `/sis/admin/subjects${ayQuery}`, label: 'Primary' },
          {
            href: `/sis/admin/subjects/secondary${ayQuery}`,
            label: 'Secondary',
          },
        ]}
      />

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
          sheetImpactByConfigId={sheetImpactByConfigId}
          ayCode={currentAy.ay_code}
          ayId={currentAy.id}
          sections={allSections}
          defaultSectionLevelType={levelType}
        />
      )}
    </>
  );
}
