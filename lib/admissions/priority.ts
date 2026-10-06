import { unstable_cache } from 'next/cache';

import { createAdmissionsClient } from '@/lib/supabase/admissions';
import type { PriorityPayload } from '@/lib/dashboard/priority';
import { prefixFor } from '@/lib/admissions/_shared';
import { loadAdmissionsLevelResolver } from '@/lib/admissions/level-resolver';

// Admissions PriorityPanel payload — top-of-fold "what should I act on right
// now?" answer for the Admissions module. Surfaces students who have just
// submitted an application and are waiting on the admissions team's first
// review pass.
//
// Data shape (KD #53): joined ay{YY}_enrolment_applications × ay{YY}_enrolment_status
// via enroleeNumber. `applicationStatus` lives on the *status* table; name +
// levelApplied + created_at live on the *apps* table — this split is load-bearing
// (see lib/admissions/dashboard.ts header for the column-ownership note).
//
// Cache pattern mirrors lib/admissions/dashboard.ts: hoisted load fn +
// per-call unstable_cache wrapper with the canonical
// `admissions-dashboard:${ayCode}` tag (KD #18).

const CACHE_TTL_SECONDS = 60;

function tag(ayCode: string): string[] {
  return ['admissions-dashboard', `admissions-dashboard:${ayCode}`];
}

type StatusRow = {
  enroleeNumber: string | null;
  applicationStatus: string | null;
};

type AppRow = {
  enroleeNumber: string | null;
  enroleeFullName: string | null;
  firstName: string | null;
  lastName: string | null;
  levelApplied: string | null;
  created_at: string | null;
};

function displayName(row: AppRow): string {
  const full = row.enroleeFullName?.trim();
  if (full) return full;
  const first = row.firstName?.trim() ?? '';
  const last = row.lastName?.trim() ?? '';
  const composed = `${first} ${last}`.trim();
  return composed || row.enroleeNumber || 'Unknown applicant';
}

async function loadNewApplicationsPriorityUncached(
  ayCode: string
): Promise<PriorityPayload> {
  const prefix = prefixFor(ayCode);
  const supabase = createAdmissionsClient();

  // Pull every Submitted enrolee number from the status table, then resolve
  // names + level + application date from the apps table. Two-step join
  // because no FK is declared between the two admissions tables (see
  // lib/supabase/admissions.ts::fetchAdmissionsRoster for prior art).
  const { data: statusData, error: statusErr } = await supabase
    .from(`${prefix}_enrolment_status`)
    .select('enroleeNumber, applicationStatus')
    .eq('applicationStatus', 'Submitted');

  if (statusErr) {
    console.error(
      '[admissions] getNewApplicationsPriority status fetch failed:',
      statusErr.message
    );
    return emptyPayload();
  }

  const submittedEnroleeNumbers = ((statusData ?? []) as StatusRow[])
    .map((r) => r.enroleeNumber)
    .filter((x): x is string => !!x);

  const count = submittedEnroleeNumbers.length;
  if (count === 0) {
    return emptyPayload();
  }

  const [{ data: appsData, error: appsErr }, resolveLevel] = await Promise.all([
    supabase
      .from(`${prefix}_enrolment_applications`)
      .select(
        'enroleeNumber, enroleeFullName, firstName, lastName, levelApplied, created_at'
      )
      .in('enroleeNumber', submittedEnroleeNumbers)
      .order('created_at', { ascending: false }),
    loadAdmissionsLevelResolver(),
  ]);

  if (appsErr) {
    console.error(
      '[admissions] getNewApplicationsPriority apps fetch failed:',
      appsErr.message
    );
  }

  const appsByEnrolee = new Map<string, AppRow>();
  for (const a of (appsData ?? []) as AppRow[]) {
    if (a.enroleeNumber) appsByEnrolee.set(a.enroleeNumber, a);
  }

  // Top 6 most recent applicants — `appsData` is already date-desc.
  const topApps = ((appsData ?? []) as AppRow[]).slice(0, 6);

  const chips = topApps
    .filter((a) => a.enroleeNumber)
    .map((a) => {
      const name = displayName(a);
      // The SIS level the applied-for name counts as ("Year 10" → Secondary
      // Three); an unmapped name shows as stored.
      const level = resolveLevel(a.levelApplied);
      return {
        label: level ? `${name} · ${level}` : name,
        // Days waiting since the application was submitted. Falls back to 0
        // when created_at is missing — the chip still renders.
        count: daysSince(a.created_at),
        href: `/admissions/applications/${encodeURIComponent(a.enroleeNumber!)}`,
        severity: 'info' as const,
      };
    });

  return {
    eyebrow: 'Priority · today',
    title:
      count === 1
        ? '1 student has submitted an application'
        : `${count.toLocaleString('en-SG')} students have submitted an application`,
    headline: {
      value: count,
      label:
        count === 1
          ? 'application waiting for first review'
          : 'applications waiting for first review',
      severity: 'info',
    },
    chips,
    cta: {
      label:
        count === 1 ? 'View application' : `View all ${count} new applications`,
      href: `/admissions/applications?ay=${encodeURIComponent(ayCode)}`,
    },
    iconKey: 'list',
  };
}

