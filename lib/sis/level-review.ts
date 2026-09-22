import { unstable_cache } from 'next/cache';

import {
  getCurrentAcademicYear,
  getUpcomingAcademicYear,
} from '@/lib/academic-year';
import { canonicalizeLevelLabel, type LevelAliasRow } from '@/lib/sis/levels';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { createServiceClient } from '@/lib/supabase/service';

// ──────────────────────────────────────────────────────────────────────────
// Level-review detection — admissions rows whose `levelApplied` string
// doesn't match any level in the operational catalog (`public.levels`).
//
// Admissions tables (`ay{YYYY}_enrolment_applications` +
// `ay{YYYY}_enrolment_status`, both carrying their own unconstrained
// `levelApplied` text column, KD #53) accept free-form level names from the
// parent-portal SPA / Directus imports. Real-world observed drift includes:
//   - GEP-style descriptive labels ("HFSE Global Education Programme –
//     Year 2 (equivalent to Primary One)")
//   - spelling/casing variants of the Youngstarters tiers
//   - legacy digit-form labels ("Primary 1") — these are NOT drift; they
//     canonicalize cleanly onto the word-form label via
//     `canonicalizeLevelLabel` and must not surface here.
//
// This is the detection half only — it produces the list a registrar
// reviews later (Task 8) to either create a new `public.levels` row or
// remap the raw string onto an existing one. It does not write anything.
//
// Structure mirrors `lib/sis/unsynced-students.ts` (KD #46 dashboard-loader
// convention): a pure diff function with zero DB access (unit-tested in
// isolation), an uncached loader that does the actual fetching, and a
// cached public entry point that wraps it with `unstable_cache`.
// ──────────────────────────────────────────────────────────────────────────

export type UnmatchedLevelLabel = {
  /** Exact observed string from `levelApplied` — never normalized. */
  rawLabel: string;
  /** `rawLabel` post-`canonicalizeLevelLabel` — still doesn't match a known level. */
  canonicalLabel: string;
  /** Which in-scope AY code(s) this raw label appears in. */
  ayCodes: string[];
  /** Row count in `ay{YYYY}_enrolment_applications.levelApplied` across in-scope AYs. */
  appsCount: number;
  /** Row count in `ay{YYYY}_enrolment_status.levelApplied` across in-scope AYs. */
  statusCount: number;
  /** Up to 5 enrolee numbers observed with this raw label, for context copy. */
  sampleEnrolees: string[];
  /**
   * How many students this name is ACTUALLY blocking — enrolled, and with no
   * class yet. Distinct enrolees, so a child counted once even though their
   * label appears on both admissions tables.
   *
   * ⚠ THE WHOLE QUEUE USED TO IGNORE THIS, and it made mapping a name feel
   * broken. Every row with the label counted, Cancelled and Withdrawn
   * included, so the list advertised blockers while blocking nobody: on
   * 2026-09-22 all six Youngstarters variants were mapped, correctly vanished
   * — and not one child moved, because all 23 behind them were still
   * `Submitted`. Both surfaces that act on a resolved level are enrolled-only
   * (`lib/sis/levels-awaiting-sections.ts`, `lib/sis/unsynced-students.ts`),
   * so a name in front of no enrolled student has nowhere to send anyone.
   *
   * This is the same demand-driven rule the sibling card on that page already
   * follows — "a level appears only when real students are stuck behind it,
   * which makes an empty list genuinely mean 'nothing to do'". The two halves
   * of one page disagreeing about what counts as a blocker was the defect.
   */
  blockedCount: number;
};

// Per-(AY, rawLabel) aggregate — apps + status counts for that raw label
// within a single AY already summed. Built by the DB-touching loader from
// raw admissions rows; consumed by the pure diff function below so the
// merge/compare logic stays testable without a database connection.
export type ObservedLevelLabel = {
  rawLabel: string;
  ayCode: string;
  appsCount: number;
  statusCount: number;
  sampleEnrolees: string[];
  /**
   * The enrolees behind this label, in this AY, who are enrolled and have no
   * class. A SET, not a count, because the same child is observed once per
   * admissions table and must not be counted twice — the merge below unions
   * across AYs for the same reason.
   */
  blockedEnrolees?: string[];
};

const CACHE_TTL_SECONDS = 60;
const MAX_SAMPLE_ENROLEES = 5;

