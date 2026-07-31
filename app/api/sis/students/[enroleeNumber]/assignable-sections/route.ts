import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { STUDENT_RECORD_WRITERS } from '@/lib/auth/student-record';
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
  // Who may write the shared student record — see lib/auth/student-record.ts.
  // school_admin was added 2026-07-31 (KD #173): both pages that render these
  // editors already admitted her, so every save 403'd against a form that had
  // opened for her.
  const auth = await requireRole([...STUDENT_RECORD_WRITERS]);
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
