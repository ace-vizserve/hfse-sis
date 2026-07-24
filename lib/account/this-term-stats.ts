import type { SupabaseClient } from '@supabase/supabase-js';
import type { Role } from '@/lib/auth/roles';
import { sgToday } from '@/lib/dates';
import { getTeacherSections } from '@/lib/account/sections';
import { getEvaluationTeacherPriority } from '@/lib/evaluation/dashboard';
import {
  getMarkbookTeacherPriority,
  getMarkbookKpisRange,
} from '@/lib/markbook/dashboard';
import { getSidebarChangeRequestCount } from '@/lib/change-requests/sidebar-counts';
import { getStaffCount } from '@/lib/auth/staff-list';
import { getPFilesKpisRange } from '@/lib/p-files/dashboard';
import { getOutdatedApplications } from '@/lib/admissions/dashboard';
import { getExpiringDocuments } from '@/lib/sis/dashboard';

export type StatRow = {
  label: string;
  value: string | number;
  tone?: 'default' | 'warning';
};

type Params = {
  role: Role;
  userId: string;
  email: string;
  ayCode: string;
  supabase: SupabaseClient;
  service: SupabaseClient;
};

/**
 * The account page's "This term" stat rows for one role — every value is
 * read from an existing, already-used dashboard/priority computation (see
 * docs/superpowers/specs/2026-07-24-account-page-role-aware-design.md,
 * Section 5). A branch that throws is omitted, not shown as a false "0".
 *
 * `getMarkbookKpisRange` / `getPFilesKpisRange` take the full `RangeInput`
 * shape (ayCode + from/to + cmpFrom/cmpTo, all required) — the fields this
 * file reads off `current` (`changeRequestsPending`, `expiringSoon30`) are
 * both live-state counts computed with NO date window internally (see the
 * source comments in lib/markbook/dashboard.ts and lib/p-files/dashboard.ts),
 * so the from/to values passed here don't affect the result — a single-day
 * "today" range is used only to satisfy the required shape.
 *
 * p_file_officer's "Already expired" row derives `overdue.length` the same
 * way `getPFilesPriority` computes its internal `overdue` array
 * (lib/p-files/dashboard.ts:759) — calling the already-cached
 * `getExpiringDocuments(ayCode, 60, 10_000)` directly and filtering to
 * `daysUntilExpiry < 0` — rather than reading `getPFilesPriority`'s
 * `headline.value`, which is overdue-count + due-within-14-days count
 * combined and would double-count against the adjacent "Expiring within
 * 30 days" row.
 */
export async function getThisTermStats(params: Params): Promise<StatRow[]> {
  const { role, userId, ayCode, supabase, service } = params;
  const rows: StatRow[] = [];

  const push = async (fn: () => Promise<StatRow | null>) => {
    try {
      const row = await fn();
      if (row) rows.push(row);
    } catch {
      // Omit on failure — see doc comment above.
    }
  };

  if (role === 'teacher') {
    await push(async () => {
      const sections = await getTeacherSections(supabase, userId);
      return { label: 'Sections', value: sections.length };
    });
    await push(async () => {
      const p = await getEvaluationTeacherPriority({
        ayCode,
        teacherUserId: userId,
      });
      return {
        label: 'Write-ups still needed',
        value: p.headline.value,
        tone: 'warning',
      };
    });
    await push(async () => {
      const p = await getMarkbookTeacherPriority({
        ayCode,
        teacherUserId: userId,
      });
      return { label: 'Open grading sheets', value: p.headline.value };
    });
    return rows;
  }

  if (role === 'academic_coordinator') {
    await push(async () => {
      const today = sgToday();
      const kpis = await getMarkbookKpisRange({
        ayCode,
        from: today,
        to: today,
        cmpFrom: null,
        cmpTo: null,
      });
      return {
        label: 'Change requests pending',
        value: kpis.current.changeRequestsPending,
        tone: 'warning',
      };
    });
    return rows;
  }

  if (role === 'school_admin') {
    await push(async () => {
      const count = await getSidebarChangeRequestCount(service, role, userId);
      return { label: 'Awaiting your review', value: count, tone: 'warning' };
    });
    return rows;
  }

  if (role === 'superadmin') {
    await push(async () => {
      const count = await getStaffCount();
      return { label: 'Active staff accounts', value: count };
    });
    // Test-environment convention (KD #52): a test AY's code matches
    // ^AY9 (e.g. AY9999); production AYs don't. Synchronous facts, no
    // dashboard call, so no push() wrapper is needed.
    rows.push({
      label: 'Environment',
      value: /^AY9/.test(ayCode) ? 'Test' : 'Production',
      tone: 'default',
    });
    rows.push({ label: 'Current AY', value: ayCode, tone: 'default' });
    return rows;
  }

  if (role === 'p_file_officer') {
    await push(async () => {
      const today = sgToday();
      const kpis = await getPFilesKpisRange({
        ayCode,
        from: today,
        to: today,
        cmpFrom: null,
        cmpTo: null,
      });
      return {
        label: 'Expiring within 30 days',
        value: kpis.current.expiringSoon30,
        tone: 'warning',
      };
    });
    await push(async () => {
      const expiring = await getExpiringDocuments(ayCode, 60, 10_000);
      const overdue = expiring.filter((r) => r.daysUntilExpiry < 0);
      return {
        label: 'Already expired',
        value: overdue.length,
        tone: 'warning',
      };
    });
    return rows;
  }

  if (role === 'admissions') {
    await push(async () => {
      const outdated = await getOutdatedApplications(ayCode);
      return {
        label: 'Applications needing follow-up',
        value: outdated.length,
        tone: 'warning',
      };
    });
    return rows;
  }

  return rows;
}
