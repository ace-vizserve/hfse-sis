import { NextResponse, type NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';

import { requireRole } from '@/lib/auth/require-role';
import { logAction } from '@/lib/audit/log-action';
import { createServiceClient } from '@/lib/supabase/service';
import { VirtueThemeSchema } from '@/lib/schemas/virtue-theme';

// PATCH /api/evaluation/virtue-theme
// Body: { termId, virtueTheme } — updates ONLY terms.virtue_theme.
// Decoupled from the combined AY-Setup term-dates route so this surface
// never touches start/end dates. Empty string / explicit null clears the theme.
// Audit: ay.term_virtue.update (no-op saves emit nothing).
export async function PATCH(request: NextRequest) {
  const auth = await requireRole([
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = VirtueThemeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { termId } = parsed.data;
  const virtueTheme = parsed.data.virtueTheme ?? null;

  const service = createServiceClient();

  const { data: before, error: loadErr } = await service
    .from('terms')
    .select('id, academic_year_id, term_number, label, virtue_theme')
    .eq('id', termId)
    .maybeSingle();
  if (loadErr)
    return NextResponse.json({ error: loadErr.message }, { status: 500 });
  if (!before)
    return NextResponse.json({ error: 'term not found' }, { status: 404 });

  const changed = (before.virtue_theme ?? null) !== virtueTheme;
  if (changed) {
    const { error: updErr } = await service
      .from('terms')
      .update({ virtue_theme: virtueTheme })
      .eq('id', termId);
    if (updErr)
      return NextResponse.json({ error: updErr.message }, { status: 500 });

    await logAction({
      service,
      actor: { id: auth.user.id, email: auth.user.email ?? null },
      action: 'ay.term_virtue.update',
      entityType: 'term',
      entityId: termId,
      context: {
        academic_year_id: before.academic_year_id,
        term_number: before.term_number,
        label: before.label,
        before: { virtue_theme: before.virtue_theme ?? null },
        after: { virtue_theme: virtueTheme },
      },
    });

    // Bust the sis: readiness cache — the AY readiness check reads term data.
    const { data: ay } = await service
      .from('academic_years')
      .select('ay_code')
      .eq('id', before.academic_year_id)
      .maybeSingle();
    const ayCode = (ay as { ay_code: string } | null)?.ay_code ?? null;
    if (ayCode) revalidateTag(`sis:${ayCode}`, 'max');
  }

  return NextResponse.json({ ok: true, changed });
}
