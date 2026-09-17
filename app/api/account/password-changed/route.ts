import { NextResponse } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { createServiceClient } from '@/lib/supabase/service';
import { getSessionUser } from '@/lib/supabase/server';

// POST /api/account/password-changed   (no body)
//
// Records that the signed-in person changed their own password from the
// Account page.
//
// ⚠ THE PASSWORD NEVER COMES HERE. The change itself is made in the browser by
// `supabase.auth.updateUser` (app/(dashboard)/account/change-password-form.tsx),
// and that call has no server hop this app owns — so without this route a
// password change left no trace in the activity log at all. The form calls
// this only AFTER Supabase has accepted the new password, and sends nothing:
// who changed it comes from the verified session, never from a body.
//
// ⚠ WHAT THIS ROW PROVES. It is the browser reporting a change Supabase
// accepted. A signed-in person could call it without changing anything, but
// the only row they can write is one about their own account, saying they
// changed their own password — nothing about anyone else, nothing that grants
// or removes access.
//
// Any signed-in account, not a role list: every role can reach the Account
// page, and "has no role yet" is still somebody whose password changed.
export async function POST() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  // `logAction` never throws — it swallows and console.errors its own
  // failures — so awaiting it cannot turn a changed password into an error.
  await logAction({
    service: createServiceClient(),
    actor: { id: user.id, email: user.email || null, role: user.role },
    action: 'user.password.change',
    entityType: 'user_account',
    entityId: user.id,
    context: { self_service: true },
  });

  return NextResponse.json({ ok: true });
}
