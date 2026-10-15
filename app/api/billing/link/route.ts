import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireRole } from '@/lib/auth/require-role';
import { runLink } from '@/lib/billing/link-run.server';
import { qboErrorMessage } from '@/lib/qbo/client';
import { QBO_ADMIN_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

// The bulk run also loads each linked student's history, one at a time.
export const maxDuration = 300;

const Body = z.object({ dryRun: z.boolean() });

// POST /api/billing/link — match every unlinked student to their QuickBooks
// customer. dryRun: true only counts. Superadmin.
export async function POST(request: Request) {
  const auth = await requireRole([...QBO_ADMIN_ROLES]);
  if ('error' in auth) return auth.error;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  try {
    const result = await runLink(createServiceClient(), {
      dryRun: parsed.data.dryRun,
      actor: {
        id: auth.user.id,
        email: auth.user.email ?? null,
        role: auth.role,
      },
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: qboErrorMessage(e) }, { status: 502 });
  }
}
