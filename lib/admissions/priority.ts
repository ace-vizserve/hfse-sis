import { unstable_cache } from 'next/cache';

import { createAdmissionsClient } from '@/lib/supabase/admissions';
import type { PriorityPayload } from '@/lib/dashboard/priority';

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

function prefixFor(ayCode: string): string {
  return `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
}

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
  ayCode: string,
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
      statusErr.message,
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

  const { data: appsData, error: appsErr } = await supabase
    .from(`${prefix}_enrolment_applications`)
    .select(
      'enroleeNumber, enroleeFullName, firstName, lastName, levelApplied, created_at',
    )
    .in('enroleeNumber', submittedEnroleeNumbers)
    .order('created_at', { ascending: false });

  if (appsErr) {
    console.error(
      '[admissions] getNewApplicationsPriority apps fetch failed:',
      appsErr.message,
    );
  }

  const appsByEnrolee = new Map<string, AppRow>();
  for (const a of ((appsData ?? []) as AppRow[])) {
    if (a.enroleeNumber) appsByEnrolee.set(a.enroleeNumber, a);
  }

  // Top 6 most recent applicants — `appsData` is already date-desc.
  const topApps = ((appsData ?? []) as AppRow[]).slice(0, 6);

  const chips = topApps
    .filter((a) => a.enroleeNumber)
    .map((a) => {
      const name = displayName(a);
      const level = a.levelApplied?.trim();
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
      label: count === 1 ? 'View application' : `View all ${count} new applications`,
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

export function getNewApplicationsPriority(ayCode: string): Promise<PriorityPayload> {
  return unstable_cache(
    loadNewApplicationsPriorityUncached,
    ['admissions', 'priority-new-applications', ayCode],
    { tags: tag(ayCode), revalidate: CACHE_TTL_SECONDS },
  )(ayCode);
}
