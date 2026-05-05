import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { getUserRole } from '@/lib/auth/roles';
import { requireCurrentAyCode } from '@/lib/academic-year';
import { getOutdatedApplications } from '@/lib/admissions/dashboard';
import { buildCsv } from '@/lib/csv';

// Admin + superadmin CSV export of the outdated-applications table for a
// given AY. Surfaces the same rows the dashboard shows, but serialized for
// offline triage. Gated at the route level — registrar / teacher get 403.
export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const role = getUserRole(userData.user);
  if (role !== 'school_admin' && role !== 'superadmin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

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
      'levelApplied',
      'lastUpdated',
      'daysSinceUpdate',
      'daysInPipeline',
    ],
    rows.map((r) => [
      r.enroleeNumber,
      r.fullName,
      r.status,
      r.levelApplied,
      r.lastUpdated,
      r.daysSinceUpdate,
      r.daysInPipeline,
    ]),
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
