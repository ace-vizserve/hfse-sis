import { unstable_cache } from 'next/cache';

import { createServiceClient } from '@/lib/supabase/service';

export type StaffMember = {
  id: string;
  email: string;
  name: string;
  disabled: boolean;
};

type Options = {
  /**
   * When `true` (default), users with `app_metadata.disabled === true` are
   * dropped from the result. Set to `false` for admin surfaces that need to
   * see and re-enable the disabled accounts.
   */
  excludeDisabled?: boolean;
};

// ---------------------------------------------------------------------------
// Internal: single cached listUsers call shared by all staff helpers.
// Callers filter in-memory so the auth admin endpoint is only hit once per
// 5-minute window regardless of how many helpers are called on the same page.
// ---------------------------------------------------------------------------

type _StaffRecord = {
  id: string;
  email: string;
  role: string | null;
  name: string;
  disabled: boolean;
};

async function loadAllStaffUncached(): Promise<_StaffRecord[]> {
  try {
    const service = createServiceClient();
    const { data } = await service.auth.admin.listUsers({ perPage: 1000 });
    const out: _StaffRecord[] = [];
    for (const u of data?.users ?? []) {
      if (!u.email) continue;
      const appMeta = (u.app_metadata ?? {}) as {
        role?: string;
        disabled?: boolean;
      };
      const userMeta = (u.user_metadata ?? {}) as {
        role?: string;
        full_name?: string;
        name?: string;
      };
      const role = appMeta.role ?? userMeta.role ?? null;
      const disabled = appMeta.disabled === true;
      const name = (userMeta.full_name ?? userMeta.name ?? u.email).trim();
      out.push({ id: u.id, email: u.email, role, name, disabled });
    }
    return out;
  } catch {
    return [];
  }
}

// Hoisted to module scope — the key/tags are fully static (no per-call
// parameter), so recreating the wrapper inside the exported function on
// every call is the anti-pattern §2 of docs/context/11-performance-patterns.md
// warns against.
const _loadAllStaffCached = unstable_cache(
  loadAllStaffUncached,
  ['all-staff-list'],
  { revalidate: 300, tags: ['teacher-emails'] }
);

function _loadAllStaff(): Promise<_StaffRecord[]> {
  return _loadAllStaffCached();
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Returns auth users with `app_metadata.role === 'teacher'`. Sorted by
 * display name. 5-min cache shared with the `teacher-emails` tag so any
 * user-list invalidation hits both layers.
 *
 * Returns Array (not Map) because Next 16's unstable_cache JSON-serializes
 * Maps as `{}`. Callers iterate or build their own Map.
 *
 * Used by surfaces that need a "pick a teacher" combobox — e.g. the
 * teacher_name dropdown on /markbook/grading/new.
 */
export async function getTeacherList(
  options: Options = {}
): Promise<StaffMember[]> {
  const excludeDisabled = options.excludeDisabled ?? true;
  const all = await _loadAllStaff();
  return all
    .filter((u) => u.role === 'teacher' && (!excludeDisabled || !u.disabled))
    .map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      disabled: u.disabled,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Returns school_admin + superadmin emails — used for change-request
 * approval notifications. Shares the same underlying cached listUsers call.
 */
export async function getApproverEmailList(): Promise<string[]> {
  const all = await _loadAllStaff();
  return all
    .filter((u) => u.role === 'school_admin' || u.role === 'superadmin')
    .map((u) => u.email);
}

/**
 * Returns registrar emails — used for change-request workflow notifications.
 * Shares the same underlying cached listUsers call.
 */
export async function getRegistrarEmailList(): Promise<string[]> {
  const all = await _loadAllStaff();
  return all.filter((u) => u.role === 'registrar').map((u) => u.email);
}

/**
 * Returns email → display-name entries for all staff — used by audit-log
 * pages to resolve actor emails to human names. Returns Array (not Map) to
 * survive unstable_cache JSON serialization; callers do `new Map(entries)`.
 */
export async function getStaffDisplayEntries(): Promise<
  Array<[string, string]>
> {
  const all = await _loadAllStaff();
  return all.map((u) => [u.email, u.name]);
}

/**
 * Returns userId → display-name entries for all staff — used to resolve a
 * `teacher_assignments.teacher_user_id` to a human name (e.g. the form
 * adviser on a report card or masterfile row) without a separate Auth Admin
 * call per lookup. Returns Array (not Map) to survive unstable_cache JSON
 * serialization; callers do `new Map(entries)`.
 */
export async function getStaffDisplayNameById(): Promise<
  Array<[string, string]>
> {
  const all = await _loadAllStaff();
  return all.map((u) => [u.id, u.name]);
}

/**
 * Returns a count of active (non-disabled) staff accounts — used by the SIS
 * Admin sidebar's Staff count chip (SIS Admin visual pass, Task V2). Shares
 * the same 5-min cached listUsers() call as every other helper in this file
 * — no new query, just a length over the already-cached list.
 */
export async function getStaffCount(): Promise<number> {
  const all = await _loadAllStaff();
  return all.filter((u) => !u.disabled).length;
}
