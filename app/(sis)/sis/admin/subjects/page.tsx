import { AlertTriangle, BookOpenCheck } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { can } from '@/lib/auth/capabilities';
import { getCapabilitiesForRole } from '@/lib/auth/permission-map';
import { SisPageHeader } from '@/components/sis/sis-page-header';
import { SubjectAySwitcher } from '@/components/sis/subject-ay-switcher';
import { SubjectCatalogCard } from '@/components/sis/subject-catalog-card';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getLevelRows } from '@/lib/sis/levels';
import { findEmptyLevels } from '@/lib/sis/subject-config-gaps';
import {
  listCatalogForLevelType,
  listSectionsForLevelType,
  listSubjectLevelOfferings,
} from '@/lib/sis/subjects/queries';
import { getSheetImpactByConfig } from '@/lib/sis/subjects/sheet-impact';
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
  // Gated on the capability rather than a role list, so granting a role
  // subjects.read in /sis/admin/roles is enough to open this page. Note the
  // capability alone is NOT sufficient on its own: ROUTE_ACCESS still has to
  // admit the role to this prefix, because the proxy runs before this file does.
  if (!can(await getCapabilitiesForRole(sessionUser.role), 'subjects.read')) {
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

  // Both level types' sections, not just the currently-viewed catalog's —
  // the Attach-to-section modal picks its own level internally (level
  // first, then that level's sections), independent of which catalog tab
  // is active on the page.
  const allSections = [...primarySections, ...secondarySections];

  // How many open grading sheets a subject-settings save would reach. One
  // config covers the whole subject for the year, so that is every unlocked
  // sheet across every section and level — the edit form now says so rather
  // than leaving an admin to guess (see lib/sis/subjects/sheet-impact.ts).
  const sheetImpactByConfigId = currentAy
    ? Object.fromEntries(await getSheetImpactByConfig(service, currentAy.id))
    : {};

  // Every level is core and always relevant (migration 086 removed the
  // volatile-level / per-AY-offering concept, KD #153) — the gap banner
  // scopes to the full catalog, no offered-filtering needed.
  const levels = allLevels;

  // A level with literally no subjects attached silently drops out of
  // grading-sheet creation AND the report card, with no error visible
  // anywhere. Flag it here so the gap is visible where it's fixed.
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
          sheetImpactByConfigId={sheetImpactByConfigId}
          ayCode={currentAy.ay_code}
          ayId={currentAy.id}
          sections={allSections}
          defaultSectionLevelType={levelType}
        />
      )}
    </PageShell>
  );
}
