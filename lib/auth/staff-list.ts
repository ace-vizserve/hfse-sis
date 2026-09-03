import { unstable_cache } from 'next/cache';

import { ROLES, resolveRoleSetFromMetadata, type Role } from '@/lib/auth/roles';
import { createServiceClient } from '@/lib/supabase/service';
import { listAllAuthUsers } from '@/lib/supabase/paginate';

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

// ⚠ `roles`, NOT `role`, AND IT IS ALREADY NARROWED TO REAL ROLES.
//
// An account may hold more than one role now (`app_metadata.role` is an array
// with `app_metadata.active_role` naming the one in force). Every helper in
// this file answers a question about the ACCOUNT — "whose job is teaching",
// "who may be recorded as teaching a class", "who gets the approver email" —
// not about the person reading the page, so every one of them asks what the
// account MAY be, not which role it happens to be using at this instant. A
// list that flipped depending on what a different member of staff was doing
// right now would be a bug nobody could reproduce.
//
// For the accounts that still store a single role string — which is all of them
// until one is edited — this is a one-element list and every helper below
// behaves exactly as it did before.
//
// `resolveRoleSetFromMetadata` applies the `ROLES` membership test itself, so
// an empty list means "not staff": `'registrar'` (the pre-migration-092 name),
// `''`, and any string the separate parent-portal repo might one day write into
// `user_metadata.role` all arrive here as `[]`. See `getTeacherList` below for
// why that membership test is the security property and not a formality.
type _StaffRecord = {
  id: string;
  email: string;
  roles: Role[];
  name: string;
  disabled: boolean;
};

export type StaffUserMetadata = {
  role?: string;
  display_name?: string;
  full_name?: string;
  name?: string;
};

/**
 * Resolve a staff account's display name from its `user_metadata`.
 *
 * `display_name` MUST come first: it is the key our own provisioning writes
 * (`POST /api/sis/admin/users` → `user_metadata: { display_name }`, KD #87, and
 * the per-user PATCH writes the same key). This chain previously started at
 * `full_name`, which nothing in this codebase ever writes — so every name fell
 * through to the email address, and the staff directory (which reads
 * `display_name` directly in lib/sis/users/queries.ts) disagreed with every
 * operational surface that goes through this file: the grading-sheet hero, the
 * section teachers tab, the attendance adviser line, the masterfile's form
 * adviser column.
 *
 * `full_name` / `name` are kept behind it for accounts created outside our own
 * route — the Supabase dashboard and OAuth providers populate those instead.
 *
 * Blank and whitespace-only values fall through rather than winning: `??` only
 * skips null/undefined, so without the check a `display_name: ''` would render
 * as an empty name with no way to tell which account it was.
 *
 * Extracted and exported purely so this is unit-testable without mocking
 * `listUsers` + `unstable_cache` — same reasoning as
 * lib/markbook/subject-teacher.ts::buildSubjectTeacherNameMap (KD #158).
 */
export function resolveStaffName(
  userMeta: StaffUserMetadata,
  email: string
): string {
  const firstNonBlank = (...vals: Array<string | undefined>) => {
    for (const v of vals) {
      const t = v?.trim();
      if (t) return t;
    }
    return '';
  };
  return firstNonBlank(
    userMeta.display_name,
    userMeta.full_name,
    userMeta.name,
    email
  );
}

