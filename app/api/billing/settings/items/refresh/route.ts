import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { refreshItems } from '@/lib/billing/settings.server';
import { qboErrorMessage } from '@/lib/qbo/client';
import { QBO_ADMIN_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/billing/settings/items/refresh — re-read QuickBooks' items and
// their income accounts (new items appear in the mapping list).
export async function POST() {
  const auth = await requireRole([...QBO_ADMIN_ROLES]);
  if ('error' in auth) return auth.error;
  try {
    return NextResponse.json({
      items: await refreshItems(createServiceClient()),
    });
  } catch (e) {
    return NextResponse.json({ error: qboErrorMessage(e) }, { status: 502 });
  }
}
