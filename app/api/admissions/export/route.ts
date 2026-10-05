import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { requireCurrentAyCode } from '@/lib/academic-year';
import { getOutdatedApplications } from '@/lib/admissions/dashboard';
import { buildCsv } from '@/lib/csv';
import { createClient } from '@/lib/supabase/server';

// Superadmin-only CSV export of the outdated-applications table for a given AY
// (KD #17). Surfaces the same rows the dashboard shows, serialized for offline
// triage.
export async function GET(req: Request) {
  const auth = await requireRole(['superadmin']);
  if ('error' in auth) return auth.error;

  const supabase = await createClient();
  const url = new URL(req.url);
  const ayParam = url.searchParams.get('ay');
  const ayCode =
    ayParam && /^AY\d{4}$/.test(ayParam)
      ? ayParam
      : await requireCurrentAyCode(supabase);

  const rows = await getOutdatedApplications(ayCode);

  const body = buildCsv(
    [
      'enroleeNumber',
      'fullName',
      'status',
      // The SIS level the child counts as, then the name as applied.
      'level',
      'levelApplied',
      'lastUpdated',
      'daysSinceUpdate',
      'daysInPipeline',
    ],
    rows.map((r) => [
      r.enroleeNumber,
      r.fullName,
      r.status,
      r.level,
      r.levelApplied,
      r.lastUpdated,
      r.daysSinceUpdate,
      r.daysInPipeline,
    ])
  );

  const filename = `admissions-outdated-${ayCode}-${new Date()
    .toISOString()
    .slice(0, 10)}.csv`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
    },
  });
}
