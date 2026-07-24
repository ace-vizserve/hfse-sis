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
import { getPFilesKpisRange, getPFilesPriority } from '@/lib/p-files/dashboard';
import { getOutdatedApplications } from '@/lib/admissions/dashboard';

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
 * `getPFilesPriority` takes `{ ayCode }` (not a bare string) and its
 * `PriorityPayload.headline.value` is overdue-count + due-within-14-days
 * count combined — there is no separate `overdueCount` field on the real
 * type, so the "Needs urgent attention" row reads `headline.value` and is
 * labelled to match what that number actually represents.
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
      const priority = await getPFilesPriority({ ayCode });
      return {
        label: 'Needs urgent attention',
        value: priority.headline.value,
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