function emptyPayload(): PriorityPayload {
  return {
    eyebrow: 'Priority · today',
    title: 'No new applications waiting',
    headline: {
      value: 0,
      label: 'inbox is clear',
      severity: 'good',
    },
    chips: [],
    iconKey: 'check',
  };
}

function daysSince(iso: string | null): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  const now = Date.now();
  const diffMs = now - t;
  if (diffMs < 0) return 0;
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

export function getNewApplicationsPriority(
  ayCode: string
): Promise<PriorityPayload> {
  return unstable_cache(
    loadNewApplicationsPriorityUncached,
    ['admissions', 'priority-new-applications', ayCode],
    { tags: tag(ayCode), revalidate: CACHE_TTL_SECONDS }
  )(ayCode);
}

// ──────────────────────────────────────────────────────────────────────────
// Admissions chase PriorityPanel (Workstream A) — top-of-fold "which
// applicants need an admissions-team chase right now?". Mirrors P-Files'
// `getPFilesPriority` shape but uses the admissions-side chase signals
// instead of expiry. Reuses `getAdmissionsCompletenessForChase` so we
// don't introduce a second pass over the same docs/status tables.
// ──────────────────────────────────────────────────────────────────────────

export type AdmissionsPriorityInput = {
  ayCode: string;
};

const PRIORITY_CACHE_TTL = 600;

async function loadAdmissionsPriorityUncached(
  input: AdmissionsPriorityInput
): Promise<PriorityPayload> {
  // Lazy import to keep the priority module decoupled from dashboard.ts
  // at type-resolution time (dashboard.ts already imports priority.ts via
  // the priority panel wrapper, so a direct top-level import here would
  // create a cycle).
  const { getAdmissionsCompletenessForChase } =
    await import('@/lib/admissions/dashboard');
  const { students } = await getAdmissionsCompletenessForChase(
    input.ayCode,
    'all'
  );

  // Rank by total chase pressure (toFollow + rejected + expired) desc;
  // tiebreak by oldest submitted date asc — surfaces the
  // most-overdue-and-most-needy applicants first. Uploaded is intentionally
  // excluded — it's the awaiting-validation queue (registrar work), not a
  // chase trigger; surfacing it would inflate the chase headline.
  const ranked = students
    .filter((s) => s.toFollow + s.rejected + s.expired > 0)
    .sort((a, b) => {
      const aScore = a.toFollow + a.rejected + a.expired;
      const bScore = b.toFollow + b.rejected + b.expired;
      if (aScore !== bScore) return bScore - aScore;
      const aDate = a.submittedDate
        ? Date.parse(a.submittedDate)
        : Number.POSITIVE_INFINITY;
      const bDate = b.submittedDate
        ? Date.parse(b.submittedDate)
        : Number.POSITIVE_INFINITY;
      return aDate - bDate;
    });

  const total = ranked.length;
  const top = ranked.slice(0, 5);

  if (total === 0) {
    return {
      eyebrow: 'Priority · today',
      title: 'No applicant documents need a chase',
      headline: { value: 0, label: 'inbox is clear', severity: 'good' },
      chips: [],
      iconKey: 'check',
    };
  }

  const chips = top.map((row) => {
    const signalCount = row.toFollow + row.rejected + row.expired;
    return {
      label: row.fullName || row.enroleeNumber,
      count: signalCount,
      href: `/admissions/applications/${encodeURIComponent(row.enroleeNumber)}?ay=${encodeURIComponent(input.ayCode)}`,
      // Rejected + Expired are hard "registrar said no" / "doc lapsed"
      // signals — escalate to 'bad'. To-follow alone is a soft commitment
      // signal — 'warn'.
      severity:
        row.rejected > 0 || row.expired > 0
          ? ('bad' as const)
          : ('warn' as const),
    };
  });

  return {
    eyebrow: 'Priority · today',
    title:
      total === 1
        ? '1 applicant has documents needing a chase'
        : `${total.toLocaleString('en-SG')} applicants have documents needing a chase`,
    headline: {
      value: total,
      label:
        total === 1 ? 'applicant in chase queue' : 'applicants in chase queue',
      severity: 'warn',
    },
    chips,
    cta: {
      label: 'Open To-follow list',
      href: `/admissions?ay=${encodeURIComponent(input.ayCode)}&status=to-follow`,
    },
    iconKey: 'list',
  };
}

export function getAdmissionsPriority(
  input: AdmissionsPriorityInput
): Promise<PriorityPayload> {
  return unstable_cache(
    () => loadAdmissionsPriorityUncached(input),
    ['admissions', 'priority-chase', input.ayCode],
    { tags: tag(input.ayCode), revalidate: PRIORITY_CACHE_TTL }
  )();
}
