import type { SupabaseClient, User } from '@supabase/supabase-js';

import { getUserRole } from '@/lib/auth/roles';
import { listAllAuthUsers } from '@/lib/supabase/paginate';

// Parent logins and staff logins share one Supabase project (KD #1). A parent
// is an account with no staff role (KD #11). This is a port of the portal's
// `admin-set-password` edge function, minus its habit of listing everybody.
//
// No server-only imports here: the screens use `generateTemporaryPassword`.

export type ParentAccount = {
  id: string;
  email: string;
  fullName: string;
  relationship: string;
  emailConfirmed: boolean;
  lastSignInAt: string | null;
};

/** What Create account shows when the email is already in use. */
export type ExistingAccount = {
  email: string;
  fullName: string;
  relationship: string;
  emailConfirmed: boolean;
  lastSignInAt: string | null;
  createdAt: string | null;
  isStaff: boolean;
};

export type CreatedAccount = {
  email: string;
  fullName: string;
  relationship: string;
};

type AccountMetadata = {
  fullName?: string;
  relationship?: string;
  display_name?: string;
};

function metadataOf(user: User): AccountMetadata {
  return (user.user_metadata ?? {}) as AccountMetadata;
}

// ⚠ Name the fields. `user_metadata` holds `temporary_password`, and this list
// goes to the browser of everyone who may open the page, viewers included.
function toParentAccount(user: User): ParentAccount {
  const meta = metadataOf(user);
  return {
    id: user.id,
    email: user.email ?? '',
    fullName: meta.fullName ?? '',
    relationship: meta.relationship ?? '',
    emailConfirmed: !!user.email_confirmed_at,
    lastSignInAt: user.last_sign_in_at ?? null,
  };
}

// The login behind the portal's own admin pages. It has no staff role, but it is
// not a parent, and resetting it would lock those pages.
const PORTAL_ADMIN_EMAIL = 'admin@parent.portal.com';

export function isPortalAdmin(user: User): boolean {
  return user.email?.toLowerCase() === PORTAL_ADMIN_EMAIL;
}

export async function listParentAccounts(
  service: SupabaseClient
): Promise<ParentAccount[]> {
  const users = await listAllAuthUsers(service);
  return users
    .filter((user) => getUserRole(user) === null && !isPortalAdmin(user))
    .map(toParentAccount)
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export function findAccountByEmail(
  users: readonly User[],
  email: string
): User | undefined {
  const wanted = email.toLowerCase();
  return users.find((user) => user.email?.toLowerCase() === wanted);
}

export function toExistingAccount(user: User): ExistingAccount {
  const meta = metadataOf(user);
  return {
    email: user.email ?? '',
    fullName: meta.fullName ?? meta.display_name ?? '',
    relationship: meta.relationship ?? '',
    emailConfirmed: !!user.email_confirmed_at,
    lastSignInAt: user.last_sign_in_at ?? null,
    createdAt: user.created_at ?? null,
    isStaff: getUserRole(user) !== null,
  };
}

// Same rule as the portal's `generatePassword` (src/lib/utils.ts): one from
// each set, the rest from all of them, shuffled. The sets leave out characters
// that are easy to misread when a password is read out to a parent.
const PASSWORD_CHARSETS = [
  'abcdefghijkmnopqrstuvwxyz',
  'ABCDEFGHJKLMNPQRSTUVWXYZ',
  '23456789',
  '!@#$%^&*',
];
const TEMPORARY_PASSWORD_LENGTH = 14;

export function generateTemporaryPassword(): string {
  const allChars = PASSWORD_CHARSETS.join('');
  const randomValues = crypto.getRandomValues(
    new Uint32Array(TEMPORARY_PASSWORD_LENGTH)
  );

  const required = PASSWORD_CHARSETS.map(
    (set, i) => set[randomValues[i] % set.length]
  );
  const rest = Array.from(
    { length: TEMPORARY_PASSWORD_LENGTH - required.length },
    (_, i) => allChars[randomValues[i + required.length] % allChars.length]
  );

  const combined = [...required, ...rest];
  const shuffleValues = crypto.getRandomValues(
    new Uint32Array(combined.length)
  );
  for (let i = combined.length - 1; i > 0; i -= 1) {
    const j = shuffleValues[i] % (i + 1);
    [combined[i], combined[j]] = [combined[j], combined[i]];
  }

  return combined.join('');
}
