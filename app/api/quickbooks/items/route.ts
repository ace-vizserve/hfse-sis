import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { qboErrorMessage, qboQuery } from '@/lib/qbo/client';
import { QBO_INVOICE_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

// GET /api/quickbooks/items — the school's active QuickBooks items for the
// Create invoice drawer. The SIS never keeps its own fee list.
export async function GET() {
  const auth = await requireRole([...QBO_INVOICE_ROLES]);
  if ('error' in auth) return auth.error;
  try {
    const items = await qboQuery<{
      Id: string;
      Name: string;
      Description?: string;
      UnitPrice?: number;
      Type?: string;
    }>(
      createServiceClient(),
      'Item',
      'Active = true',
      'orderby Name maxresults 1000'
    );
    return NextResponse.json({
      items: items
        .filter((i) => i.Type !== 'Category')
        .map((i) => ({
          id: i.Id,
          name: i.Name,
          description: i.Description ?? null,
          unitPrice: typeof i.UnitPrice === 'number' ? i.UnitPrice : null,
        })),
    });
  } catch (e) {
    return NextResponse.json({ error: qboErrorMessage(e) }, { status: 502 });
  }
}