async function loadAllStaffUncached(): Promise<_StaffRecord[]> {
  try {
    const service = createServiceClient();
    // Paginate. This was a single `listUsers({ perPage: 1000 })`, which returns
    // only the FIRST page — and parents authenticate against this same Supabase
    // project (KD #1), so the user table is dominated by non-staff accounts:
    // measured 1,039 auth users of which 9 have a role. The single call silently
    // dropped 39 of them, and which 39 depends on listUsers' ordering, so a
    // staff account could vanish from every name lookup, teacher picker and
    // approver list with no error. Reuses the existing helper rather than a
    // second hand-rolled loop.
    const users = await listAllAuthUsers(service);
    const out: _StaffRecord[] = [];
    for (const u of users) {
      if (!u.email) continue;
      const appMeta = (u.app_metadata ?? {}) as {
        role?: unknown;
        active_role?: unknown;
        disabled?: boolean;
      };
      const userMeta = (u.user_metadata ?? {}) as StaffUserMetadata;
      const roles = resolveRoleSetFromMetadata(appMeta, userMeta);
      const disabled = appMeta.disabled === true;
      const name = resolveStaffName(userMeta, u.email);
      out.push({ id: u.id, email: u.email, roles, name, disabled });
    }
    return out;
  } catch (e) {
    // Log, don't swallow silently. An empty list here is indistinguishable from
    // "no staff exist": every name lookup misses, and callers fall back to
    // whatever they have — buildSubjectTeacherNameMap renders the raw
    // `teacher_user_id`, so a failure in here surfaces to a user as a UUID on
    // the grading sheet with nothing in the logs to explain it. The empty
    // return is kept (a name lookup must not take a page down) but it is no
    // longer invisible, and unstable_cache will hold this result for its full
    // 300s window, so knowing it happened matters.
    console.error('[staff-list] failed to load staff accounts:', e);
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
 * Returns auth users who hold the `teacher` role — including an account that
 * holds it alongside another one, and whichever of the two it is currently
 * working in. Sorted by display name. 5-min cache shared with the
 * `teacher-emails` tag so any user-list invalidation hits both layers.
 *
 * Returns Array (not Map) because Next 16's unstable_cache JSON-serializes
 * Maps as `{}`. Callers iterate or build their own Map.
 *
 * ⚠ THIS IS THE ONE LIST, AND IT ANSWERS BOTH QUESTIONS. "Whose job is
 * teaching" and "who may be recorded as teaching a class" used to be two
 * helpers, because an account held exactly one role forever and six
 * `school_admin` accounts who genuinely teach could not hold `teacher` at all.
 * An account now holds a LIST of roles, so the answer to both is the same:
 * Mr Ace's rule is that **a teaching assignment requires the teacher role**,
 * and an admin who teaches is granted it.
 *
 * ⚠ THE FILTER IS `ROLES` MEMBERSHIP, AND THE SECURITY PROPERTY DEPENDS ON IT.
 * Parents authenticate against this same Supabase project (KD #1): of ~1,039
 * auth users, roughly 1,000 are parent portal accounts. `teacher_assignments`
 * declares no FK to `auth.users` — migration 003 says in as many words that the
 * service role enforces validity when writing assignments — so a parent's uuid
 * written into that column would be accepted by the database, and the
 * migration-005 RLS helpers would then hand that parent read access to the
 * class's students and their grades. `loadAllStaffUncached` above still
 * resolves roles from `appMeta.role ?? userMeta.role`, and **the parent portal
 * is a separate repo**: the day it writes any string at all into
 * `user_metadata.role`, a `!= null` test would admit every one of those
 * accounts. `resolveRoleSetFromMetadata` turns an unrecognised value into an
 * EMPTY list, so `roles.includes('teacher')` admits none of them whatever that
 * string turns out to be. Do not relax it.
 *
 * ⚠ A stale role string — say `registrar`, from before the migration-092
 * rename (KD #155) — is therefore NOT assignable, and that is correct rather
 * than a gap. Such an account is already inert app-wide: `getUserRole` and
 * `getRoleFromClaims` narrow to `ROLES` too, so it resolves to `null`, holds
 * no capability, and `proxy.ts` routes it to the parent portal. Making it
 * assignable here would recover nothing; fixing the account recovers the
 * person.
 */
export async function getTeacherList(
  options: Options = {}
): Promise<StaffMember[]> {
  const excludeDisabled = options.excludeDisabled ?? true;
  const all = await _loadAllStaff();
  return all
    .filter(
      (u) => u.roles.includes('teacher') && (!excludeDisabled || !u.disabled)
    )
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
    .filter(
      (u) => u.roles.includes('school_admin') || u.roles.includes('superadmin')
    )
    .map((u) => u.email);
}

/**
 * Returns registrar emails — used for change-request workflow notifications.
 * Shares the same underlying cached listUsers call.
 */
export async function getRegistrarEmailList(): Promise<string[]> {
  const all = await _loadAllStaff();
  return all
    .filter((u) => u.roles.includes('academic_coordinator'))
    .map((u) => u.email);
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
 * Admin sidebar's Staff count chip (SIS Admin visual pass, Task V2) and the
 * Staff page's header/Accounts-tab count. Shares the same 5-min cached
 * listUsers() call as every other helper in this file — no new query, just
 * a length over the already-cached list.
 *
 * Filters to a real staff role (matches lib/sis/users/queries.ts's
 * `listStaffUsers`) — the underlying `auth.users` table is shared with
 * parent accounts (role: null, KD #11), so counting every non-disabled row
 * without this filter counts parents as "staff" too. That bug is what made
 * this show a flat 1000 — the raw listUsers() fetch is capped at
 * `perPage: 1000`, so once total accounts (staff + parents) grew past that
 * ceiling, the unfiltered count just reported the fetch cap itself.
 */
export async function getStaffCount(): Promise<number> {
  const all = await _loadAllStaff();
  return all.filter((u) => !u.disabled && u.roles.length > 0).length;
}

/**
 * Narrows a userId → display-name entry list down to only the ids a page
 * actually resolves.
 *
 * `getStaffDisplayNameById()` returns EVERY auth user with an email —
 * `loadAllStaffUncached` above applies no role filter — which on this
 * school's account mix is roughly 1,039 rows, almost all parent portal
 * accounts (the shared `auth.users` table, KD #11). A `'use client'` table
 * that threads the full map into a component prop ships that whole roster
 * — name or email of every parent in the school — across the wire for a
 * lookup that only ever needs a handful of ids per row. This fixes the two
 * Markbook mark-change history dialogs (`__tests__` names it as F2), which
 * called `getStaffDisplayNameById()` unfiltered before this existed.
 *
 * Pure — takes the already-fetched entries and already-loaded rows, no I/O
 * of its own — so the narrowing is testable without mocking `listUsers`.
 */
export function narrowStaffNamesToRows<T>(
  entries: Array<[string, string]>,
  rows: readonly T[],
  pickIds: (row: T) => Array<string | null | undefined>
): Array<[string, string]> {
  const needed = new Set(rows.flatMap(pickIds).filter((v): v is string => !!v));
  return entries.filter(([id]) => needed.has(id));
}

/**
 * How many active accounts hold each role — the "N people" figure on the role
 * permission cards, which is what makes an edit's reach concrete before you
 * make it.
 *
 * Same already-cached listUsers() call as every other helper here, and the same
 * two filters as `getStaffCount`: disabled accounts don't count, and a role must
 * be a real staff role (auth.users is shared with role-less parent accounts,
 * KD #11). Every role is present in the result, including ones nobody holds —
 * a card reading "0 people" is information, not a gap.
 *
 * ⚠ SOMEONE WHO HOLDS TWO ROLES IS COUNTED ON BOTH CARDS, and that is the
 * honest answer to what the card asks. The figure exists to make an edit's
 * reach concrete, and editing the Teacher permissions really does reach a
 * teaching admin — on the days they are working as a teacher. It does mean the
 * six figures can sum to more than the staff headcount.
 */
export async function getStaffCountsByRole(): Promise<Record<string, number>> {
  const all = await _loadAllStaff();
  const counts: Record<string, number> = Object.fromEntries(
    ROLES.map((role) => [role, 0])
  );
  for (const user of all) {
    if (user.disabled) continue;
    // `roles` is already narrowed to real roles, so every entry has a card.
    for (const role of user.roles) counts[role] += 1;
  }
  return counts;
}
