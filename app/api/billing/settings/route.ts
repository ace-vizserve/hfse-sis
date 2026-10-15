import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { loadSettings } from '@/lib/billing/settings.server';
import { QBO_ADMIN_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

// GET /api/billing/settings — everything the Billing settings page shows.
export async function GET() {
  const auth = await requireRole([...QBO_ADMIN_ROLES]);
  if ('error' in auth) return auth.error;
  try {
    return NextResponse.json(await loadSettings(createServiceClient()));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Settings could not be read.' },
      { status: 500 }
    );
  }
}
