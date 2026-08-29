import { unstable_cache } from 'next/cache';

import {
  getCurrentAcademicYear,
  getUpcomingAcademicYear,
} from '@/lib/academic-year';
import { getLevelRows, resolveLevelIdFromCatalog } from '@/lib/sis/levels';
import type { LevelAliasRow, LevelRow } from '@/lib/sis/levels';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { createServiceClient } from '@/lib/supabase/service';

// ──────────────────────────────────────────────────────────────────────────
// Levels that have students waiting but no class section to put them in.
//
// This is the OTHER way a level blocks enrolment. `lib/sis/level-review.ts`
// catches the first: an admissions `levelApplied` string that resolves to no
// level at all. This module catches the second: the label resolves fine, the
// student is Enrolled, and there is still nowhere to seat them because the
// academic year has zero sections at that level. Both end the same way —
// `listAssignableSections` hands back an empty list and the registrar can't
// finish the assignment — but only the first had a queue.
//
// Deliberately NOT the AY-readiness 'sections' step (lib/sis/readiness.ts).
// That step asks "does every level in the catalog have a section," so an
// unused level (Secondary Four, with no students) permanently holds it below
// 100% and it can't name which level is actually hurting. This one is
// demand-driven: a level appears only when real students are stuck behind it,
// which makes an empty list genuinely mean "nothing to do."
//
// Structure mirrors `lib/sis/level-review.ts` (KD #46 dashboard-loader
// convention): a pure diff with zero DB access, an uncached loader that
// fetches, and a cached public entry point.
// ──────────────────────────────────────────────────────────────────────────

/** One Enrolled student with no section, already resolved onto a level. */
export type WaitingAtLevel = {
  ayCode: string;
  levelId: string;
  levelLabel: string;
  /** `levels.sort_order` — orders the output the way a registrar reads levels. */
  levelSortOrder: number;
  enroleeNumber: string | null;
};

export type LevelAwaitingSections = {
  ayCode: string;
  levelId: string;
  levelLabel: string;
  /** Enrolled students at this level, in this AY, with no section assigned. */
  waitingCount: number;
  /** Up to 5 enrolee numbers, for context copy. */
  sampleEnrolees: string[];
};

const CACHE_TTL_SECONDS = 60;
const MAX_SAMPLE_ENROLEES = 5;
const ENROLLED_STATUSES = ['Enrolled', 'Enrolled (Conditional)'] as const;

