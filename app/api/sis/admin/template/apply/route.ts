import { revalidateTag } from 'next/cache';
import { NextResponse, type NextRequest } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { ApplyTemplateSchema } from '@/lib/schemas/template';
import { createServiceClient } from '@/lib/supabase/service';

type ApplyTemplateRpcResult = {
  ay_code: string;
  sections_inserted: number;
  sections_updated: number;
  configs_inserted: number;
  configs_updated: number;
};

// POST /api/sis/admin/template/apply
//
// Propagates the master template (template_sections + template_subject_configs)
// into the selected AYs via the `apply_template_to_ay` RPC. UPSERT on natural
// key — INSERT new rows, UPDATE existing rows' template-managed columns. NEVER
// deletes — if the template no longer has a section, existing AYs keep theirs.
//
// Per-AY data (e.g. `sections.form_class_adviser`) is preserved by the UPDATE
// leaving non-template columns alone.
export async function POST(request: NextRequest) {
  const auth = await requireRole(['school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = ApplyTemplateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { ay_codes: ayCodes } = parsed.data;

  const service = createServiceClient();

  const results: ApplyTemplateRpcResult[] = [];
  const failures: Array<{ ay_code: string; error: string }> = [];

  // Sequential rather than parallel — each call is one RPC and the apply
  // is fast; serializing keeps audit-log ordering deterministic + avoids
  // any chance of one AY's write blocking another.
  for (const ayCode of ayCodes) {
    const { data, error } = await service.rpc('apply_template_to_ay', {
      p_ay_code: ayCode,
    });
    if (error) {
      console.error(`[template.apply] ${ayCode} failed:`, error.message);
      failures.push({ ay_code: ayCode, error: error.message });
      continue;
    }
    const result = (data ?? null) as ApplyTemplateRpcResult | null;
    if (!result) {
      failures.push({ ay_code: ayCode, error: 'rpc returned null' });
      continue;
    }
    results.push(result);

    // Grant section_subjects defaults for any subject the template apply
    // just added/updated on this AY — best-effort, additive-only (ON
    // CONFLICT DO NOTHING never removes an existing per-section
    // customization). Keeps already-populated AYs' sections in sync with a
    // newly-added template subject without requiring a manual "Load
    // default subject set" click per section.
    const { error: syncErr } = await service.rpc(
      'sync_section_subjects_for_ay',
      { p_ay_code: ayCode }
    );
    if (syncErr) {
      console.error(
        `[template.apply] ${ayCode} section_subjects sync failed:`,
        syncErr.message
      );
    }

    revalidateTag(`sis:${ayCode}`, 'max');
  }

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'template.apply',
    entityType: 'template_application',
    entityId: null,
    context: {
      ay_codes: ayCodes,
      results,
      failures,
    },
  });

  return NextResponse.json({ ok: failures.length === 0, results, failures });
}
