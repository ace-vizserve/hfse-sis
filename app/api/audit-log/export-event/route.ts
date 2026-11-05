import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { logDataAccess } from '@/lib/audit/log-data-access';
import { tooManyRequests, userRateLimit } from '@/lib/rate-limit';
import { getSessionUser } from '@/lib/supabase/server';

// POST /api/audit-log/export-event
//
// Tables and dashboards build their CSV in the browser from what is on screen,
// so the server never sees the download. They report it here: the file name,
// the row count and the page, never the data.
const ExportEventSchema = z.object({
  file: z.string().min(1).max(200),
  rows: z.number().int().min(0).nullable(),
  page: z.string().max(300),
});

export async function POST(request: NextRequest) {
  const session = await getSessionUser();
  if (!session)
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  const rl = userRateLimit({
    userId: session.id,
    scope: 'export-event',
    userMax: 60,
    windowSecs: 60,
  });
  if (rl.limited) return tooManyRequests(rl.retryAfter);

  const parsed = ExportEventSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success)
    return NextResponse.json({ error: 'Invalid event.' }, { status: 400 });

  await logDataAccess(
    { user: session, role: session.role },
    'data.export',
    'Table or dashboard download',
    parsed.data
  );
  return NextResponse.json({ ok: true });
}