/**
 * Mirrors `lib/sis/levels-awaiting-sections.ts` — the statuses that mean a
 * child is on the roll and therefore has somewhere to go once their level
 * name resolves. Kept identical on purpose: if these two ever disagree, a
 * name would be reported as blocking a student that the list it hands them to
 * does not show.
 */
const ENROLLED_STATUSES = ['Enrolled', 'Enrolled (Conditional)'] as const;

function prefixFor(ayCode: string): string {
  return `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
}

/**
 * Pure diff — given the raw observed `levelApplied` labels (already
 * aggregated per AY by the caller), the current set of
 * `public.levels.label` values, and the registrar's saved aliases, returns
 * the labels that still resolve to nothing.
 *
 * Canonicalization (via `canonicalizeLevelLabel`) folds legacy digit-form
 * labels ("Primary 1") onto their word-form canonical ("Primary One") so
 * they do NOT surface as unmatched — only genuinely-unrecognized strings
 * (GEP-style descriptions, spelling variants, typos) do.
 *
 * `aliases` mirrors the third and final lookup in
 * `lib/sis/levels.ts::resolveLevelIdFromCatalog` — an EXACT match on the
 * raw label, never a canonicalized or fuzzy one. The two must agree: a
 * label the assignment path can resolve is, by definition, no longer
 * awaiting review. (Before this argument existed the queue read only
 * `levels.label`, so a mapped label stayed listed forever and the sidebar
 * badge never decremented, while the toast claimed it was resolved.)
 *
 * Observations for the same `rawLabel` across different AYs are merged into
 * one result row (`ayCodes` accumulates, counts sum, sample enrolees dedupe
 * up to `MAX_SAMPLE_ENROLEES`). No DB access — safe to unit test directly.
 *
 * `blockedEnrolees` is UNIONED rather than summed — see `blockedCount` on
 * `UnmatchedLevelLabel`. The same child is observed once per admissions table
 * and may carry the label in two AYs, and both would double-count a queue
 * whose entire purpose is to say how many people are actually waiting.
 */
export function diffUnmatchedLevelLabels(
  observed: ObservedLevelLabel[],
  knownLabels: string[],
  aliases: LevelAliasRow[] = []
): UnmatchedLevelLabel[] {
  const knownSet = new Set(
    knownLabels
      .map((l) => canonicalizeLevelLabel(l))
      .filter((l): l is string => l != null)
  );
  const aliasedSet = new Set(aliases.map((a) => a.raw_label));

  const merged = new Map<string, UnmatchedLevelLabel>();
  // Kept beside `merged` rather than on the row, so the union stays a Set
  // while it is being built and only becomes a number at the end.
  const blockedByLabel = new Map<string, Set<string>>();

  for (const obs of observed) {
    const canonical = canonicalizeLevelLabel(obs.rawLabel);
    if (canonical == null) continue; // blank/null observed label — nothing to reconcile
    if (knownSet.has(canonical)) continue; // matches an existing level — not unmatched
    if (aliasedSet.has(obs.rawLabel)) continue; // registrar already mapped it — resolved

    let blocked = blockedByLabel.get(obs.rawLabel);
    if (!blocked) {
      blocked = new Set<string>();
      blockedByLabel.set(obs.rawLabel, blocked);
    }
    for (const enrolee of obs.blockedEnrolees ?? []) blocked.add(enrolee);

    const existing = merged.get(obs.rawLabel);
    if (!existing) {
      merged.set(obs.rawLabel, {
        rawLabel: obs.rawLabel,
        canonicalLabel: canonical,
        ayCodes: [obs.ayCode],
        appsCount: obs.appsCount,
        statusCount: obs.statusCount,
        sampleEnrolees: obs.sampleEnrolees.slice(0, MAX_SAMPLE_ENROLEES),
        blockedCount: 0,
      });
      continue;
    }

    if (!existing.ayCodes.includes(obs.ayCode)) {
      existing.ayCodes.push(obs.ayCode);
    }
    existing.appsCount += obs.appsCount;
    existing.statusCount += obs.statusCount;
    for (const enrolee of obs.sampleEnrolees) {
      if (existing.sampleEnrolees.length >= MAX_SAMPLE_ENROLEES) break;
      if (!existing.sampleEnrolees.includes(enrolee)) {
        existing.sampleEnrolees.push(enrolee);
      }
    }
  }

  for (const [rawLabel, row] of merged) {
    row.blockedCount = blockedByLabel.get(rawLabel)?.size ?? 0;
  }

  // Blocking names first, most people waiting first within that — the queue
  // now leads with the rows a registrar can actually unblock someone by
  // clearing. Alphabetical remains the tiebreak, so the housekeeping tail
  // reads exactly as it did before.
  return Array.from(merged.values()).sort(
    (a, b) =>
      b.blockedCount - a.blockedCount || a.rawLabel.localeCompare(b.rawLabel)
  );
}

async function loadUnmatchedLevelLabelsUncached(
  ayCodes: string[]
): Promise<UnmatchedLevelLabel[]> {
  const admissions = createAdmissionsClient();
  const service = createServiceClient();

  // Both halves of "does this label resolve?" — the catalog and the saved
  // aliases. Fetched together because omitting either one produces a queue
  // that disagrees with the assignment path about what still needs work.
  const [levelsRes, aliasesRes] = await Promise.all([
    service.from('levels').select('label'),
    service.from('level_aliases').select('raw_label, level_id'),
  ]);
  if (levelsRes.error) {
    console.warn(
      '[sis/level-review] levels fetch failed:',
      levelsRes.error.message
    );
    return [];
  }
  if (aliasesRes.error) {
    // Fail soft rather than listing already-mapped labels as unresolved —
    // a queue that re-raises finished work is worse than an empty one.
    console.warn(
      '[sis/level-review] level_aliases fetch failed:',
      aliasesRes.error.message
    );
    return [];
  }
  const knownLabels = (
    (levelsRes.data ?? []) as Array<{ label: string | null }>
  )
    .map((r) => r.label)
    .filter((l): l is string => !!l);
  const aliases = (aliasesRes.data ?? []) as LevelAliasRow[];

  type Row = { enroleeNumber: string | null; levelApplied: string | null };
  type StatusRow = Row & {
    applicationStatus: string | null;
    classSection: string | null;
  };

  // Accumulate per (ayCode, rawLabel) — mirrors the ObservedLevelLabel shape
  // the pure diff function expects, one bucket per AY per raw label, with
  // apps/status counts from both tables folded into the same bucket.
  const buckets = new Map<string, ObservedLevelLabel>();

  function bucketKey(ayCode: string, rawLabel: string): string {
    return `${ayCode}::${rawLabel}`;
  }

  /**
   * Is this child actually waiting on the name? Enrolled, and with no class.
   *
   * ⚠ BLANK `classSection` IS THE TEST, not a missing column — `lib/sis/
   * levels-awaiting-sections.ts` treats a non-empty string as "already
   * seated" and this must agree with it, since that is the list a resolved
   * label hands the student to.
   */
  function isBlocked(row: StatusRow): boolean {
    const status = row.applicationStatus ?? '';
    if (!(ENROLLED_STATUSES as readonly string[]).includes(status))
      return false;
    return !(
      typeof row.classSection === 'string' && row.classSection.trim().length > 0
    );
  }

  function addObservations(
    ayCode: string,
    rows: Row[],
    field: 'appsCount' | 'statusCount',
    blockedEnrolees: ReadonlySet<string>
  ) {
    for (const row of rows) {
      const rawLabel = row.levelApplied?.trim();
      if (!rawLabel) continue;
      const key = bucketKey(ayCode, rawLabel);
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          rawLabel,
          ayCode,
          appsCount: 0,
          statusCount: 0,
          sampleEnrolees: [],
          blockedEnrolees: [],
        };
        buckets.set(key, bucket);
      }
      bucket[field] += 1;
      if (
        row.enroleeNumber &&
        bucket.sampleEnrolees.length < MAX_SAMPLE_ENROLEES &&
        !bucket.sampleEnrolees.includes(row.enroleeNumber)
      ) {
        bucket.sampleEnrolees.push(row.enroleeNumber);
      }
      // A child counts as blocked by this name if they carry it on EITHER
      // admissions table — the two can disagree, and the registrar's fix is
      // the same either way. `diffUnmatchedLevelLabels` unions, so listing a
      // number twice here is harmless.
      if (row.enroleeNumber && blockedEnrolees.has(row.enroleeNumber)) {
        bucket.blockedEnrolees?.push(row.enroleeNumber);
      }
    }
  }

  // ONE WAVE FOR EVERY YEAR IN SCOPE. Each AY reads its own prefixed tables and
  // nothing another year produced, so the years go out together rather than one
  // after the next.
  //
  // ⚠ THE FETCH IS PARALLEL; THE FOLD IS STILL IN `ayCodes` ORDER. `addObservations`
  // mutates shared buckets, and `sampleEnrolees` keeps only the FIRST few it
  // sees — folding in resolution order would make the samples depend on which
  // year's query happened to come back first. Fetch concurrently, reduce
  // deterministically.
  const perAy = await Promise.all(
    ayCodes.map(async (ayCode) => {
      const prefix = prefixFor(ayCode);
      const [appsRes, statusRes] = await Promise.all([
        admissions
          .from(`${prefix}_enrolment_applications`)
          .select('enroleeNumber, levelApplied'),
        // `applicationStatus` + `classSection` ride along on the query that
        // was already being made — they are what turn "this name appears on
        // N rows" into "this name is holding up N children".
        admissions
          .from(`${prefix}_enrolment_status`)
          .select(
            'enroleeNumber, levelApplied, applicationStatus, classSection'
          ),
      ]);
      return { ayCode, appsRes, statusRes };
    })
  );

  for (const { ayCode, appsRes, statusRes } of perAy) {
    if (appsRes.error) {
      console.warn(
        `[sis/level-review] apps fetch failed for ${ayCode}:`,
        appsRes.error.message
      );
      return [];
    }
    if (statusRes.error) {
      console.warn(
        `[sis/level-review] status fetch failed for ${ayCode}:`,
        statusRes.error.message
      );
      return [];
    }

    // Who is waiting, decided once per AY from the status table — the only
    // side that carries `applicationStatus` and `classSection`. Built before
    // either fold so the apps-side rows can be judged by it too.
    const statusRows = (statusRes.data ?? []) as StatusRow[];
    const blockedEnrolees = new Set<string>();
    for (const row of statusRows) {
      if (row.enroleeNumber && isBlocked(row)) {
        blockedEnrolees.add(row.enroleeNumber);
      }
    }

    addObservations(
      ayCode,
      (appsRes.data ?? []) as Row[],
      'appsCount',
      blockedEnrolees
    );
    addObservations(ayCode, statusRows, 'statusCount', blockedEnrolees);
  }

  return diffUnmatchedLevelLabels(
    Array.from(buckets.values()),
    knownLabels,
    aliases
  );
}

/**
 * Resolves the in-scope AY set as `{ current AY } ∪ { upcoming accepting
 * AY, if any }`, then queries both admissions tables per in-scope AY for
 * `levelApplied` values that don't match any `public.levels.label`.
 *
 * The AY lookups (`getCurrentAcademicYear` / `getUpcomingAcademicYear`) use
 * a cookie-scoped server client, so they must resolve BEFORE entering
 * `unstable_cache` — cookie-scoped clients are forbidden inside
 * `unstable_cache` in Next 16 (KD #54's gotcha). Cached per AY-code-set,
 * tagged `sis:${ayCode}` for every in-scope AY code (60s TTL) — already
 * invalidated by every admissions mutation. Fails soft to `[]` on any query
 * error (mirrors `lib/sis/unsynced-students.ts`).
 */
export async function loadUnmatchedLevelLabels(): Promise<
  UnmatchedLevelLabel[]
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
    () => loadUnmatchedLevelLabelsUncached(ayCodes),
    ['sis-level-review', ...ayCodes],
    { tags: ayCodes.map((c) => `sis:${c}`), revalidate: CACHE_TTL_SECONDS }
  )();
}

export async function countUnmatchedLevelLabels(): Promise<number> {
  const rows = await loadUnmatchedLevelLabels();
  return rows.length;
}

/**
 * Unrecognized level names that are holding up at least one child.
 *
 * ⚠ THIS, NOT `countUnmatchedLevelLabels`, IS WHAT THE SIDEBAR BADGE COUNTS.
 * A badge is a claim that there is work waiting, and the full count makes
 * that claim on behalf of names nobody is standing behind — today every one
 * of the 11 unmapped names belongs to applicants who are still `Submitted`
 * or to a child who already has a class, so the old badge read 11 with
 * nothing to do. Its sibling half (`countLevelsAwaitingSections`) has always
 * been demand-driven; this makes the two halves of one number agree.
 *
 * The names with nobody waiting have not gone anywhere — the page still
 * lists them under their own tab, which is where housekeeping belongs.
 */
export async function countBlockingLevelLabels(): Promise<number> {
  const rows = await loadUnmatchedLevelLabels();
  return rows.filter((r) => r.blockedCount > 0).length;
}
