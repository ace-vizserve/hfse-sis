// lib/sis/hub-snapshot.ts
//
// Composed snapshot for the SIS Admin hub: level distribution, staff
// headcount by role, active-section roster stats, and the current-term
// window — all for one AY. Follows the KD #46 cache-wrapper pattern (hoist
// the uncached loader, wrap per-call with unstable_cache).
import 'server-only';
import { unstable_cache } from 'next/cache';

import { getLevelDistribution, type LevelCount } from '@/lib/sis/dashboard';
import { listStaffUsers, type AdminUserRow } from '@/lib/sis/users/queries';
import { resolveCurrentTerm, type TermLike } from '@/lib/sis/current-term';
import { createServiceClient } from '@/lib/supabase/service';
import { sgToday } from '@/lib/dates';
import { ROLES, type Role } from '@/lib/auth/roles';

export type HubSnapshot = {
  levelCounts: LevelCount[];
  staffByRole: Record<Role, number>;
  totalStaff: number;
  activeSections: number;
  avgRosterSize: number | null;
  currentTermLabel: string | null;
  daysLeftInTerm: number | null;
};

// ── Pure helpers (exported for unit tests) ─────────────────────────────────

export function tallyStaffByRole(users: AdminUserRow[]): Record<Role, number> {
  const tally = Object.fromEntries(ROLES.map((r) => [r, 0])) as Record<
    Role,
    number
  >;
  for (const u of users) {
    if (u.role) tally[u.role] += 1;
  }
  return tally;
}

export function averageRosterSize(counts: number[]): number | null {
  if (counts.length === 0) return null;
  const total = counts.reduce((s, n) => s + n, 0);
  return Math.round((total / counts.length) * 10) / 10;
}

// Raw Date.UTC math per KD #32 — no dayjs/date-fns/moment. Mirrors the exact
// pattern in lib/sis/enrolment-position.ts::daysBetween.
export function daysUntil(todayIso: string, endIso: string): number {
  const u = (iso: string) =>
    Date.UTC(
      Number(iso.slice(0, 4)),
      Number(iso.slice(5, 7)) - 1,
      Number(iso.slice(8, 10))
    );
  return Math.round((u(endIso) - u(todayIso)) / 86_400_000);
}

// ── Loader ───────────────────────────────────────────────────────────────

async function loadHubSnapshotUncached(ayCode: string): Promise<HubSnapshot> {
  const service = createServiceClient();

  const { data: ayRow } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode)
    .maybeSingle();
  const ayId = (ayRow as { id: string } | null)?.id;

  const [levelCounts, staffUsers, termsRes, sectionsRes] = await Promise.all([
    getLevelDistribution(ayCode),
    listStaffUsers(),
    ayId
      ? service
          .from('terms')
          .select('id, term_number, start_date, end_date')
          .eq('academic_year_id', ayId)
      : Promise.resolve({ data: [] as TermLike[] }),
    ayId
      ? service.from('sections').select('id').eq('academic_year_id', ayId)
      : Promise.resolve({ data: [] as { id: string }[] }),
  ]);

  const sectionIds = ((sectionsRes.data ?? []) as { id: string }[]).map(
    (s) => s.id
  );
  const rosterCounts: number[] = [];
  if (sectionIds.length > 0) {
    const { data: enrolments } = await service
      .from('section_students')
      .select('section_id')
      .in('section_id', sectionIds)
      .neq('enrollment_status', 'withdrawn');
    const bySection = new Map<string, number>();
    for (const row of (enrolments ?? []) as { section_id: string }[]) {
      bySection.set(row.section_id, (bySection.get(row.section_id) ?? 0) + 1);
    }
    for (const id of sectionIds) rosterCounts.push(bySection.get(id) ?? 0);
  }

  const terms = (termsRes.data ?? []) as TermLike[];
  const today = sgToday();
  const currentTerm = resolveCurrentTerm(terms, today);

  return {
    levelCounts,
    staffByRole: tallyStaffByRole(staffUsers),
    totalStaff: staffUsers.length,
    activeSections: sectionIds.length,
    avgRosterSize: averageRosterSize(rosterCounts),
    currentTermLabel: currentTerm ? `Term ${currentTerm.term_number}` : null,
    daysLeftInTerm: currentTerm?.end_date
      ? Math.max(0, daysUntil(today, currentTerm.end_date))
      : null,
  };
}

export function getHubSnapshot(ayCode: string): Promise<HubSnapshot> {
  return unstable_cache(
    () => loadHubSnapshotUncached(ayCode),
    ['sis-hub-snapshot', ayCode],
    { tags: ['sis', `sis:${ayCode}`], revalidate: 300 }
  )();
}
