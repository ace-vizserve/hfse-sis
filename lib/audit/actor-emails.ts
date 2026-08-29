// The Actor filter dropdown on the module audit-log pages.
//
// Every one of these pages used to answer "who has ever acted in this module"
// by selecting the `actor_email` COLUMN and de-duplicating it in JavaScript.
// PostgREST has no DISTINCT, so that read scales with the LOG, not with the
// number of people in it, and every attempt to bound it bounds the wrong thing:
// `.limit(200)` is a row limit, and ordered by email, 200 rows can be two
// people who were busy. Measured in production 2026-08-30, the markbook page
// had 306 rows across 9 actors and its dropdown listed 8.
//
// `audit_actor_emails` (migration 133) does the DISTINCT in the database and
// returns one row per actor. It is SECURITY INVOKER, so migration 006's
// `audit_log_registrar_read` policy still applies to whoever calls it — pass
// the caller's cookie client, not the service client, and the dropdown can
// never list somebody the page itself would not show.

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Distinct actor emails for one module's action allowlist, ordered.
 *
 * Degrades to an empty list rather than throwing: an unavailable dropdown is a
 * page that still renders its log, whereas a throw here would take the whole
 * audit log down with it. The failure is logged rather than swallowed — that
 * matters most before migration 133 is applied, when the only symptom would
 * otherwise be a filter that quietly offers nobody.
 */
export async function loadAuditActorEmails(
  supabase: SupabaseClient,
  actions: readonly string[],
  label: string
): Promise<string[]> {
  const { data, error } = await supabase.rpc('audit_actor_emails', {
    p_actions: actions as string[],
  });

  if (error) {
    console.error(
      `[${label} audit log] actor list unavailable:`,
      error.message,
      '— has migration 133_audit_actor_emails.sql been applied?'
    );
    return [];
  }

  // The RPC already returns distinct, non-null, ordered values. The filter is
  // here only so a malformed row cannot put an empty option in the <Select>.
  return ((data ?? []) as Array<{ actor_email: string | null }>)
    .map((r) => r.actor_email)
    .filter((e): e is string => Boolean(e));
}