function prefixFor(ayCode: string): string {
  return `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
}

/**
 * Pure diff — given students waiting for a section (each already resolved
 * onto a level) and, per AY, the level ids that DO have at least one section,
 * returns one row per (AY, level) that has waiting students and no section.
 *
 * A level with no waiting students never appears, however empty it is. That
 * is the whole point: this list is about students who are stuck, not about
 * catalog completeness. No DB access — safe to unit test directly.
 */
export function diffLevelsAwaitingSections(
  waiting: WaitingAtLevel[],
  sectionLevelIdsByAy: Record<string, string[]>
): LevelAwaitingSections[] {
  const grouped = new Map<
    string,
    LevelAwaitingSections & { levelSortOrder: number }
  >();

  for (const row of waiting) {
    const key = `${row.ayCode}::${row.levelId}`;
    let entry = grouped.get(key);
    if (!entry) {
      entry = {
        ayCode: row.ayCode,
        levelId: row.levelId,
        levelLabel: row.levelLabel,
        levelSortOrder: row.levelSortOrder,
        waitingCount: 0,
        sampleEnrolees: [],
      };
      grouped.set(key, entry);
    }
    entry.waitingCount += 1;
    if (
      row.enroleeNumber &&
      entry.sampleEnrolees.length < MAX_SAMPLE_ENROLEES &&
      !entry.sampleEnrolees.includes(row.enroleeNumber)
    ) {
      entry.sampleEnrolees.push(row.enroleeNumber);
    }
  }

  const out = Array.from(grouped.values()).filter((entry) => {
    const withSections = sectionLevelIdsByAy[entry.ayCode] ?? [];
    return !withSections.includes(entry.levelId);
  });

  out.sort((a, b) => {
    const byAy = a.ayCode.localeCompare(b.ayCode);
    if (byAy !== 0) return byAy;
    const byOrder = a.levelSortOrder - b.levelSortOrder;
    if (byOrder !== 0) return byOrder;
    return a.levelLabel.localeCompare(b.levelLabel);
  });

  return out.map(({ levelSortOrder: _levelSortOrder, ...rest }) => rest);
}

async function loadLevelsAwaitingSectionsUncached(
  ayCodes: string[]
): Promise<LevelAwaitingSections[]> {
  const admissions = createAdmissionsClient();
  const service = createServiceClient();

  const [levels, aliasesRes] = await Promise.all([
    getLevelRows(service).catch((err: unknown) => {
      console.warn(
        '[sis/levels-awaiting-sections] levels fetch failed:',
        err instanceof Error ? err.message : String(err)
      );
      return null;
    }),
    service.from('level_aliases').select('raw_label, level_id'),
  ]);
  if (!levels) return [];
  if (aliasesRes.error) {
    console.warn(
      '[sis/levels-awaiting-sections] level_aliases fetch failed:',
      aliasesRes.error.message
    );
    return [];
  }
  const aliases = (aliasesRes.data ?? []) as LevelAliasRow[];
  const levelById = new Map<string, LevelRow>(levels.map((l) => [l.id, l]));

  const waiting: WaitingAtLevel[] = [];
  const sectionLevelIdsByAy: Record<string, string[]> = {};

  // ONE WAVE PER STEP, ACROSS EVERY YEAR IN SCOPE. Nothing one year reads is
  // produced by another, so the years go out together. The two steps WITHIN a
  // year stay serial and genuinely are: the sections read is scoped by the AY
  // id the first step resolves.
  //
  // ⚠ THE FETCH IS PARALLEL; THE FOLD BELOW IS STILL IN `ayCodes` ORDER,
  // because `waiting` is appended to and the caller renders it in that order.
  const perAy = await Promise.all(
    ayCodes.map(async (ayCode) => {
      const prefix = prefixFor(ayCode);

      const { data: ayRow, error: ayErr } = await service
        .from('academic_years')
        .select('id')
        .eq('ay_code', ayCode)
        .maybeSingle();
      // AY not provisioned in the operational schema yet.
      if (ayErr || !ayRow) return null;

      const ayId = (ayRow as { id: string }).id;

      const [appsRes, statusRes, sectionsRes] = await Promise.all([
        admissions
          .from(`${prefix}_enrolment_applications`)
          .select('enroleeNumber, levelApplied'),
        admissions
          .from(`${prefix}_enrolment_status`)
          .select('enroleeNumber, classSection, applicationStatus')
          .in('applicationStatus', [...ENROLLED_STATUSES]),
        service
          .from('sections')
          .select('level_id')
          .not('level_id', 'is', null)
          .eq('academic_year_id', ayId),
      ]);
      return { ayCode, appsRes, statusRes, sectionsRes };
    })
  );

  for (const entry of perAy) {
    if (!entry) continue;
    const { ayCode, appsRes, statusRes, sectionsRes } = entry;

    if (appsRes.error || statusRes.error || sectionsRes.error) {
      console.warn(
        `[sis/levels-awaiting-sections] fetch failed for ${ayCode}:`,
        appsRes.error?.message ??
          statusRes.error?.message ??
          sectionsRes.error?.message
      );
      return [];
    }

    sectionLevelIdsByAy[ayCode] = Array.from(
      new Set(
        (
          (sectionsRes.data ?? []) as Array<{ level_id: string | null }>
        ).flatMap((s) => (s.level_id ? [s.level_id] : []))
      )
    );

    const levelAppliedByEnrolee = new Map<string, string | null>();
    for (const row of (appsRes.data ?? []) as Array<{
      enroleeNumber: string | null;
      levelApplied: string | null;
    }>) {
      if (row.enroleeNumber) {
        levelAppliedByEnrolee.set(row.enroleeNumber, row.levelApplied);
      }
    }

    for (const row of (statusRes.data ?? []) as Array<{
      enroleeNumber: string | null;
      classSection: string | null;
    }>) {
      if (!row.enroleeNumber) continue;
      // Already seated — nothing is blocking this one.
      if (
        typeof row.classSection === 'string' &&
        row.classSection.trim().length > 0
      ) {
        continue;
      }

      const levelId = resolveLevelIdFromCatalog(
        levelAppliedByEnrolee.get(row.enroleeNumber) ?? null,
        levels,
        aliases
      );
      // Unresolvable label — that student's blocker is a NAME, and the level
      // naming queue already owns it. Counting them here too would report one
      // problem twice and send the registrar to the wrong fix.
      if (!levelId) continue;

      const level = levelById.get(levelId);
      if (!level) continue;

      waiting.push({
        ayCode,
        levelId,
        levelLabel: level.label,
        levelSortOrder: level.sortOrder,
        enroleeNumber: row.enroleeNumber,
      });
    }
  }

  return diffLevelsAwaitingSections(waiting, sectionLevelIdsByAy);
}

/**
 * Resolves the in-scope AY set as `{ current AY } ∪ { upcoming accepting AY,
 * if any }` — the same window `lib/sis/level-review.ts` uses, since these are
 * two halves of the same "what is blocking enrolment right now" question.
 *
 * The AY lookups use a cookie-scoped server client, so they must resolve
 * BEFORE entering `unstable_cache` (KD #54's gotcha). Cached per AY-code-set,
 * tagged `sis:${ayCode}` for every in-scope AY code (60s TTL) — already
 * invalidated by every admissions mutation and by section creation. Fails
 * soft to `[]` on any query error.
 */
export async function loadLevelsAwaitingSections(): Promise<
  LevelAwaitingSections[]
> {
  const [current, upcoming] = await Promise.all([
    getCurrentAcademicYear(),
    getUpcomingAcademicYear(),
  ]);

  const ayCodes = Array.from(
    new Set(
      [current?.ay_code, upcoming?.ay_code].filter((c): c is string => !!c)
    )
  );

  if (ayCodes.length === 0) return [];

  return unstable_cache(
    () => loadLevelsAwaitingSectionsUncached(ayCodes),
    ['sis-levels-awaiting-sections', ...ayCodes],
    { tags: ayCodes.map((c) => `sis:${c}`), revalidate: CACHE_TTL_SECONDS }
  )();
}

export async function countLevelsAwaitingSections(): Promise<number> {
  const rows = await loadLevelsAwaitingSections();
  return rows.length;
}
