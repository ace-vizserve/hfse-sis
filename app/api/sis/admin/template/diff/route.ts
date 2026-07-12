import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/require-role';
import { createServiceClient } from '@/lib/supabase/service';
import { computeTemplateDiff } from '@/lib/sis/template-diff';

// GET /api/sis/admin/template/diff?ay_code=AY2027 — read-only preview of
// what "Propagate to AYs" would change for ONE AY, computed the same way
// apply_template_to_ay's UPSERT would resolve it, but never writes.
export async function GET(request: Request): Promise<NextResponse> {
  const auth = await requireRole(['school_admin', 'superadmin']);
  // Truthiness check (not `'error' in auth`) — with this route's explicit
  // `Promise<NextResponse>` return annotation, `'error' in auth` narrows
  // `auth.error` to `NextResponse | undefined` (TS synthesizes an implicit
  // `error?: undefined` on the success branch), which tsc then rejects as
  // not assignable to `NextResponse`. Checking truthiness narrows out
  // `undefined` too and is equivalent at runtime (`auth.error` is always a
  // real NextResponse when present).
  if (auth.error) return auth.error;

  const { searchParams } = new URL(request.url);
  const ayCode = searchParams.get('ay_code');
  if (!ayCode || !/^AY[0-9]{4}$/.test(ayCode)) {
    return NextResponse.json(
      { error: 'ay_code must look like AY2027' },
      { status: 400 }
    );
  }

  const service = createServiceClient();
  const { data: ay } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode)
    .maybeSingle();
  if (!ay) return NextResponse.json({ error: 'AY not found' }, { status: 404 });

  const [
    { data: templateConfigs },
    { data: actualConfigs },
    { data: templateSections },
    { data: actualSections },
  ] = await Promise.all([
    service
      .from('template_subject_configs')
      .select(
        'subject_id, level_id, ww_weight, pt_weight, qa_weight, ww_max_slots, pt_max_slots, qa_max'
      ),
    service
      .from('subject_configs')
      .select(
        'subject_id, level_id, ww_weight, pt_weight, qa_weight, ww_max_slots, pt_max_slots, qa_max'
      )
      .eq('academic_year_id', ay.id),
    service.from('template_sections').select('level_id, name'),
    service
      .from('sections')
      .select('level_id, name')
      .eq('academic_year_id', ay.id),
  ]);

  const diff = computeTemplateDiff(
    templateConfigs ?? [],
    actualConfigs ?? [],
    templateSections ?? [],
    actualSections ?? []
  );

  return NextResponse.json({ diff });
}
