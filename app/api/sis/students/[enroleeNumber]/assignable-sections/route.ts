import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { listAssignableSections } from '@/lib/sis/class-assignment';
import { createServiceClient } from '@/lib/supabase/service';
import { createAdmissionsClient } from '@/lib/supabase/admissions';

// GET /api/sis/students/[enroleeNumber]/assignable-sections?ay=AY2026
//
// Feeds the section picker rendered inline in EditStageDialog when a
// registrar is about to flip the application stage to Enrolled. Resolves
// the applicant's current levelApplied server-side so the client only
// needs enroleeNumber + ay, matching the same lookup shape as
// assign-section's existing route.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ enroleeNumber: string }> }
) {
  const auth = await requireRole([
    'admissions',
    'academic_coordinator',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const { enroleeNumber } = await params;
  const url = new URL(request.url);
  const ayCode = (url.searchParams.get('ay') ?? '').trim();
  if (!/^AY\d{4}$/i.test(ayCode)) {
    return NextResponse.json(
      { error: 'Invalid or missing ay query param' },
      { status: 400 }
    );
  }

  const admissions = createAdmissionsClient();
  const prefix = `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
  const { data: appRow, error: appErr } = await admissions
    .from(`${prefix}_enrolment_applications`)
    .select('levelApplied')
    .eq('enroleeNumber', enroleeNumber)
    .maybeSingle();
  if (appErr) {
    return NextResponse.json({ error: appErr.message }, { status: 500 });
  }
  const levelApplied =
    (appRow as { levelApplied: string | null } | null)?.levelApplied ?? null;

  const service = createServiceClient();
  const result = await listAssignableSections(service, ayCode, levelApplied);
  return NextResponse.json(result);
}
