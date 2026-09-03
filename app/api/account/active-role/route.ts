import { NextResponse, type NextRequest } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { getUserRole, getUserRoleSet, type Role } from '@/lib/auth/roles';
import { createServiceClient } from '@/lib/supabase/service';
import { getSessionUser } from '@/lib/supabase/server';

// POST /api/account/active-role   body: { role: Role }
//
// Changes which of their roles the signed-in account is working in, by writing
// `app_metadata.active_role`. There is still exactly one role in force
// afterwards, so this is a real role change — every gate, policy and per-role
// view simply reads the new value. It is not a rendering preference.
//
// ⚠ THE WRITE DOES NOT REACH A SESSION ALREADY IN FLIGHT.
// `getClaims()` verifies the JWT locally; nothing here re-mints it, and the
// access token can be up to an hour old. So the CLIENT must call
// `supabase.auth.refreshSession()` and navigate only once that resolves — see
// `components/view-switch/use-view-switch.ts`, which is the one place a switch
// is performed. A plain reload would serve the old role and look like the
// switch silently failed.
//
// ⚠ THE SWITCH ALWAYS LANDS ON `/`, AND THE ROUTE TAKES NO DESTINATION.
// Mr Ace's instruction (2026-09-02: "i think redirect the user to index
// route"): switching roles while deep inside a page belonging to the OTHER job
// can strand you, and `/` is coherent either way. An earlier design accepted a
// `next` destination for the "not one of your classes" notice; that notice is
// gone — a role change is a real role change now, so the pages that used to
// explain a mismatched lens have nothing left to explain — and with it went the
// open-redirect surface a client-supplied destination created.
//
// ⚠ NO `requireRole` HERE, and that is not an oversight. Every other route
// gates on "is your role in this list"; the gate here is narrower than any
// list could be — the requested value must be one of the roles THIS ACCOUNT
// holds. A `requireRole` in front of it would admit exactly the same people
// and read as though it were doing the work, when the check below is what
// actually decides.
//
// ⚠ THE BODY IS A REQUEST, NOT A GRANT. The entitled set is re-read from the
// account itself on every call and nothing the client sends can widen it.
export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  // A malformed or absent body is a bad request, not a crash — and a DIFFERENT
  // bad request from an unentitled one. The two are split because the switcher
  // will render the answer: "you do not have that role" is something to show a
  // person, while a body that did not parse is a bug in the caller.
  let body: unknown = null;
  let parsed = true;
  try {
    body = await request.json();
  } catch {
    parsed = false;
  }
  const requested = (body as { role?: unknown } | null)?.role;

  if (!parsed || typeof requested !== 'string') {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const service = createServiceClient();

  // ⚠ READ FROM THE ACCOUNT, NOT FROM THE SESSION.
  // The JWT the viewer is holding can be up to an hour old, so a role granted
  // (or removed) minutes ago is not in it yet. Reading `auth.users` is the only
  // way this check answers with what the account holds RIGHT NOW — which
  // matters in both directions: a role just granted should be usable without
  // waiting out the token, and a role just removed must not be.
  const { data: accountRes, error: accountErr } =
    await service.auth.admin.getUserById(user.id);
  if (accountErr || !accountRes?.user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const account = accountRes.user;
  const entitled = getUserRoleSet(account);
  const currentRole = getUserRole(account);

  if (!entitled.includes(requested as Role)) {
    return NextResponse.json({ error: 'not_entitled' }, { status: 400 });
  }

  const { error: writeErr } = await service.auth.admin.updateUserById(user.id, {
    app_metadata: {
      ...(account.app_metadata ?? {}),
      active_role: requested,
    },
  });
  if (writeErr) {
    // Nothing changed, so say so rather than reporting a switch that did not
    // happen — the client would refresh the session and land back where it was.
    return NextResponse.json({ error: 'switch_failed' }, { status: 500 });
  }

  // ── THE SWITCH ITSELF IS AN AUDIT EVENT ──────────────────────────────────
  //
  // Mr Ace's reason for wanting the role on audit rows at all: "best for audit
  // trail as well since they switched roles." This is the entry that makes the
  // rest legible — "Koh changed to Teacher at 09:14" sits above the marks she
  // then entered, and explains them.
  //
  // `actor.role` is the role she was working in when she asked, which is also
  // `from_view`: the row is written before the new one is in anybody's token,
  // and stamping it with the role she is moving TO would misdate the change.
  //
  // Awaited rather than fired-and-forgotten: `logAction` never throws (it
  // swallows and console.errors its own failures), so awaiting cannot fail the
  // switch, and not awaiting inside a route handler risks the write being cut
  // off when the response ends.
  await logAction({
    service,
    actor: { id: user.id, email: user.email, role: currentRole },
    action: 'user.view.switch',
    entityType: 'user_account',
    entityId: user.id,
    context: {
      from_view: currentRole,
      to_view: requested,
    },
  });

  // Answers with the role now in force. Named `role` — the same word the body
  // uses and the same word every gate reads — because there is no longer a
  // second, parallel "active" value for it to be distinguished from.
  return NextResponse.json({ role: requested });
}
