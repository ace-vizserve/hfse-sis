import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { loadCustomerHistory } from '@/lib/billing/history.server';
import { qboErrorMessage } from '@/lib/qbo/client';
import { QBO_INVOICE_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/billing/students/[studentNumber]/refresh — re-read this student's
// whole QuickBooks history and recompute their tiles.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ studentNumber: string }> }
) {
  const auth = await requireRole([...QBO_INVOICE_ROLES]);
  if ('error' in auth) return auth.error;
  const { studentNumber } = await params;
  try {
    return NextResponse.json(
      await loadCustomerHistory(createServiceClient(), studentNumber)
    );
  } catch (e) {
    return NextResponse.json({ error: qboErrorMessage(e) }, { status: 502 });
  }
}
